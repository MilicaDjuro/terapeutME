import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database.service";
import { AuthService } from "../auth/auth.service";
import { requireBody } from "../auth/auth.validation";
import { requireInteger } from "./booking.validation";

/** Čuva jednu ocjenu po završenoj seansi; identitet uvijek uzima iz JWT sesije. */
@Injectable()
export class SessionRatingService {
  /** Koristi postojeću autentifikaciju i bazu, bez dodatnog izvora korisnika. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Zaključava terapeuta pa rezervaciju kao promjena ishoda; ponovljen isti upis ne uvećava zbir. */
  async save(token: string | undefined, bookingId: string, value: unknown) {
    const user = await this.auth.getAccount(token);
    if (user.role !== "CLIENT")
      throw new ForbiddenException("Seansu može ocijeniti samo njen klijent.");
    const body = requireBody(value);
    const score = requireInteger(body.score, "Ocjena (1–5)", 1, 5);
    await this.auth.limitAttempts(`session-rating:${user.id}`, 60, 900);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      // Tuđa ili nepostojeća rezervacija daje isti odgovor, bez otkrivanja klijenta.
      const identity = await client.query<{ therapist_id: string }>(
        "SELECT therapist_id FROM booking_requests WHERE id::text=$1 AND client_user_id=$2",
        [bookingId, user.id],
      );
      if (!identity.rows[0])
        throw new NotFoundException("Seansa nije pronađena.");
      await client.query("SELECT id FROM therapists WHERE id=$1 FOR UPDATE", [
        identity.rows[0].therapist_id,
      ]);
      // Proteklo vrijeme potvrđene seanse otvara ocjenu bez izmjene njenog statusa ili istorije.
      const booking = await client.query<{ eligible: boolean }>(
        `SELECT (status IN ('CONFIRMED','COMPLETED') AND end_at<=clock_timestamp()) AS eligible
         FROM booking_requests WHERE id::text=$1 AND client_user_id=$2 FOR UPDATE`,
        [bookingId, user.id],
      );
      if (!booking.rows[0]?.eligible)
        throw new ConflictException(
          "Ocjena je dostupna nakon završetka vremena potvrđene seanse.",
        );
      const existing = await client.query<{ score: number }>(
        "SELECT score FROM session_ratings WHERE booking_id=$1",
        [bookingId],
      );
      if (existing.rows[0] && existing.rows[0].score !== score)
        throw new ConflictException("Ova seansa je već ocijenjena.");
      if (!existing.rows[0]) {
        // Nema uvećavanja brojača: jedinstveni ključ čuva i od paralelnih klikova.
        await client.query(
          "INSERT INTO session_ratings(booking_id,score) VALUES($1,$2)",
          [bookingId, score],
        );
      }
      await client.query("COMMIT");
      // Tek potvrđen upis smije prikazati uspjeh u formularu.
      return { rating: score };
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }
}
