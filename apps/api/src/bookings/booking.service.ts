import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  availableStarts,
  blocksTime,
  overlaps,
  cancelByTherapist,
  DomainError,
  proposeAlternative,
  requestBooking,
  respondBooking,
  validateWindows,
  type BookingAction,
} from "@terapeut/domain";
import { DatabaseService } from "../database.service";
import { AuthService } from "../auth/auth.service";
import type { AccountUser } from "../auth/auth.types";
import {
  requireBody,
  requireSessionPrice,
  requireText,
} from "../auth/auth.validation";
import { DirectoryService } from "../directory/directory.service";
import { BookingRepository } from "./booking.repository";
import { BookingNotificationService } from "../notifications/booking-notification.service";
import type { BookingEmailTemplate } from "../notifications/booking-email-message";
import { RecurringBookingService } from "./recurring-booking.service";
import { WaitlistService } from "./waitlist.service";
import {
  requireBookingDate,
  requireInteger,
  requireTimeRange,
} from "./booking.validation";

/** Vodi dozvole i poslovne korake; svi upisi istog terapeuta zaključavaju isti red profila. */
@Injectable()
export class BookingService implements OnModuleInit, OnModuleDestroy {
  private expiryTimer?: ReturnType<typeof setInterval>;
  /** Povezuje provjerenu JWT sesiju, bazu, javni profil i istoriju rezervacija. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DirectoryService) private readonly directory: DirectoryService,
    @Inject(BookingRepository) private readonly repository: BookingRepository,
    @Inject(BookingNotificationService)
    private readonly notifications: BookingNotificationService,
    @Inject(RecurringBookingService)
    private readonly recurring?: RecurringBookingService,
    @Inject(WaitlistService)
    private readonly waitlist?: WaitlistService,
  ) {}

  /** Pokreće isticanje na serveru; radnje takođe provjeravaju istek neposredno prije čitanja. */
  onModuleInit() {
    this.expiryTimer = setInterval(() => {
      void this.repository
        .expireWaiting()
        .catch(() => console.error("Isticanje zahtjeva nije uspjelo."));
    }, 30000);
    this.expiryTimer.unref();
  }
  /** Uklanja timer pri gašenju API-ja. */
  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  /** Bira vlasnika iz sesije; ID profila u formularu ne daje pravo izmjene. */
  private async ownTherapist(user: AccountUser): Promise<string> {
    if (user.role !== "THERAPIST")
      throw new ForbiddenException("Ova radnja je dostupna samo terapeutu.");
    const result = await this.database.pool.query<{ id: string }>(
      "SELECT id FROM therapists WHERE linked_user_id=$1",
      [user.id],
    );
    if (!result.rows[0]) throw new NotFoundException("Profil nije pronađen.");
    return result.rows[0].id;
  }
  /** Zaključava profil prije čitanja termina, radnog vremena ili cijene, da paralelni upisi idu redom. */
  private async lockTherapist(
    client: PoolClient,
    identifier: string,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM therapists WHERE id::text=$1 OR public_id=$1 FOR UPDATE",
      [identifier],
    );
    if (!result.rows[0]) throw new NotFoundException("Terapeut nije pronađen.");
    return result.rows[0].id;
  }
  /** Pretvara domenske i SQL konflikte u čitljive HTTP greške; ne otkriva podatke drugog klijenta. */
  private throwBookingError(failure: unknown): never {
    if ((failure as { code?: string }).code === "23P01")
      throw new ConflictException(
        "Termin se preklapa sa već zauzetim vremenom.",
      );
    if ((failure as { code?: string }).code === "23505")
      throw new ConflictException(
        "Radno vrijeme za ovaj datum već postoji. Uredite postojeći datum.",
      );
    if (failure instanceof DomainError) {
      if (failure.code === "OVERLAPPING_AVAILABILITY")
        throw new BadRequestException(
          "Radno vrijeme se preklapa sa već sačuvanim periodom. Izaberite drugi period ili uklonite postojeći.",
        );
      if (failure.code === "SLOT_UNAVAILABLE")
        throw new ConflictException(
          "Termin više nije slobodan. Izaberite drugo vrijeme.",
        );
      throw new BadRequestException(
        `Radnja nije dozvoljena (${failure.code}).`,
      );
    }
    throw failure;
  }

  /** Provjerava stvarno trajanje i budući početak; preskače nepostojeća vremena pri promjeni sata. */
  private async validStarts(
    client: PoolClient,
    date: string,
    duration: number,
    starts: number[],
  ): Promise<number[]> {
    const result = await client.query<{ start: number }>(
      `SELECT minute AS start FROM unnest($1::int[]) minute
      CROSS JOIN LATERAL (SELECT ($2::date+minute*interval '1 minute') AT TIME ZONE 'Europe/Podgorica' AS instant) times
      WHERE instant>now() AND instant AT TIME ZONE 'Europe/Podgorica'=$2::date+minute*interval '1 minute'
      AND (instant+$3*interval '1 minute') AT TIME ZONE 'Europe/Podgorica'=$2::date+(minute+$3)*interval '1 minute'`,
      [starts, date, duration],
    );
    return result.rows.map((row) => row.start);
  }

  /** Vraća radno vrijeme i sve vrste seanse samo vlasniku profila. */
  async schedule(token: string | undefined) {
    const user = await this.auth.getAccount(token);
    const therapistId = await this.ownTherapist(user);
    const profiles = await this.directory.list(this.database.pool, therapistId);
    if (!profiles[0]) throw new NotFoundException("Profil nije dostupan.");
    return { therapist: profiles[0] };
  }

  /** Čuva raspored; ponovljen isti interval vraća postojeći zapis, a preklapanje ostaje zabranjeno. */
  async saveSchedule(token: string | undefined, value: unknown) {
    const user = await this.auth.getAccount(token);
    const therapistId = await this.ownTherapist(user);
    const body = requireBody(value);
    let notice: "window-already-exists" | undefined;
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockTherapist(client, therapistId);
      if (body.action === "service") {
        const duration = requireInteger(
          body.duration,
          "Trajanje seanse (5–240 min)",
          5,
          240,
        );
        const price = requireSessionPrice(body.price);
        const name = requireText(body.name, "Naziv seanse", 120);
        if (body.serviceId) {
          // Mijenjamo tačno jednu vlastitu uslugu; trajanje i cijena istorijskih zahtjeva ostaju sačuvani.
          const updated = await client.query(
            "UPDATE services SET name_mne=$3,name_en=$3,duration_minutes=$4,price_eur=$5 WHERE therapist_id=$1 AND (id::text=$2 OR public_id=$2) AND is_active RETURNING id",
            [
              therapistId,
              requireText(body.serviceId, "Seansa", 100),
              name,
              duration,
              price,
            ],
          );
          if (!updated.rowCount)
            throw new NotFoundException("Seansa nije pronađena.");
        } else {
          await client.query(
            "INSERT INTO services (therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,$2,$3,$4,$5)",
            [therapistId, name, name, duration, price],
          );
        }
      } else if (body.action === "remove-service") {
        const updated = await client.query(
          "UPDATE services SET is_active=false WHERE therapist_id=$1 AND (id::text=$2 OR public_id=$2) AND is_active RETURNING id",
          [therapistId, requireText(body.serviceId, "Seansa", 100)],
        );
        if (!updated.rowCount)
          throw new NotFoundException("Seansa nije pronađena.");
      } else if (body.action === "window") {
        const range = requireTimeRange(body);
        const day = requireInteger(body.weekday, "Dan", 0, 6);
        const profile = (await this.directory.list(client, therapistId))[0];
        if (!profile) throw new NotFoundException("Profil nije dostupan.");
        if (body.id !== undefined) {
          const id = requireText(body.id, "Interval", 36);
          if (!profile.availability.some((window) => window.id === id))
            throw new NotFoundException("Interval nije pronađen.");
          // Provjeravamo cijeli budući raspored bez stare verzije upravo izmijenjenog intervala.
          validateWindows([
            ...profile.availability.filter((window) => window.id !== id),
            { id, weekday: day, ...range },
          ]);
          await client.query(
            "UPDATE availability_windows SET weekday=$3,start_minute=$4,end_minute=$5 WHERE id::text=$1 AND therapist_id=$2 AND is_active",
            [id, therapistId, day, range.start, range.end],
          );
        } else {
          // Provjera se izvršava poslije zaključavanja, pa ni dva paralelna klika ne prave duplikat.
          for (const window of profile.availability) {
            if (
              window.weekday === day &&
              window.start === range.start &&
              window.end === range.end
            ) {
              notice = "window-already-exists";
              break;
            }
          }
          if (!notice) {
            validateWindows([
              ...profile.availability,
              { id: "new", weekday: day, ...range },
            ]);
            await client.query(
              "INSERT INTO availability_windows (therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,$3,$4)",
              [therapistId, day, range.start, range.end],
            );
          }
        }
      } else if (body.action === "date-availability") {
        const date = requireBookingDate(body.date);
        if (body.working !== "true" && body.working !== "false")
          throw new BadRequestException("Izaberite da li radite tog datuma.");
        const working = body.working === "true";
        const range = working ? requireTimeRange(body) : null;
        if (body.id !== undefined) {
          const updated = await client.query(
            `UPDATE availability_dates SET work_date=$3,is_working=$4,start_minute=$5,end_minute=$6,updated_at=now()
             WHERE id::text=$1 AND therapist_id=$2 AND is_active RETURNING id`,
            [
              requireText(body.id, "Datum rasporeda", 36),
              therapistId,
              date,
              working,
              range?.start ?? null,
              range?.end ?? null,
            ],
          );
          if (!updated.rowCount)
            throw new NotFoundException("Datum rasporeda nije pronađen.");
        } else {
          await client.query(
            "INSERT INTO availability_dates (therapist_id,work_date,is_working,start_minute,end_minute) VALUES ($1,$2,$3,$4,$5)",
            [
              therapistId,
              date,
              working,
              range?.start ?? null,
              range?.end ?? null,
            ],
          );
        }
      } else if (body.action === "remove-date") {
        const updated = await client.query(
          "UPDATE availability_dates SET is_active=false,updated_at=now() WHERE id::text=$1 AND therapist_id=$2 AND is_active RETURNING id",
          [requireText(body.id, "Datum rasporeda", 36), therapistId],
        );
        if (!updated.rowCount)
          throw new NotFoundException("Datum rasporeda nije pronađen.");
      } else if (body.action === "remove-window") {
        const result = await client.query(
          "UPDATE availability_windows SET is_active=false WHERE id::text=$1 AND therapist_id=$2 AND is_active",
          [requireText(body.id, "Interval", 36), therapistId],
        );
        if (!result.rowCount)
          throw new NotFoundException("Interval nije pronađen.");
      } else throw new BadRequestException("Nepoznata izmjena rasporeda.");
      // Novo radno vrijeme može otvoriti termin; starije prijave imaju prednost prije javnog zakazivanja.
      await this.waitlist?.allocate(client, therapistId);
      await client.query("COMMIT");
      this.notifications.wake();
    } catch (failure) {
      await client.query("ROLLBACK");
      this.throwBookingError(failure);
    } finally {
      client.release();
    }
    const schedule = await this.schedule(token);
    return { ...schedule, notice };
  }

  /** Javno vraća samo slobodne/zauzete početke; imena i kontakt klijenata nikad nijesu dio odgovora. */
  async slots(identifier: string, durationValue: unknown, dateValue: unknown) {
    const date = requireBookingDate(dateValue);
    const duration = requireInteger(
      durationValue,
      "Trajanje seanse (5–240 min)",
      5,
      240,
    );
    await this.repository.expireWaiting();
    await this.recurring?.refreshTherapist(identifier);
    await this.waitlist?.refreshTherapist(identifier);
    const client = await this.database.pool.connect();
    try {
      // I javni prikaz koristi isti snimak profila i zauzetosti; upis ipak ponavlja sve provjere.
      // Dopuna se završava prije read-only snimka, pa novi stalni termin odmah izgleda zauzeto.
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const therapist = (await this.directory.list(client, identifier))[0];
      if (!therapist || !therapist.acceptingClients)
        throw new NotFoundException("Zakazivanje nije dostupno.");
      const identity = await client.query<{ id: string }>(
        "SELECT id FROM therapists WHERE id::text=$1 OR public_id=$1",
        [identifier],
      );
      const bookings = await this.repository.list(client, identity.rows[0].id);
      const free = availableStarts(therapist, date, duration, bookings);
      const baseline = availableStarts(
        { ...therapist, blocked: [] },
        date,
        duration,
        [],
      );
      // Kod 40/50 minuta slobodan period može početi u 09:40/09:50. Stari početak 10:00 ne označavamo lažno zauzetim ako nije dio novog koraka.
      const busyRanges: { start: number; end: number }[] = [];
      for (const booking of bookings)
        if (booking.date === date && blocksTime(booking))
          busyRanges.push(booking);
      for (const block of therapist.blocked)
        if (block.date === date) busyRanges.push(block);
      const candidates = [...free];
      for (const start of baseline) {
        if (candidates.includes(start)) continue;
        for (const range of busyRanges) {
          if (overlaps({ start, end: start + duration }, range)) {
            candidates.push(start);
            break;
          }
        }
      }
      const valid = await this.validStarts(client, date, duration, candidates);
      const slots = valid
        .sort((first, second) => first - second)
        .map((start) => ({
          start,
          end: start + duration,
          available: free.includes(start),
        }));
      await client.query("COMMIT");
      // Pacijentu razlikujemo zatvoren datum od radnog dana koji nema slobodnih termina.
      const dayOff = therapist.dateAvailability.some(
        (availability) => availability.date === date && !availability.working,
      );
      return { date, duration, slots, dayOff };
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Koraci zakazivanja: identitet → zaključavanje → nova provjera → zahtjev i istorija → COMMIT. */
  async create(token: string | undefined, value: unknown) {
    const user = await this.auth.getAccount(token);
    if (user.role !== "CLIENT")
      throw new ForbiddenException("Termin zakazuje prijavljeni pacijent.");
    await this.auth.limitAttempts(`booking:${user.id}`, 30, 900);
    const body = requireBody(value);
    const identifier = requireText(body.therapistId, "Terapeut", 100);
    const date = requireBookingDate(body.date);
    const start = requireInteger(body.start, "Početak", 0, 1439);
    await this.repository.expireWaiting();
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.lockTherapist(client, identifier);
      await this.recurring?.fillForTherapist(client, therapistId);
      await this.waitlist?.allocate(client, therapistId);
      const therapist = (await this.directory.list(client, therapistId))[0];
      if (!therapist) throw new NotFoundException("Terapeut nije dostupan.");
      const serviceId = requireText(body.serviceId, "Seansa", 100);
      const service = therapist.services.find(
        (service) => service.id === serviceId && service.active,
      );
      if (!service)
        throw new BadRequestException("Izaberite aktivnu vrstu seanse.");
      // Ako je terapeut promijenio trajanje dok je formular otvoren, klijent ponovo bira ažuriranu seansu.
      if (
        body.duration !== undefined &&
        requireInteger(body.duration, "Trajanje", 5, 240) !== service.duration
      )
        throw new ConflictException(
          "Trajanje seanse je promijenjeno. Osvježite izbor seanse i izaberite termin ponovo.",
        );
      const current = await this.repository.list(client, therapistId);
      const booking = requestBooking(
        therapist,
        {
          serviceId,
          date,
          start,
          clientName: `${user.firstName} ${user.lastName}`.trim(),
          clientEmail: user.email,
          clientPhone: requireText(body.phone, "Telefon", 30),
        },
        current,
        new Date(),
        randomUUID(),
      );
      if (
        !(await this.validStarts(client, date, booking.duration, [start]))
          .length
      )
        throw new ConflictException(
          "Vrijeme više nije dostupno ili prelazi promjenu sata.",
        );
      const serviceRow = await client.query<{ id: string }>(
        "SELECT id FROM services WHERE therapist_id=$1 AND (id::text=$2 OR public_id=$2)",
        [therapistId, serviceId],
      );
      await client.query(
        `INSERT INTO booking_requests (id,client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,price_eur_snapshot,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,($11::date+$12*interval '1 minute') AT TIME ZONE 'Europe/Podgorica',($11::date+$13*interval '1 minute') AT TIME ZONE 'Europe/Podgorica')`,
        [
          booking.id,
          user.id,
          therapistId,
          serviceRow.rows[0].id,
          booking.serviceName,
          booking.duration,
          booking.price,
          booking.clientName,
          booking.clientEmail,
          booking.clientPhone,
          date,
          start,
          booking.end,
        ],
      );
      await this.repository.recordEvent(client, booking, user.id);
      // Email događaj je dio istog upisa; prije COMMIT-a ne smije se poslati nikakva poruka.
      await this.notifications.queue(
        client,
        booking.id,
        "booking-requested",
        "THERAPIST",
      );
      await client.query("COMMIT");
      this.notifications.wake();
      return { booking };
    } catch (failure) {
      await client.query("ROLLBACK");
      this.throwBookingError(failure);
    } finally {
      client.release();
    }
  }

  /** Vraća samo rezervacije trenutnog pacijenta ili vlastitog terapeuta, uključujući istoriju. */
  async list(token: string | undefined) {
    const user = await this.auth.getAccount(token);
    await this.repository.expireWaiting();
    await this.recurring?.refreshForUser(user);
    await this.waitlist?.refreshForUser(user);
    const series = this.recurring ? await this.recurring.listForUser(user) : [];
    const waitlist = this.waitlist ? await this.waitlist.listForUser(user) : [];
    if (user.role === "CLIENT")
      return {
        series,
        waitlist,
        bookings: await this.repository.list(
          this.database.pool,
          undefined,
          user.id,
        ),
      };
    return {
      series,
      waitlist,
      bookings: await this.repository.list(
        this.database.pool,
        await this.ownTherapist(user),
      ),
    };
  }

  /** Zaključava postojeći zahtjev; A → B, promjena statusa i istorija pripadaju jednoj transakciji. */
  async respond(token: string | undefined, id: string, value: unknown) {
    const user = await this.auth.getAccount(token);
    const body = requireBody(value);
    await this.repository.expireWaiting();
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const identity = await client.query<{ therapist_id: string }>(
        "SELECT therapist_id FROM booking_requests WHERE id::text=$1",
        [id],
      );
      if (!identity.rows[0])
        throw new NotFoundException("Zahtjev nije pronađen.");
      const therapistId = await this.lockTherapist(
        client,
        identity.rows[0].therapist_id,
      );
      // Predlog drugog vremena takođe mora vidjeti upravo dospjele stalne termine.
      await this.recurring?.fillForTherapist(client, therapistId);
      await this.waitlist?.allocate(client, therapistId);
      await client.query(
        "SELECT id FROM booking_requests WHERE id::text=$1 FOR UPDATE",
        [id],
      );
      const bookings = await this.repository.list(client, therapistId);
      const original = bookings.find((booking) => booking.id === id)!;
      if (user.role === "CLIENT") {
        if (original.clientUserId !== user.id)
          throw new ForbiddenException("Ovaj zahtjev nije vaš.");
        if (
          !["cancel", "accept-alternative", "reject-alternative"].includes(
            String(body.action),
          )
        )
          throw new ForbiddenException("Radnja nije dostupna pacijentu.");
      } else {
        const owner = await client.query(
          "SELECT id FROM therapists WHERE id=$1 AND linked_user_id=$2",
          [therapistId, user.id],
        );
        if (
          user.role !== "THERAPIST" ||
          !owner.rowCount ||
          ![
            "confirm",
            "decline",
            "cancel",
            "propose",
            "complete",
            "no-show",
          ].includes(String(body.action))
        )
          throw new ForbiddenException("Radnja nije dostupna ovom nalogu.");
      }
      const reason = body.reason
        ? requireText(body.reason, "Razlog", 500)
        : undefined;
      let updated;
      if (body.action === "propose") {
        const therapist = (await this.directory.list(client, therapistId))[0];
        updated = proposeAlternative(
          original,
          therapist,
          requireBookingDate(body.date),
          requireInteger(body.start, "Početak", 0, 1439),
          bookings,
        );
        if (
          !(
            await this.validStarts(client, updated.date, updated.duration, [
              updated.start,
            ])
          ).length
        )
          throw new ConflictException("Predloženo vrijeme nije dostupno.");
      } else if (body.action === "cancel" && user.role === "THERAPIST")
        updated = cancelByTherapist(original, new Date(), reason);
      else
        updated = respondBooking(
          original,
          body.action as BookingAction,
          new Date(),
          reason,
        );
      await client.query(
        `UPDATE booking_requests SET status=$2::booking_status,start_at=($3::date+$4*interval '1 minute') AT TIME ZONE 'Europe/Podgorica',
        end_at=($3::date+$5*interval '1 minute') AT TIME ZONE 'Europe/Podgorica',updated_at=now(),state_version=state_version+1,
        confirmed_at=CASE WHEN $2::booking_status='CONFIRMED' THEN now() ELSE confirmed_at END,cancelled_at=CASE WHEN $2::booking_status='CANCELLED' THEN now() ELSE cancelled_at END WHERE id=$1`,
        [id, updated.status, updated.date, updated.start, updated.end],
      );
      await this.repository.recordEvent(client, updated, user.id, original);
      // Obavještavamo drugu stranu. Označavanje ishoda seanse ne šalje dodatne emailove.
      const template = this.notificationTemplate(String(body.action));
      if (template)
        await this.notifications.queue(
          client,
          id,
          template,
          user.role === "THERAPIST" ? "CLIENT" : "THERAPIST",
          original,
        );
      // Otkazivanje, odbijanje i A → B oslobađaju vrijeme. Dodjela sljedećem klijentu je u istoj transakciji.
      await this.waitlist?.allocate(client, therapistId);
      await client.query("COMMIT");
      this.notifications.wake();
      return { booking: updated };
    } catch (failure) {
      await client.query("ROLLBACK");
      this.throwBookingError(failure);
    } finally {
      client.release();
    }
  }

  /** Bira samo dogovorene komunikacione događaje; dozvolu za radnju provjeravamo prije upisa. */
  private notificationTemplate(action: string): BookingEmailTemplate | null {
    if (action === "confirm") return "booking-confirmed";
    if (action === "decline") return "booking-declined";
    if (action === "propose") return "booking-proposed";
    if (action === "cancel") return "booking-cancelled";
    if (action === "accept-alternative") return "booking-alternative-accepted";
    if (action === "reject-alternative") return "booking-alternative-rejected";
    return null;
  }
}
