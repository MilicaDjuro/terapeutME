import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  TherapistClientNote,
  TherapistNoteClient,
} from "@terapeut/domain";
import { DatabaseService } from "../database.service";
import { AuthService } from "../auth/auth.service";
import type { AccountUser } from "../auth/auth.types";
import { requireBody, requireText } from "../auth/auth.validation";
import { requireInteger } from "../bookings/booking.validation";

interface NoteRow extends Omit<TherapistClientNote, "createdAt" | "updatedAt"> {
  createdAt: Date;
  updatedAt: Date;
}
const noteColumns =
  'id,client_user_id AS "clientUserId",title,content,version,created_at AS "createdAt",updated_at AS "updatedAt"';

/** Pretvara datume baze u ISO tekst; vraća samo polja potrebna privatnom prikazu. */
function noteView(row: NoteRow): TherapistClientNote {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Čuva odvojene privatne bilješke; klijent, drugi terapeut i admin nemaju pristup ovom API-ju. */
@Injectable()
export class TherapistNotesService {
  /** Koristi postojeću provjeru JWT sesije; bilješke nijesu dio emaila ili javnog kataloga. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Pronalazi isključivo profil naloga iz sesije; pri upisu prati redosljed zaključavanja rezervacija. */
  private async owner(user: AccountUser, client?: PoolClient) {
    if (user.role !== "THERAPIST")
      throw new ForbiddenException(
        "Privatne bilješke dostupne su samo terapeutu koji ih je napisao.",
      );
    const result = await (client || this.database.pool).query<{ id: string }>(
      `SELECT id FROM therapists WHERE linked_user_id=$1 ${client ? "FOR UPDATE" : ""}`,
      [user.id],
    );
    if (!result.rows[0])
      throw new ForbiddenException("Profil terapeuta nije dostupan.");
    return result.rows[0].id;
  }

  /** Dozvoljava rad samo sa vlastitim klijentom koji ima zahtjev ili termin kod terapeuta. */
  private async requireClient(
    therapistId: string,
    clientUserId: string,
    client?: PoolClient,
  ) {
    const result = await (client || this.database.pool).query(
      `SELECT u.id FROM users u WHERE u.id::text=$2 AND u.role='CLIENT'
       AND EXISTS(SELECT 1 FROM booking_requests b WHERE b.therapist_id=$1 AND b.client_user_id=u.id)`,
      [therapistId, clientUserId],
    );
    if (!result.rowCount)
      throw new ForbiddenException(
        "Izaberite svog klijenta koji ima zahtjev ili termin kod vas.",
      );
  }

  /** Vraća samo vlastite klijente; ne pretražuje globalni imenik korisnika. */
  async clients(token: string | undefined) {
    const user = await this.auth.getAccount(token);
    const therapistId = await this.owner(user);
    const result = await this.database.pool.query<TherapistNoteClient>(
      `SELECT u.id,u.full_name AS name,u.email FROM users u WHERE u.role='CLIENT'
       AND EXISTS(SELECT 1 FROM booking_requests b WHERE b.therapist_id=$1 AND b.client_user_id=u.id)
       ORDER BY u.full_name,u.id`,
      [therapistId],
    );
    return { clients: result.rows };
  }

  /** Čita bilješke samo izabrane vlastite veze terapeut–klijent, uključujući nakon otkazane seanse. */
  async list(token: string | undefined, clientId: unknown) {
    const user = await this.auth.getAccount(token);
    const therapistId = await this.owner(user);
    const clientUserId = requireText(clientId, "Klijent", 36);
    await this.requireClient(therapistId, clientUserId);
    const result = await this.database.pool.query<NoteRow>(
      `SELECT ${noteColumns} FROM therapist_client_notes WHERE therapist_id=$1 AND client_user_id::text=$2 AND archived_at IS NULL ORDER BY created_at DESC,id`,
      [therapistId, clientUserId],
    );
    return { notes: result.rows.map(noteView) };
  }

  /** Čuva novu ili mijenja vlastitu bilješku; klijent se ne mijenja, a verzija sprečava prepisivanje tuđeg taba. */
  async save(token: string | undefined, value: unknown, id?: string) {
    const user = await this.auth.getAccount(token);
    // Ulogu provjeravamo prije čitanja unosa; poznavanje ID-a nikada ne daje pristup.
    if (user.role !== "THERAPIST")
      throw new ForbiddenException(
        "Privatne bilješke uređuje samo njihov terapeut.",
      );
    await this.auth.limitAttempts(`therapist-notes:${user.id}`, 60, 900);
    const body = requireBody(value);
    const clientUserId = requireText(body.clientUserId, "Klijent", 36);
    const title = requireText(body.title, "Naslov", 160);
    const content = requireText(body.content, "Bilješka", 20000);
    if (title.includes("\0") || content.includes("\0"))
      throw new BadRequestException(
        "Bilješka sadrži nedozvoljen kontrolni znak.",
      );
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.owner(user, client);
      let saved;
      if (id) {
        const existing = await client.query<{
          client_user_id: string;
          version: number;
        }>(
          "SELECT client_user_id,version FROM therapist_client_notes WHERE id::text=$1 AND therapist_id=$2 AND archived_at IS NULL FOR UPDATE",
          [id, therapistId],
        );
        const note = existing.rows[0];
        if (!note) throw new NotFoundException("Bilješka nije pronađena.");
        if (note.client_user_id !== clientUserId)
          throw new ForbiddenException(
            "Klijent postojeće bilješke ne može se promijeniti.",
          );
        if (
          requireInteger(body.version, "Verzija", 1, 2147483646) !==
          note.version
        )
          throw new ConflictException(
            "Bilješka je u međuvremenu izmijenjena. Sačuvajte svoj unos i osvježite pregled prije ponovnog uređivanja.",
          );
        saved = await client.query<NoteRow>(
          `UPDATE therapist_client_notes SET title=$3,content=$4,updated_at=now(),version=version+1 WHERE id::text=$1 AND therapist_id=$2 RETURNING ${noteColumns}`,
          [id, therapistId, title, content],
        );
      } else {
        await this.requireClient(therapistId, clientUserId, client);
        saved = await client.query<NoteRow>(
          `INSERT INTO therapist_client_notes(therapist_id,client_user_id,title,content) VALUES($1,$2,$3,$4) RETURNING ${noteColumns}`,
          [therapistId, clientUserId, title, content],
        );
      }
      // Potvrdu vraćamo tek poslije COMMIT-a. Ovaj upis ne stvara materijal ni email obavještenje.
      await client.query("COMMIT");
      return { note: noteView(saved.rows[0]) };
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Arhivira samo vlastitu verziju; zapis ostaje u bazi, ali nestaje iz aktivnog pregleda. */
  async archive(token: string | undefined, id: string, value: unknown) {
    const user = await this.auth.getAccount(token);
    const therapistId = await this.owner(user);
    await this.auth.limitAttempts(`therapist-notes:${user.id}`, 60, 900);
    const body = requireBody(value);
    const version = requireInteger(body.version, "Verzija", 1, 2147483646);
    // Uslovni UPDATE je atomski: paralelna izmjena i arhiviranje ne mogu oboje sačuvati staru verziju.
    const result = await this.database.pool.query(
      `UPDATE therapist_client_notes SET archived_at=now(),updated_at=now(),version=version+1 WHERE id::text=$1 AND therapist_id=$2 AND version=$3 AND archived_at IS NULL RETURNING id`,
      [id, therapistId, version],
    );
    if (!result.rowCount) {
      const existing = await this.database.pool.query(
        "SELECT id FROM therapist_client_notes WHERE id::text=$1 AND therapist_id=$2 AND archived_at IS NULL",
        [id, therapistId],
      );
      if (!existing.rowCount)
        throw new NotFoundException("Bilješka nije pronađena.");
      throw new ConflictException(
        "Bilješka je u međuvremenu izmijenjena. Osvježite pregled prije arhiviranja.",
      );
    }
    return { archived: true };
  }
}
