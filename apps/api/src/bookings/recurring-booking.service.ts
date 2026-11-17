import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  addDays,
  cancelByTherapist,
  dateKey,
  DomainError,
  hasStarted,
  requestBooking,
  type Booking,
} from "@terapeut/domain";
import { AuthService } from "../auth/auth.service";
import type { AccountUser } from "../auth/auth.types";
import { requireBody, requireText } from "../auth/auth.validation";
import { DatabaseService } from "../database.service";
import { DirectoryService } from "../directory/directory.service";
import { BookingNotificationService } from "../notifications/booking-notification.service";
import { BookingRepository } from "./booking.repository";
import { WaitlistService } from "./waitlist.service";
import { requireBookingDate, requireInteger } from "./booking.validation";

interface StoredSeries {
  id: string;
  therapist_id: string;
  client_user_id: string | null;
  anchor_booking_id: string;
  interval_days: number;
  next_date: string;
  start_minute: number;
  is_active: boolean;
}

/** Čuva stalno pravilo, a unaprijed pravi zasebne rezervacije samo za narednih 90 dana. */
@Injectable()
export class RecurringBookingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringBookingService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;

  /** Koristi iste transakcije, istoriju i outbox kao pojedinačno zakazivanje. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DirectoryService) private readonly directory: DirectoryService,
    @Inject(BookingRepository) private readonly repository: BookingRepository,
    @Inject(BookingNotificationService)
    private readonly notifications: BookingNotificationService,
    @Inject(WaitlistService) private readonly waitlist?: WaitlistService,
  ) {}

  /** Poslije restarta nadoknađuje buduće termine; minutni pregled radi samo dospjele serije. */
  onModuleInit() {
    this.timer = setInterval(() => this.wake(), 60000);
    this.timer.unref();
    this.wake();
  }

  /** Sačeka započetu transakciju prije zatvaranja baze i ne pokreće nove serije. */
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Sprečava preklapanje dva prolaza u istoj instanci; SQL zaključavanje štiti više instanci. */
  private wake() {
    if (this.stopping || this.running) return;
    this.running = this.refreshDue()
      .catch(() => {
        this.logger.error(
          "Dopuna stalnih termina nije uspjela; pravila ostaju u bazi za novi pokušaj.",
        );
      })
      .finally(() => {
        this.running = null;
      });
  }

  /** Obrađuje ograničenu grupu dospjelih terapeuta; sljedeći prolaz nastavlja preostale. */
  async refreshDue() {
    const due = await this.database.pool.query<{ therapist_id: string }>(
      "SELECT DISTINCT therapist_id FROM booking_series WHERE is_active AND next_date<=((now() AT TIME ZONE 'Europe/Podgorica')::date+90) LIMIT 100",
    );
    for (const row of due.rows) {
      if (this.stopping) break;
      try {
        await this.refreshTherapist(row.therapist_id);
      } catch {
        this.logger.error(
          "Dopuna jedne grupe stalnih termina nije uspjela; ostale grupe se nastavljaju.",
        );
      }
    }
  }

  /** Prije prikaza kalendara dopunjava serije pod istim lock-om kao obično zakazivanje. */
  async refreshTherapist(identifier: string) {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapist = await client.query<{ id: string }>(
        "SELECT id FROM therapists WHERE id::text=$1 OR public_id=$1 FOR UPDATE",
        [identifier],
      );
      if (therapist.rows[0]) {
        await this.fillForTherapist(client, therapist.rows[0].id);
        await this.waitlist?.allocate(client, therapist.rows[0].id);
      }
      await client.query("COMMIT");
      this.notifications.wake();
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Dopunjava samo profile čije serije trenutni nalog smije da vidi. */
  async refreshForUser(user: AccountUser) {
    const profiles = await this.database.pool.query<{ therapist_id: string }>(
      `SELECT DISTINCT s.therapist_id FROM booking_series s JOIN therapists t ON t.id=s.therapist_id
       WHERE s.is_active AND (($2='CLIENT' AND s.client_user_id=$1) OR ($2='THERAPIST' AND t.linked_user_id=$1))`,
      [user.id, user.role],
    );
    for (const profile of profiles.rows)
      await this.refreshTherapist(profile.therapist_id);
  }

  /** Čita privatni pregled pravila i datuma koji zahtijevaju pažnju, bez tuđih klijenata. */
  async listForUser(user: AccountUser) {
    const result = await this.database.pool.query(
      `SELECT s.id,s.interval_days AS "intervalDays",s.is_active AS active,
       to_char(s.first_date,'YYYY-MM-DD') AS "firstDate",s.start_minute AS start,
       to_char(s.next_date,'YYYY-MM-DD') AS "nextDate",b.duration_minutes AS duration,
       b.client_name_snapshot AS "clientName",t.full_name AS "therapistName",
       COALESCE((SELECT jsonb_agg(jsonb_build_object('date',to_char(i.occurrence_date,'YYYY-MM-DD'),'reason',i.reason) ORDER BY i.occurrence_date)
         FROM booking_series_issues i WHERE i.series_id=s.id AND i.resolved_at IS NULL),'[]') AS issues
       FROM booking_series s JOIN therapists t ON t.id=s.therapist_id JOIN booking_requests b ON b.id=s.anchor_booking_id
       WHERE ($2='CLIENT' AND s.client_user_id=$1) OR ($2='THERAPIST' AND t.linked_user_id=$1)
       ORDER BY s.is_active DESC,s.created_at DESC`,
      [user.id, user.role],
    );
    return result.rows;
  }

  /** Zaključava vlastiti profil prije serije; browser ne bira terapeuta ni klijenta. */
  private async lockOwner(
    client: PoolClient,
    user: AccountUser,
  ): Promise<string> {
    if (user.role !== "THERAPIST")
      throw new ForbiddenException("Stalne termine uređuje terapeut.");
    const owner = await client.query<{ id: string }>(
      "SELECT id FROM therapists WHERE linked_user_id=$1 FOR UPDATE",
      [user.id],
    );
    if (!owner.rows[0])
      throw new ForbiddenException("Profil terapeuta nije dostupan.");
    return owner.rows[0].id;
  }

  /** Pravi trajno pravilo iz potvrđene seanse i provjerava cijelu početnu seriju prije COMMIT-a. */
  async create(token: string | undefined, value: unknown) {
    const user = await this.auth.getAccount(token);
    const body = requireBody(value);
    const bookingId = requireText(body.bookingId, "Termin", 100);
    const intervalDays = requireInteger(body.intervalDays, "Razmak", 7, 14);
    if (intervalDays !== 7 && intervalDays !== 14)
      throw new BadRequestException("Izaberite razmak od 7 ili 14 dana.");
    await this.auth.limitAttempts(`recurring:${user.id}`, 20, 900);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.lockOwner(client, user);
      await this.fillForTherapist(client, therapistId);
      await this.waitlist?.allocate(client, therapistId);
      const bookings = await this.repository.list(client, therapistId);
      const anchor = bookings.find((booking) => booking.id === bookingId);
      if (!anchor)
        throw new NotFoundException("Termin nije pronađen kod ovog terapeuta.");
      if (anchor.series) {
        if (
          !anchor.series.active ||
          anchor.series.intervalDays !== intervalDays
        )
          throw new ConflictException(
            "Termin već pripada drugoj ili zaustavljenoj seriji.",
          );
        await client.query("COMMIT");
        return { booking: anchor };
      }
      if (anchor.status !== "CONFIRMED" || hasStarted(anchor))
        throw new BadRequestException(
          "Izaberite potvrđeni budući termin za početak serije.",
        );
      const identity = await client.query<{ client_user_id: string | null }>(
        "SELECT b.client_user_id FROM booking_requests b JOIN users u ON u.id=b.client_user_id WHERE b.id=$1 AND u.role='CLIENT' AND u.verified_at IS NOT NULL AND u.suspended_at IS NULL",
        [anchor.id],
      );
      if (!identity.rows[0]?.client_user_id)
        throw new BadRequestException(
          "Klijent mora imati nalog povezan sa rezervacijom.",
        );
      const id = randomUUID();
      await client.query(
        `INSERT INTO booking_series(id,therapist_id,client_user_id,anchor_booking_id,interval_days,first_date,start_minute,next_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$6::date+$5::int)`,
        [
          id,
          therapistId,
          identity.rows[0].client_user_id,
          anchor.id,
          intervalDays,
          anchor.date,
          anchor.start,
        ],
      );
      await client.query(
        "UPDATE booking_requests SET series_id=$2,occurrence_date=$3 WHERE id=$1",
        [anchor.id, id, anchor.date],
      );
      await this.repository.recordEvent(
        client,
        {
          ...anchor,
          events: [
            {
              at: new Date().toISOString(),
              actor: "therapist",
              action: "SERIES_STARTED",
              from: "CONFIRMED",
              to: "CONFIRMED",
            },
          ],
        },
        user.id,
        anchor,
      );
      // Nema djelimično sačuvane početne serije: konflikt bilo kog datuma vraća sve nove upise.
      await this.fillForTherapist(client, therapistId, id);
      const updated = (await this.repository.list(client, therapistId)).find(
        (booking) => booking.id === anchor.id,
      )!;
      await client.query("COMMIT");
      this.notifications.wake();
      return { booking: updated };
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Čita pravila pod već zaključanim profilom; pomjereni/otkazani pojedinačni termin se ne pravi ponovo. */
  async fillForTherapist(
    client: PoolClient,
    therapistId: string,
    strictSeriesId?: string,
  ) {
    const series = await client.query<StoredSeries>(
      `SELECT id,therapist_id,client_user_id,anchor_booking_id,interval_days,start_minute,is_active,
       to_char(next_date,'YYYY-MM-DD') AS next_date FROM booking_series
       WHERE therapist_id=$1 AND is_active AND ($2::uuid IS NULL OR id=$2) ORDER BY created_at,id FOR UPDATE`,
      [therapistId, strictSeriesId || null],
    );
    const horizon = addDays(dateKey(), 90);
    for (const rule of series.rows) {
      let occurrenceDate = rule.next_date;
      while (occurrenceDate <= horizon) {
        // Savepoint omogućava da kasniji konflikt ostane vidljiv, a druge seanse budu zakazane.
        await client.query("SAVEPOINT recurring_occurrence");
        try {
          await this.createOccurrence(
            client,
            rule,
            occurrenceDate,
            occurrenceDate,
            rule.start_minute,
          );
          await client.query("RELEASE SAVEPOINT recurring_occurrence");
        } catch (failure) {
          await client.query("ROLLBACK TO SAVEPOINT recurring_occurrence");
          await client.query("RELEASE SAVEPOINT recurring_occurrence");
          const reason = this.failureReason(failure);
          // Neočekivana SQL/mrežna greška ne pomjera cursor i ne gubi buduću rezervaciju.
          if (!reason) throw failure;
          if (strictSeriesId)
            throw new ConflictException(
              `Serija nije sačuvana. ${occurrenceDate}: ${reason}`,
            );
          await client.query(
            "INSERT INTO booking_series_issues(series_id,occurrence_date,reason) VALUES ($1,$2,$3) ON CONFLICT(series_id,occurrence_date) DO NOTHING",
            [rule.id, occurrenceDate, reason],
          );
        }
        occurrenceDate = addDays(occurrenceDate, rule.interval_days);
        await client.query(
          "UPDATE booking_series SET next_date=$2 WHERE id=$1",
          [rule.id, occurrenceDate],
        );
      }
    }
  }

  /** Pravi jednu potvrđenu seansu sa originalnim trajanjem/cijenom, uz novu provjeru dostupnosti i vremena. */
  private async createOccurrence(
    client: PoolClient,
    rule: StoredSeries,
    occurrenceDate: string,
    date: string,
    start: number,
  ) {
    const exists = await client.query(
      "SELECT id FROM booking_requests WHERE series_id=$1 AND occurrence_date=$2",
      [rule.id, occurrenceDate],
    );
    if (exists.rowCount) return;
    if (date < dateKey())
      throw new ConflictException(
        "Datum je prošao dok aplikacija nije radila.",
      );
    const profile = (await this.directory.list(client, rule.therapist_id))[0];
    const bookings = await this.repository.list(client, rule.therapist_id);
    const anchor = bookings.find(
      (booking) => booking.id === rule.anchor_booking_id,
    )!;
    const account = await client.query<{
      full_name: string;
      email: string;
      phone: string | null;
    }>(
      "SELECT full_name,email,phone FROM users WHERE id=$1 AND role='CLIENT' AND verified_at IS NOT NULL AND suspended_at IS NULL",
      [rule.client_user_id],
    );
    if (!profile || !account.rows[0])
      throw new ConflictException(
        "Profil terapeuta ili nalog klijenta nije dostupan.",
      );
    const currentService = profile.services.find(
      (service) => service.id === anchor.serviceId && service.active,
    );
    if (!currentService)
      throw new ConflictException("Vrsta seanse više nije aktivna.");
    // Izmjena javne cijene/trajanja ne prepravlja dogovor stalne serije.
    profile.services = [
      {
        ...currentService,
        duration: anchor.duration,
        price: anchor.price,
        name: anchor.serviceName,
        nameEn: anchor.serviceNameEn,
      },
    ];
    const person = account.rows[0];
    const requested = requestBooking(
      profile,
      {
        serviceId: anchor.serviceId,
        date,
        start,
        clientName: person.full_name,
        clientEmail: person.email,
        clientPhone: person.phone || anchor.clientPhone,
      },
      bookings,
      new Date(),
      randomUUID(),
    );
    const valid = await client.query(
      `SELECT 1 WHERE ($1::date+$2*interval '1 minute') AT TIME ZONE 'Europe/Podgorica'>now()
       AND (($1::date+$2*interval '1 minute') AT TIME ZONE 'Europe/Podgorica') AT TIME ZONE 'Europe/Podgorica'=$1::date+$2*interval '1 minute'
       AND ((($1::date+$2*interval '1 minute') AT TIME ZONE 'Europe/Podgorica')+$3*interval '1 minute') AT TIME ZONE 'Europe/Podgorica'=$1::date+($2+$3)*interval '1 minute'`,
      [date, start, requested.duration],
    );
    if (!valid.rowCount)
      throw new ConflictException(
        "Vrijeme nije dostupno ili prelazi promjenu sata.",
      );
    const booking: Booking = {
      ...requested,
      status: "CONFIRMED",
      events: [
        {
          at: new Date().toISOString(),
          actor: "system",
          action: "RECURRING_CREATED",
          from: null,
          to: "CONFIRMED",
        },
      ],
    };
    await client.query(
      `INSERT INTO booking_requests(id,client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,price_eur_snapshot,
       client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status,confirmed_at,series_id,occurrence_date)
       SELECT $1,$2,$3,b.service_id,$4,$5,$6,$7,$8,$9,($10::date+$11*interval '1 minute') AT TIME ZONE 'Europe/Podgorica',
       ($10::date+$12*interval '1 minute') AT TIME ZONE 'Europe/Podgorica','CONFIRMED',now(),$13,$14 FROM booking_requests b WHERE b.id=$15`,
      [
        booking.id,
        rule.client_user_id,
        rule.therapist_id,
        booking.serviceName,
        booking.duration,
        booking.price,
        booking.clientName,
        booking.clientEmail,
        booking.clientPhone,
        date,
        start,
        booking.end,
        rule.id,
        occurrenceDate,
        rule.anchor_booking_id,
      ],
    );
    await this.repository.recordEvent(client, booking, null);
    await this.notifications.queue(
      client,
      booking.id,
      "booking-confirmed",
      "CLIENT",
    );
  }

  /** Odvojeno čuva ručnu zamjenu problematičnog datuma; osnovni sedmični ritam ostaje isti. */
  async resolveIssue(token: string | undefined, id: string, value: unknown) {
    const user = await this.auth.getAccount(token);
    const body = requireBody(value);
    const occurrenceDate = requireText(
      body.occurrenceDate,
      "Originalni datum",
      10,
    );
    const date = requireBookingDate(body.date);
    const start = requireInteger(body.start, "Početak", 0, 1439);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.lockOwner(client, user);
      await this.fillForTherapist(client, therapistId);
      await this.waitlist?.allocate(client, therapistId);
      const rules = await client.query<StoredSeries>(
        "SELECT * FROM booking_series WHERE id::text=$1 AND therapist_id=$2 AND is_active FOR UPDATE",
        [id, therapistId],
      );
      if (!rules.rows[0])
        throw new NotFoundException("Aktivna serija nije pronađena.");
      const issue = await client.query(
        "SELECT 1 FROM booking_series_issues WHERE series_id=$1 AND occurrence_date::text=$2 AND resolved_at IS NULL FOR UPDATE",
        [id, occurrenceDate],
      );
      if (!issue.rowCount)
        throw new ConflictException(
          "Ovaj datum više ne zahtijeva izmjenu. Osvježite pregled.",
        );
      await this.createOccurrence(
        client,
        rules.rows[0],
        occurrenceDate,
        date,
        start,
      );
      await client.query(
        "UPDATE booking_series_issues SET resolved_at=now() WHERE series_id=$1 AND occurrence_date=$2",
        [id, occurrenceDate],
      );
      await client.query("COMMIT");
      this.notifications.wake();
      return { saved: true };
    } catch (failure) {
      await client.query("ROLLBACK");
      const reason = this.failureReason(failure);
      if (reason) throw new ConflictException(reason);
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Zaustavlja pravilo i otkazuje samo buduće seanse ove serije; prošli ishodi ostaju sačuvani. */
  async stop(token: string | undefined, id: string) {
    const user = await this.auth.getAccount(token);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.lockOwner(client, user);
      const rule = await client.query(
        "SELECT is_active FROM booking_series WHERE id::text=$1 AND therapist_id=$2 FOR UPDATE",
        [id, therapistId],
      );
      if (!rule.rows[0]) throw new NotFoundException("Serija nije pronađena.");
      if (rule.rows[0].is_active) {
        await client.query(
          "UPDATE booking_series SET is_active=false,stopped_at=now() WHERE id=$1",
          [id],
        );
        const bookings = await this.repository.list(client, therapistId);
        for (const booking of bookings) {
          if (
            booking.series?.id !== id ||
            hasStarted(booking) ||
            !["CONFIRMED", "ALTERNATIVE_PROPOSED", "REQUESTED"].includes(
              booking.status,
            )
          )
            continue;
          const cancelled = cancelByTherapist(
            booking,
            new Date(),
            "Terapeut je zaustavio stalni termin.",
          );
          await client.query(
            "UPDATE booking_requests SET status='CANCELLED',cancelled_at=now(),updated_at=now(),state_version=state_version+1 WHERE id=$1",
            [booking.id],
          );
          await this.repository.recordEvent(
            client,
            cancelled,
            user.id,
            booking,
          );
          await this.notifications.queue(
            client,
            booking.id,
            "booking-cancelled",
            "CLIENT",
            booking,
          );
        }
        await client.query(
          "UPDATE booking_series_issues SET resolved_at=now() WHERE series_id=$1 AND resolved_at IS NULL",
          [id],
        );
      }
      // Prekid serije oslobađa više datuma; lista čekanja ih preuzima po sačuvanom redosljedu.
      await this.waitlist?.allocate(client, therapistId);
      await client.query("COMMIT");
      this.notifications.wake();
      return { saved: true };
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Samo očekivane poslovne konflikte prikazuje kao problem datuma; tehničke greške se ponavljaju. */
  private failureReason(failure: unknown): string | null {
    if (failure instanceof DomainError) {
      if (failure.code === "SLOT_UNAVAILABLE")
        return "Termin nije slobodan ili nije u radnom vremenu.";
      return `Termin nije dostupan (${failure.code}).`;
    }
    if (failure instanceof ConflictException) return failure.message;
    if ((failure as { code?: string }).code === "23P01")
      return "Termin se preklapa sa već zakazanom seansom.";
    return null;
  }
}
