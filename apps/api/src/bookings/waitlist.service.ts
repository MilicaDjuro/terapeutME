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
import type { Pool, PoolClient } from "pg";
import {
  addDays,
  availableStarts,
  blocksTime,
  dateKey,
  overlaps,
  requestBooking,
  weekday,
  type Booking,
} from "@terapeut/domain";
import { DatabaseService } from "../database.service";
import { AuthService } from "../auth/auth.service";
import type { AccountUser } from "../auth/auth.types";
import {
  requireBody,
  requireText,
  requireOnlineChoice,
} from "../auth/auth.validation";
import { DirectoryService } from "../directory/directory.service";
import { BookingRepository } from "./booking.repository";
import { BookingNotificationService } from "../notifications/booking-notification.service";
import {
  requireBookingDate,
  requireInteger,
  requireTimeRange,
} from "./booking.validation";

interface WaitingEntry {
  online: boolean;
  id: string;
  client_user_id: string;
  service_id: string;
  service_identifier: string;
  duration_minutes: number;
  price: number | null;
  phone: string;
  first_date: string;
  last_date: string;
  weekdays: number[];
  start_minute: number;
  end_minute: number;
  exact_time: boolean;
  full_name: string;
  email: string;
  available_account: boolean;
}

/** Čuva red prijava i dodjeljuje jednu potvrđenu seansu po prijavi, pod lock-om terapeuta. */
@Injectable()
export class WaitlistService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaitlistService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;

  /** Koristi postojeću istoriju i email outbox; slanje počinje tek poslije COMMIT-a. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DirectoryService) private readonly directory: DirectoryService,
    @Inject(BookingRepository) private readonly repository: BookingRepository,
    @Inject(BookingNotificationService)
    private readonly notifications: BookingNotificationService,
  ) {}

  /** Nastavlja obradu poslije restarta i bez otvorene aplikacije klijenta. */
  onModuleInit() {
    this.timer = setInterval(() => this.wake(), 30000);
    this.timer.unref();
    this.wake();
  }

  /** Zaustavlja timer i sačeka aktivnu obradu prije zatvaranja baze. */
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Ne pokreće dvije lokalne obrade; više API instanci štiti isti SQL lock profila. */
  private wake() {
    if (this.stopping || this.running) return;
    this.running = this.refreshAll()
      .catch(() => {
        this.logger.error(
          "Obrada liste čekanja nije uspjela; prijave ostaju u bazi za novi pokušaj.",
        );
      })
      .finally(() => {
        this.running = null;
      });
  }

  /** Obrađuje aktivne liste; kvar jednog terapeuta ne zaustavlja ostale. */
  async refreshAll() {
    const profiles = await this.database.pool.query<{ therapist_id: string }>(
      "SELECT DISTINCT therapist_id FROM booking_waitlist WHERE status='WAITING'",
    );
    for (const profile of profiles.rows) {
      if (this.stopping) break;
      try {
        await this.refreshTherapist(profile.therapist_id);
      } catch {
        this.logger.error(
          "Dodjela kod jednog terapeuta nije uspjela; redosljed ostaje sačuvan.",
        );
      }
    }
  }

  /** Zaključava profil prije dodjele; koristi se i prije javnog prikaza slobodnih termina. */
  async refreshTherapist(identifier: string) {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.lockTherapist(client, identifier);
      await this.allocate(client, therapistId);
      await client.query("COMMIT");
      this.notifications.wake();
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Sve radnje prvo zaključavaju terapeuta, a tek zatim red čekanja, istim redosljedom. */
  private async lockTherapist(client: PoolClient, identifier: string) {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM therapists WHERE id::text=$1 OR public_id=$1 FOR UPDATE",
      [identifier],
    );
    if (!result.rows[0]) throw new NotFoundException("Terapeut nije pronađen.");
    return result.rows[0].id;
  }

  /** Dodaje saglasnost za jednu automatsku rezervaciju; ponovljen isti unos ne mijenja mjesto u redu. */
  async join(token: string | undefined, value: unknown) {
    const user = await this.auth.getAccount(token);
    if (user.role !== "CLIENT")
      throw new ForbiddenException(
        "Listi čekanja pristupa prijavljeni klijent.",
      );
    await this.auth.limitAttempts(`waitlist:${user.id}`, 30, 900);
    const body = requireBody(value);
    const requestId = requireText(body.requestId, "Oznaka prijave", 36);
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        requestId,
      )
    )
      throw new BadRequestException(
        "Oznaka prijave nije ispravna. Osvježite formular.",
      );
    if (body.consent !== "true")
      throw new BadRequestException(
        "Potvrdite automatsko zakazivanje oslobođenog termina.",
      );
    if (body.mode !== "exact" && body.mode !== "flexible")
      throw new BadRequestException("Izaberite način čekanja.");
    const firstDate = requireBookingDate(body.firstDate);
    const lastDate = requireBookingDate(body.lastDate);
    if (lastDate < firstDate)
      throw new BadRequestException(
        "Krajnji datum mora biti poslije početnog.",
      );
    const range = requireTimeRange(body);
    const phone = requireText(body.phone, "Telefon", 30);
    if (
      !/^[+\d\s()-]+$/.test(phone) ||
      phone.replace(/\D/g, "").length < 6 ||
      phone.replace(/\D/g, "").length > 15
    )
      throw new BadRequestException("Unesite ispravan broj telefona.");
    const weekdays: number[] = [];
    const dayValues = requireText(body.weekdays, "Dani u sedmici", 13).split(
      ",",
    );
    for (const value of dayValues) {
      const day = requireInteger(value, "Dan", 0, 6);
      if (!weekdays.includes(day)) weekdays.push(day);
    }
    weekdays.sort();
    let matchingDay = false;
    for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
      if (weekdays.includes(weekday(date))) matchingDay = true;
    }
    if (!matchingDay)
      throw new BadRequestException("Izabrani period ne sadrži označene dane.");
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.lockTherapist(
        client,
        requireText(body.therapistId, "Terapeut", 100),
      );
      const previous = await client.query<{ id: string }>(
        "SELECT id FROM booking_waitlist WHERE client_user_id=$1 AND request_id=$2",
        [user.id, requestId],
      );
      if (previous.rows[0]) {
        const entry = (await this.listForUser(user, client)).find(
          (row) => row.id === previous.rows[0].id,
        );
        await client.query("COMMIT");
        return { waitlistEntry: entry };
      }
      const profile = (await this.directory.list(client, therapistId))[0];
      if (!profile?.acceptingClients)
        throw new BadRequestException("Terapeut trenutno ne prima klijente.");
      const service = profile.services.find(
        (service) => service.id === body.serviceId && service.active,
      );
      if (!service) throw new BadRequestException("Izaberite aktivnu seansu.");
      if (
        requireInteger(body.duration, "Trajanje", 5, 240) !==
          service.duration ||
        String(body.price) !== String(service.price) ||
        requireOnlineChoice(body.online) !== (service.online === true)
      )
        throw new BadRequestException(
          "Seansa je izmijenjena. Osvježite stranicu i provjerite način rada, trajanje i cijenu.",
        );
      const exact = body.mode === "exact";
      if (
        range.end - range.start < service.duration ||
        (exact &&
          (firstDate !== lastDate ||
            range.end !== range.start + service.duration))
      )
        throw new BadRequestException(
          "Cijela seansa mora stati u izabrano vrijeme.",
        );
      const possible = await this.validStarts(
        client,
        lastDate,
        service.duration,
        [range.end - service.duration],
      );
      if (!possible.length)
        throw new BadRequestException(
          "Izaberite buduće vrijeme koje ne prelazi promjenu sata.",
        );
      const count = await client.query(
        "SELECT 1 FROM booking_waitlist WHERE client_user_id=$1 AND status='WAITING'",
        [user.id],
      );
      if (count.rowCount! >= 20)
        throw new BadRequestException(
          "Možete imati najviše 20 aktivnih prijava. Uklonite prijave koje vam ne trebaju.",
        );
      const serviceRow = await client.query<{ id: string }>(
        "SELECT id FROM services WHERE therapist_id=$1 AND (id::text=$2 OR public_id=$2)",
        [therapistId, service.id],
      );
      const entry = await client.query<{ id: string }>(
        `INSERT INTO booking_waitlist(therapist_id,client_user_id,service_id,service_name,duration_minutes,price_eur,phone,first_date,last_date,weekdays,start_minute,end_minute,exact_time,request_id,online)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (client_user_id,therapist_id,service_id,first_date,last_date,weekdays,start_minute,end_minute,exact_time) WHERE status='WAITING'
         DO UPDATE SET phone=booking_waitlist.phone RETURNING id`,
        [
          therapistId,
          user.id,
          serviceRow.rows[0].id,
          service.name,
          service.duration,
          service.price,
          phone,
          firstDate,
          lastDate,
          weekdays,
          range.start,
          range.end,
          exact,
          requestId,
          service.online === true,
        ],
      );
      // Stariji redovi se obrađuju prije novog. Ako već postoji odgovarajuće slobodno vrijeme, dodjela je odmah potvrđena.
      await this.allocate(client, therapistId);
      const saved = (await this.listForUser(user, client)).find(
        (row) => row.id === entry.rows[0].id,
      );
      await client.query("COMMIT");
      this.notifications.wake();
      return {
        waitlistEntry: saved,
      };
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Klijent napušta samo vlastitu aktivnu prijavu; dodijeljena seansa se otkazuje kroz rezervacije. */
  async cancel(token: string | undefined, id: string) {
    const user = await this.auth.getAccount(token);
    if (user.role !== "CLIENT")
      throw new ForbiddenException("Ova radnja je dostupna klijentu.");
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const identity = await client.query<{ therapist_id: string }>(
        "SELECT therapist_id FROM booking_waitlist WHERE id::text=$1 AND client_user_id=$2",
        [id, user.id],
      );
      if (!identity.rows[0])
        throw new NotFoundException("Prijava nije pronađena.");
      await this.lockTherapist(client, identity.rows[0].therapist_id);
      const status = await client.query<{ status: string }>(
        "SELECT status FROM booking_waitlist WHERE id::text=$1",
        [id],
      );
      if (status.rows[0]?.status === "ASSIGNED")
        throw new ConflictException(
          "Termin vam je već dodijeljen. Ako ga ne želite, otkažite seansu u svojim terminima.",
        );
      await client.query(
        "UPDATE booking_waitlist SET status='CANCELLED',finished_at=now() WHERE id::text=$1 AND client_user_id=$2 AND status='WAITING'",
        [id, user.id],
      );
      await client.query("COMMIT");
      return { saved: true };
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Čita samo vlastite prijave klijenta ili liste kod terapeuta koji je vlasnik profila. */
  async listForUser(
    user: AccountUser,
    connection: Pool | PoolClient = this.database.pool,
  ) {
    const result = await connection.query(
      `SELECT w.id,w.status,w.exact_time AS exact,w.weekdays,w.start_minute AS start,w.end_minute AS "end",
       to_char(w.first_date,'YYYY-MM-DD') AS "firstDate",to_char(w.last_date,'YYYY-MM-DD') AS "lastDate",
       w.duration_minutes AS duration,w.price_eur::float8 AS price,w.service_name AS "serviceName",w.online,
       w.assigned_booking_id AS "bookingId",w.created_at AS "createdAt",t.full_name AS "therapistName",u.full_name AS "clientName"
       FROM booking_waitlist w JOIN therapists t ON t.id=w.therapist_id LEFT JOIN users u ON u.id=w.client_user_id
       WHERE ($2='CLIENT' AND w.client_user_id=$1) OR ($2='THERAPIST' AND t.linked_user_id=$1)
       ORDER BY (w.status='WAITING') DESC,CASE WHEN w.status='WAITING' THEN w.queue_number END,w.queue_number DESC`,
      [user.id, user.role],
    );
    return result.rows;
  }

  /** Oporavlja samo liste koje ovaj nalog smije vidjeti, prije čitanja privatnog pregleda. */
  async refreshForUser(user: AccountUser) {
    const profiles = await this.database.pool.query<{ therapist_id: string }>(
      `SELECT DISTINCT w.therapist_id FROM booking_waitlist w JOIN therapists t ON t.id=w.therapist_id
       WHERE w.status='WAITING' AND (($2='CLIENT' AND w.client_user_id=$1) OR ($2='THERAPIST' AND t.linked_user_id=$1))`,
      [user.id, user.role],
    );
    for (const profile of profiles.rows)
      await this.refreshTherapist(profile.therapist_id);
  }

  /** Dodjeljuje po broju reda; pozivalac MORA već držati FOR UPDATE lock terapeuta u ovoj transakciji. */
  async allocate(client: PoolClient, therapistId: string) {
    await client.query(
      `UPDATE booking_waitlist SET status='EXPIRED',finished_at=now() WHERE therapist_id=$1 AND status='WAITING'
       AND (last_date<((now() AT TIME ZONE 'Europe/Podgorica')::date) OR
       (last_date= (now() AT TIME ZONE 'Europe/Podgorica')::date AND (last_date+(end_minute-duration_minutes)*interval '1 minute') AT TIME ZONE 'Europe/Podgorica'<=now()))`,
      [therapistId],
    );
    const entries = await client.query<WaitingEntry>(
      `SELECT w.*,w.price_eur::float8 AS price,to_char(w.first_date,'YYYY-MM-DD') AS first_date,to_char(w.last_date,'YYYY-MM-DD') AS last_date,
       COALESCE(s.public_id,s.id::text) AS service_identifier,u.full_name,u.email,
       (u.id IS NOT NULL AND u.role='CLIENT' AND u.verified_at IS NOT NULL AND u.suspended_at IS NULL) AS available_account
       FROM booking_waitlist w JOIN services s ON s.id=w.service_id LEFT JOIN users u ON u.id=w.client_user_id
       WHERE w.therapist_id=$1 AND w.status='WAITING' ORDER BY w.queue_number FOR UPDATE OF w`,
      [therapistId],
    );
    if (!entries.rows.length) return;
    const profile = (await this.directory.list(client, therapistId))[0];
    if (!profile?.acceptingClients) return;
    const bookings = await this.repository.list(client, therapistId);
    for (const entry of entries.rows) {
      const service = profile.services.find(
        (service) => service.id === entry.service_identifier && service.active,
      );
      // Saglasnost važi za izabrano trajanje i cijenu. Izmijenjenu ponudu klijent mora ponovo prihvatiti.
      if (
        !entry.available_account ||
        !service ||
        service.duration !== entry.duration_minutes ||
        service.price !== entry.price ||
        (service.online === true) !== entry.online
      ) {
        await client.query(
          "UPDATE booking_waitlist SET status='UNAVAILABLE',finished_at=now() WHERE id=$1",
          [entry.id],
        );
        continue;
      }
      const clientBookings = await this.repository.list(
        client,
        undefined,
        entry.client_user_id,
      );
      let assigned = false;
      let firstDate = entry.first_date;
      if (firstDate < dateKey()) firstDate = dateKey();
      for (
        let date = firstDate;
        date <= entry.last_date && !assigned;
        date = addDays(date, 1)
      ) {
        if (!entry.weekdays.includes(weekday(date))) continue;
        const starts = availableStarts(
          profile,
          date,
          service.duration,
          bookings,
        ).filter(
          (start) =>
            start >= entry.start_minute &&
            start + service.duration <= entry.end_minute &&
            (!entry.exact_time || start === entry.start_minute),
        );
        const valid = await this.validStarts(
          client,
          date,
          service.duration,
          starts,
        );
        for (const start of valid) {
          const range = { start, end: start + service.duration };
          if (
            clientBookings.some(
              (booking) =>
                booking.date === date &&
                blocksTime(booking) &&
                overlaps(booking, range),
            )
          )
            continue;
          const requested = requestBooking(
            profile,
            {
              serviceId: service.id,
              date,
              start,
              clientName: entry.full_name,
              clientEmail: entry.email,
              clientPhone: entry.phone,
            },
            bookings,
            new Date(),
            randomUUID(),
          );
          const booking: Booking = {
            ...requested,
            status: "CONFIRMED",
            events: [
              {
                at: new Date().toISOString(),
                actor: "system",
                action: "WAITLIST_ASSIGNED",
                from: null,
                to: "CONFIRMED",
              },
            ],
          };
          await client.query(
            `INSERT INTO booking_requests(id,client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,price_eur_snapshot,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status,confirmed_at,online)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,($11::date+$12*interval '1 minute') AT TIME ZONE 'Europe/Podgorica',($11::date+$13*interval '1 minute') AT TIME ZONE 'Europe/Podgorica','CONFIRMED',now(),$14)`,
            [
              booking.id,
              entry.client_user_id,
              therapistId,
              entry.service_id,
              booking.serviceName,
              booking.duration,
              booking.price,
              booking.clientName,
              booking.clientEmail,
              booking.clientPhone,
              date,
              start,
              booking.end,
              booking.online === true,
            ],
          );
          await this.repository.recordEvent(client, booking, null);
          await client.query(
            "UPDATE booking_waitlist SET status='ASSIGNED',assigned_booking_id=$2,finished_at=now() WHERE id=$1",
            [entry.id, booking.id],
          );
          await this.notifications.queue(
            client,
            booking.id,
            "waitlist-assigned",
            "CLIENT",
          );
          await this.notifications.queue(
            client,
            booking.id,
            "waitlist-assigned",
            "THERAPIST",
          );
          bookings.push({
            ...booking,
            clientUserId: entry.client_user_id,
            internalTherapistId: therapistId,
            therapistName: profile.name,
            rating: null,
            canRate: false,
          });
          assigned = true;
          break;
        }
      }
    }
  }

  /** SQL provjerava stvarni lokalni sat i trajanje pri prelasku na ljetnje/zimsko vrijeme. */
  private async validStarts(
    client: PoolClient,
    date: string,
    duration: number,
    starts: number[],
  ) {
    const result = await client.query<{ start: number }>(
      `SELECT minute AS start FROM unnest($1::int[]) minute
       CROSS JOIN LATERAL (SELECT ($2::date+minute*interval '1 minute') AT TIME ZONE 'Europe/Podgorica' AS instant) times
       WHERE instant>now() AND instant AT TIME ZONE 'Europe/Podgorica'=$2::date+minute*interval '1 minute'
       AND (instant+$3*interval '1 minute') AT TIME ZONE 'Europe/Podgorica'=$2::date+(minute+$3)*interval '1 minute' ORDER BY minute`,
      [starts, date, duration],
    );
    return result.rows.map((row) => row.start);
  }
}
