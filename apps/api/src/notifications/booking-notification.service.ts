import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Booking } from "@terapeut/domain";
import { DatabaseService } from "../database.service";
import { EmailService } from "../auth/email.service";
import { allowedOrigins } from "../config";
import {
  buildBookingEmail,
  type BookingEmailDetails,
  type BookingEmailTemplate,
} from "./booking-email-message";

interface PendingBookingEmail {
  id: string;
  booking_id: string;
  template_key: BookingEmailTemplate;
  payload: BookingEmailDetails & { recipientRole: string };
  recipient_user_id: string | null;
  owner_user_id: string | null;
  expected_version: number;
  current_version: number;
  email: string | null;
  verified_at: Date | null;
  suspended_at: Date | null;
  recipient_role: string | null;
  attempts: number;
}

/** Čuva obavještenje uz rezervaciju i naknadno šalje SMTP poruke iz trajnog reda. */
@Injectable()
export class BookingNotificationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BookingNotificationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private currentBatch: Promise<void> | null = null;
  private stopping = false;

  /** Dijeli postojeću bazu i SMTP; browser ne bira primaoca ni tekst emaila. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  /** Poslije restarta nastavlja neposlate poruke; interval ne zavisi od otvorenog browsera. */
  onModuleInit() {
    this.timer = setInterval(() => this.wake(), 5000);
    this.timer.unref();
    this.wake();
  }

  /** Zaustavlja nove pokušaje i sačeka aktivno slanje prije zatvaranja aplikacije. */
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.currentBatch?.catch(() => undefined);
  }

  /** Koristi istu transakciju kao rezervacija: ROLLBACK uklanja i zahtjev i pripremljeni email. */
  async queue(
    client: PoolClient,
    bookingId: string,
    template: BookingEmailTemplate,
    recipient: "CLIENT" | "THERAPIST",
    previous?: Booking,
  ) {
    await client.query(
      `INSERT INTO notification_outbox (booking_id,recipient_user_id,template_key,deduplication_key,payload,scheduled_at,expected_version)
       SELECT b.id,CASE WHEN $3='THERAPIST' THEN t.linked_user_id ELSE b.client_user_id END,$2,
         'booking:'||b.id::text||':'||b.state_version::text||':'||$3,
         jsonb_build_object('therapistName',t.full_name,'clientName',b.client_name_snapshot,'serviceName',b.service_name_snapshot,
           'date',to_char(b.start_at AT TIME ZONE 'Europe/Podgorica','YYYY-MM-DD'),
           'start',(extract(hour FROM b.start_at AT TIME ZONE 'Europe/Podgorica')*60+extract(minute FROM b.start_at AT TIME ZONE 'Europe/Podgorica'))::int,
           'end',(extract(hour FROM b.start_at AT TIME ZONE 'Europe/Podgorica')*60+extract(minute FROM b.start_at AT TIME ZONE 'Europe/Podgorica'))::int+b.duration_minutes,
           'duration',b.duration_minutes,'price',b.price_eur_snapshot,'city',t.city,'address',COALESCE(t.address,''),
           'previousDate',$4::text,'previousStart',$5::int,'recipientRole',$3::text),now(),b.state_version
       FROM booking_requests b JOIN therapists t ON t.id=b.therapist_id
       WHERE b.id=$1 AND CASE WHEN $3='THERAPIST' THEN t.linked_user_id ELSE b.client_user_id END IS NOT NULL
       ON CONFLICT (deduplication_key) DO NOTHING`,
      [
        bookingId,
        template,
        recipient,
        previous?.date ?? null,
        previous?.start ?? null,
      ],
    );
  }

  /** Poziva se tek poslije COMMIT-a; SMTP greška ne pretvara sačuvanu rezervaciju u neuspjeh. */
  wake() {
    if (this.stopping) return;
    void this.processPending().catch(() => {
      this.logger.error(
        "Obrada booking email reda nije uspjela; red ostaje u bazi za ponovni pokušaj.",
      );
    });
  }

  /** Jedna instanca ne pokreće dvije serije istovremeno; javna metoda olakšava izolovane testove. */
  processPending(): Promise<void> {
    // Red ostaje netaknut dok korisnik ne uključi dostavu; nema lažnog sent_at ni trošenja retry pokušaja.
    if (this.stopping || this.email.mode === "disabled")
      return Promise.resolve();
    if (this.currentBatch) return this.currentBatch;
    this.currentBatch = this.deliverBatch().finally(() => {
      this.currentBatch = null;
    });
    return this.currentBatch;
  }

  /** Session lock dozvoljava samo jednom API procesu slanje iz iste šeme, bez duge SQL transakcije. */
  private async deliverBatch() {
    const client = await this.database.pool.connect();
    let locked = false;
    let broken = false;
    try {
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended(current_schema()||':booking-email-worker',0)) AS locked",
      );
      locked = lock.rows[0].locked;
      if (!locked) return;
      const pending = await client.query<{ id: string }>(
        `SELECT id FROM notification_outbox WHERE sent_at IS NULL AND skipped_at IS NULL AND scheduled_at<=now()
         AND template_key IN ('booking-requested','booking-confirmed','booking-declined','booking-proposed','booking-cancelled','booking-alternative-accepted','booking-alternative-rejected','waitlist-assigned')
         ORDER BY created_at,id LIMIT 20`,
      );
      for (const row of pending.rows) {
        if (this.stopping) break;
        await this.deliverOne(client, row.id);
      }
    } catch (failure) {
      broken = true;
      throw failure;
    } finally {
      if (locked && !broken) {
        try {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended(current_schema()||':booking-email-worker',0))",
          );
        } catch {
          broken = true;
        }
      }
      // Konekcija sa neoslobođenim lock-om nikad se ne vraća drugim korisnicima pool-a.
      client.release(
        broken
          ? new Error("Booking email worker connection closed.")
          : undefined,
      );
    }
  }

  /** Ponovo provjerava primaoca i verziju neposredno prije SMTP-a; zastarjela poruka se preskače. */
  private async deliverOne(client: PoolClient, id: string) {
    const result = await client.query<PendingBookingEmail>(
      `SELECT n.id,n.booking_id,n.template_key,n.payload,n.expected_version,n.attempts,b.state_version AS current_version,
        u.email,u.verified_at,u.suspended_at,u.role AS recipient_role,n.recipient_user_id,
        CASE WHEN n.payload->>'recipientRole'='THERAPIST' THEN t.linked_user_id ELSE b.client_user_id END AS owner_user_id
       FROM notification_outbox n JOIN booking_requests b ON b.id=n.booking_id
       JOIN therapists t ON t.id=b.therapist_id
       LEFT JOIN users u ON u.id=n.recipient_user_id
       WHERE n.id=$1 AND n.sent_at IS NULL AND n.skipped_at IS NULL`,
      [id],
    );
    const message = result.rows[0];
    if (!message) return;
    let skippedReason = "";
    if (message.expected_version !== message.current_version)
      skippedReason = "BOOKING_CHANGED";
    if (
      !message.email ||
      !message.verified_at ||
      message.suspended_at ||
      message.recipient_role !== message.payload.recipientRole ||
      message.recipient_user_id !== message.owner_user_id
    )
      skippedReason = "RECIPIENT_UNAVAILABLE";
    if (skippedReason) {
      await client.query(
        "UPDATE notification_outbox SET skipped_at=now(),skipped_reason=$2 WHERE id=$1",
        [id, skippedReason],
      );
      return;
    }
    await client.query(
      "UPDATE notification_outbox SET attempts=attempts+1,last_error=NULL WHERE id=$1",
      [id],
    );
    const path =
      message.recipient_role === "THERAPIST" ? "/dashboard" : "/account";
    const link = new URL(path, allowedOrigins()[0]);
    link.hash = `booking-${message.booking_id}`;
    const content = buildBookingEmail(
      message.template_key,
      message.payload,
      link.toString(),
    );
    try {
      await this.email.sendBookingNotification(
        message.email!,
        content.subject,
        content.text,
        message.id,
      );
    } catch (failure) {
      // Čuvamo samo bezbjednu oznaku greške, bez email sadržaja, kontakta ili SMTP lozinke.
      const errorCode = this.emailFailureCode(failure);
      const delay = Math.min(3600, 30 * 2 ** Math.min(message.attempts, 7));
      await client.query(
        "UPDATE notification_outbox SET last_error=$2,scheduled_at=now()+$3*interval '1 second' WHERE id=$1",
        [id, errorCode, delay],
      );
      this.logger.warn(
        `Booking email ${id}: ${errorCode}; novi pokušaj za ${delay}s.`,
      );
      return;
    }
    // sent_at znači da je SMTP prihvatio poruku; ne predstavlja potvrdu da ju je osoba pročitala.
    await client.query(
      "UPDATE notification_outbox SET sent_at=now(),last_error=NULL WHERE id=$1",
      [id],
    );
  }

  /** Prevodi samo poznate SMTP kodove u dijagnostiku; sirova greška može sadržati privatne podatke. */
  private emailFailureCode(failure: unknown): string {
    if (failure && typeof failure === "object" && "code" in failure) {
      if (failure.code === "RESEND_SEND_FAILED") return "RESEND_SEND_FAILED";
      if (failure.code === "EAUTH") return "SMTP_AUTH_FAILED";
      if (
        ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(
          String(failure.code),
        )
      )
        return "SMTP_CONNECTION_FAILED";
      if (failure.code === "EENVELOPE" || failure.code === "EMESSAGE")
        return "SMTP_REJECTED";
    }
    return "SMTP_SEND_FAILED";
  }
}
