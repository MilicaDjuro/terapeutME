import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { hashPassword } from "../auth/auth.crypto";
import type { PublicTherapist } from "./directory.types";

/** Uvozi postojeće izmišljene profile samo jednom; ne prepisuje kasnije izmjene ili druge naloge. */
export async function seedDirectory(pool: Pool) {
  // Seed komanda koristi tsx i isti izvor koji koristi demo, bez druge kopije podataka.
  const source = require(
    resolve(__dirname, "../../../../packages/domain/src/seed.ts"),
  ) as { therapists: PublicTherapist[] };
  const passwordHash = await hashPassword("Test123");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('directory-seed',0))",
    );
    for (const therapist of source.therapists) {
      if (
        (
          await client.query("SELECT id FROM therapists WHERE public_id=$1", [
            therapist.id,
          ])
        ).rowCount
      )
        continue;
      const email = `${therapist.id.replaceAll("-", ".")}@example.test`;
      if (
        (
          await client.query("SELECT id FROM users WHERE lower(email)=$1", [
            email,
          ])
        ).rowCount
      )
        throw new Error(
          `Email ${email} je već zauzet; postojeći nalog nije promijenjen.`,
        );
      const nameParts = therapist.name.split(" ");
      const user = await client.query<{ id: string }>(
        "INSERT INTO users (email,password_hash,full_name,first_name,last_name,role,verified_at) VALUES ($1,$2,$3,$4,$5,'THERAPIST',now()) RETURNING id",
        [
          email,
          passwordHash,
          therapist.name,
          nameParts[0],
          nameParts.slice(1).join(" "),
        ],
      );
      const id = randomUUID();
      await client.query(
        `INSERT INTO therapists (id,public_id,linked_user_id,full_name,title_mne,title_en,bio_mne,bio_en,city,address,profession,approaches_mne,approaches_en,languages,education_mne,education_en,is_verified,is_active,accepting_clients,avatar_color)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          id,
          therapist.id,
          user.rows[0].id,
          therapist.name,
          therapist.title,
          therapist.titleEn,
          therapist.bio,
          therapist.bioEn,
          therapist.city,
          therapist.address,
          therapist.profession,
          therapist.approaches,
          therapist.approachesEn,
          therapist.languages,
          therapist.education,
          therapist.educationEn,
          therapist.verified,
          therapist.active,
          therapist.acceptingClients,
          therapist.color,
        ],
      );
      for (const service of therapist.services)
        await client.query(
          "INSERT INTO services (therapist_id,public_id,name_mne,name_en,duration_minutes,price_eur,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [
            id,
            service.id,
            service.name,
            service.nameEn,
            service.duration,
            service.price,
            service.active,
          ],
        );
      for (const window of therapist.availability)
        await client.query(
          "INSERT INTO availability_windows (therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,$3,$4)",
          [id, window.weekday, window.start, window.end],
        );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
