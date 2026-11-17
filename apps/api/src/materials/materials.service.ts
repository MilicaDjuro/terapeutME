import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database.service";
import { AuthService } from "../auth/auth.service";
import type { AccountUser } from "../auth/auth.types";
import { requireBody, requireText } from "../auth/auth.validation";
import { requireInteger } from "../bookings/booking.validation";
import {
  validateMaterial,
  validateMaterialFile,
  type MaterialUpload,
} from "./materials.validation";

interface StoredMaterial {
  id: string;
  file_name: string | null;
  file_data: Buffer | null;
  version: number;
}

/** Čuva i čita privatne zadatke; ID dokumenta ili klijenta nikada nije dokaz pristupa. */
@Injectable()
export class MaterialsService {
  /** Koristi postojeću JWT provjeru i PostgreSQL, kao profili i privatne rezervacije. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Vraća samo vlasnikov profil; za upis zaključava isti red kao raspored i rezervacije. */
  private async therapistId(user: AccountUser, client?: PoolClient) {
    if (user.role !== "THERAPIST")
      throw new ForbiddenException("Materijale dodaje i uređuje terapeut.");
    const connection = client || this.database.pool;
    const result = await connection.query<{ id: string }>(
      `SELECT id FROM therapists WHERE linked_user_id=$1 ${client ? "FOR UPDATE" : ""}`,
      [user.id],
    );
    if (!result.rows[0])
      throw new ForbiddenException("Profil terapeuta nije dostupan.");
    return result.rows[0].id;
  }

  /** Vezu sa klijentom dokazuje potvrđena ili ranije održana seansa, a ne uneseni email. */
  private async requireClient(
    client: PoolClient,
    therapistId: string,
    clientUserId: string,
  ) {
    const result = await client.query(
      `SELECT u.id FROM users u WHERE u.id::text=$2 AND u.role='CLIENT' AND u.verified_at IS NOT NULL AND u.suspended_at IS NULL
       AND EXISTS (SELECT 1 FROM booking_requests b WHERE b.therapist_id=$1 AND b.client_user_id=u.id
       AND (b.confirmed_at IS NOT NULL OR b.status IN ('CONFIRMED','COMPLETED','NO_SHOW')))`,
      [therapistId, clientUserId],
    );
    if (!result.rowCount)
      throw new ForbiddenException(
        "Izaberite svog klijenta sa potvrđenom ili održanom seansom.",
      );
  }

  /** Čita samo metapodatke i uputstva; PDF bajtovi se učitavaju posebnim zaštićenim pozivom. */
  async list(token: string | undefined) {
    const user = await this.auth.getAccount(token);
    if (!["CLIENT", "THERAPIST"].includes(user.role))
      throw new ForbiddenException(
        "Materijali su dostupni klijentu i njegovom terapeutu.",
      );
    const materials = await this.database.pool.query(
      `SELECT m.id,m.client_user_id AS "clientUserId",m.kind,m.title,m.instructions,m.resource_url AS "resourceUrl",
       to_char(m.due_date,'YYYY-MM-DD') AS "dueDate",m.file_name AS "fileName",m.file_size AS "fileSize",
       m.version,m.created_at AS "createdAt",m.updated_at AS "updatedAt",t.full_name AS "therapistName",u.full_name AS "clientName"
       FROM client_materials m JOIN therapists t ON t.id=m.therapist_id JOIN users u ON u.id=m.client_user_id
       WHERE m.archived_at IS NULL AND (($2='CLIENT' AND m.client_user_id=$1) OR ($2='THERAPIST' AND t.linked_user_id=$1))
       ORDER BY m.created_at DESC,m.id`,
      [user.id, user.role],
    );
    let clients: { id: string; name: string; email: string }[] = [];
    if (user.role === "THERAPIST") {
      const therapistId = await this.therapistId(user);
      const result = await this.database.pool.query<{
        id: string;
        name: string;
        email: string;
      }>(
        `SELECT u.id,u.full_name AS name,u.email FROM users u WHERE u.role='CLIENT' AND u.verified_at IS NOT NULL AND u.suspended_at IS NULL
         AND EXISTS (SELECT 1 FROM booking_requests b WHERE b.therapist_id=$1 AND b.client_user_id=u.id
           AND (b.confirmed_at IS NOT NULL OR b.status IN ('CONFIRMED','COMPLETED','NO_SHOW'))) ORDER BY u.full_name,u.id`,
        [therapistId],
      );
      clients = result.rows;
    }
    return { materials: materials.rows, clients };
  }

  /** Jednom transakcijom čuva tekst i opcioni PDF; izmjena nikada ne mijenja primaoca. */
  async save(
    token: string | undefined,
    value: unknown,
    file?: MaterialUpload,
    id?: string,
  ) {
    const user = await this.auth.getAccount(token);
    if (user.role !== "THERAPIST")
      throw new ForbiddenException("Materijale dodaje i uređuje terapeut.");
    await this.auth.limitAttempts(`materials:${user.id}`, 30, 900);
    const input = validateMaterial(value);
    const uploaded = validateMaterialFile(file);
    if (uploaded && input.removeFile)
      throw new BadRequestException(
        "Izaberite novi prilog ili uklanjanje postojećeg, ne oba.",
      );
    const body = requireBody(value);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.therapistId(user, client);
      let existing: StoredMaterial | undefined;
      if (id) {
        const result = await client.query<StoredMaterial>(
          "SELECT id,file_name,file_data,version FROM client_materials WHERE id::text=$1 AND therapist_id=$2 AND archived_at IS NULL FOR UPDATE",
          [id, therapistId],
        );
        existing = result.rows[0];
        if (!existing) throw new NotFoundException("Materijal nije pronađen.");
        if (
          requireInteger(body.version, "Verzija", 1, 2147483647) !==
          existing.version
        )
          throw new ConflictException(
            "Materijal je u međuvremenu izmijenjen. Osvježite pregled i otvorite novu verziju.",
          );
      } else {
        await this.requireClient(
          client,
          therapistId,
          requireText(body.clientUserId, "Klijent", 36),
        );
      }
      let fileName = existing?.file_name || null;
      let fileData = existing?.file_data || null;
      if (input.removeFile) {
        fileName = null;
        fileData = null;
      }
      if (uploaded) {
        fileName = uploaded.name;
        fileData = uploaded.data;
      }
      if (!input.instructions && !input.resourceUrl && !fileData)
        throw new BadRequestException(
          "Unesite uputstvo, preporučeni link ili priložite PDF.",
        );
      let materialId: string;
      if (existing) {
        await client.query(
          `UPDATE client_materials SET kind=$3,title=$4,instructions=$5,resource_url=$6,due_date=$7,file_name=$8,file_data=$9,file_size=$10,version=version+1,updated_at=now()
           WHERE id=$1 AND therapist_id=$2`,
          [
            existing.id,
            therapistId,
            input.kind,
            input.title,
            input.instructions,
            input.resourceUrl,
            input.dueDate,
            fileName,
            fileData,
            fileData?.length ?? null,
          ],
        );
        materialId = existing.id;
      } else {
        const result = await client.query<{ id: string }>(
          `INSERT INTO client_materials(therapist_id,client_user_id,kind,title,instructions,resource_url,due_date,file_name,file_data,file_size)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            therapistId,
            body.clientUserId,
            input.kind,
            input.title,
            input.instructions,
            input.resourceUrl,
            input.dueDate,
            fileName,
            fileData,
            fileData?.length ?? null,
          ],
        );
        materialId = result.rows[0].id;
      }
      // Uspjeh se vraća tek poslije COMMIT-a; povlačenje zahtjeva u browseru ne poništava sačuvan zadatak.
      await client.query("COMMIT");
      return { saved: true, id: materialId };
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Povlači materijal iz oba pregleda; provjera verzije štiti izmjenu otvorenu u drugom tabu. */
  async archive(token: string | undefined, id: string, value: unknown) {
    const user = await this.auth.getAccount(token);
    const version = requireInteger(
      requireBody(value).version,
      "Verzija",
      1,
      2147483647,
    );
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.therapistId(user, client);
      const found = await client.query<{ version: number }>(
        "SELECT version FROM client_materials WHERE id::text=$1 AND therapist_id=$2 AND archived_at IS NULL FOR UPDATE",
        [id, therapistId],
      );
      if (!found.rows[0])
        throw new NotFoundException("Materijal nije pronađen.");
      if (found.rows[0].version !== version)
        throw new ConflictException(
          "Materijal je izmijenjen. Osvježite pregled prije povlačenja.",
        );
      await client.query(
        "UPDATE client_materials SET archived_at=now(),updated_at=now(),version=version+1 WHERE id::text=$1 AND therapist_id=$2",
        [id, therapistId],
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

  /** Ponovo provjerava vlasništvo pri svakom preuzimanju; privatni PDF nema javnu putanju. */
  async download(token: string | undefined, id: string) {
    const user = await this.auth.getAccount(token);
    const result = await this.database.pool.query<{
      file_name: string;
      file_data: Buffer;
    }>(
      `SELECT m.file_name,m.file_data FROM client_materials m JOIN therapists t ON t.id=m.therapist_id
       WHERE m.id::text=$1 AND m.archived_at IS NULL AND m.file_data IS NOT NULL
       AND (($3='CLIENT' AND m.client_user_id=$2) OR ($3='THERAPIST' AND t.linked_user_id=$2))`,
      [id, user.id, user.role],
    );
    if (!result.rows[0]) throw new NotFoundException("Dokument nije dostupan.");
    return { name: result.rows[0].file_name, data: result.rows[0].file_data };
  }
}
