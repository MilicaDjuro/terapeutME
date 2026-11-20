import "./config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

/** Priprema praznu bazu ili nadograđuje postojeću; ne briše podatke i ne uvozi demo naloge. */
async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error("Nedostaje DATABASE_URL.");
  // Jedna konekcija drži session lock do zatvaranja pool-a, pa paralelni restart ne pokreće istu migraciju dvaput.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  try {
    await pool.query(
      "SELECT pg_advisory_lock(hashtextextended(current_schema()||':schema-migrations',0))",
    );
    // Samo prazna šema dobija početne tabele. Postojeću bazu mijenjaju isključivo dodatne migracije.
    const tables = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=current_schema()",
    );
    if (tables.rowCount === 0) {
      const schema = await readFile(
        resolve(__dirname, "../../../db/schema.sql"),
        "utf8",
      );
      await pool.query(schema);
      console.log("Početna šema je kreirana bez demo podataka.");
    }
    for (const filename of [
      "002-auth.sql",
      "003-therapist-registration.sql",
      "004-directory-photos.sql",
      "005-booking-sessions.sql",
      "006-profile-contact.sql",
      "007-password-reset.sql",
      "008-date-availability.sql",
      "009-booking-notifications.sql",
      "010-recurring-bookings.sql",
      "011-waitlist.sql",
      "012-client-materials.sql",
      "013-profile-analytics.sql",
      "014-profile-view-events.sql",
      "015-therapist-notes.sql",
      "016-session-ratings.sql",
    ]) {
      // Evidentirane migracije ne izvršavamo ponovo: stara 005 ne smije deaktivirati nove seanse od 40/50 minuta.
      const table = await pool.query(
        "SELECT to_regclass(format('%I.schema_migrations',current_schema())) AS migration_table",
      );
      if (table.rows[0].migration_table) {
        const applied = await pool.query(
          "SELECT name FROM schema_migrations WHERE name=$1",
          [filename.replace(".sql", "")],
        );
        if (applied.rowCount) {
          console.log(`Migracija ${filename} je već primijenjena.`);
          continue;
        }
      }
      const sql = await readFile(
        resolve(__dirname, "../../../db/migrations", filename),
        "utf8",
      );
      await pool.query(sql);
      console.log(`Migracija ${filename} je primijenjena.`);
    }
  } finally {
    await pool.end();
  }
}
// Render Free ovo pokreće prije API-ja pri svakom startu; evidentirane migracije se preskaču.
migrate().catch(() => {
  console.error("Migracija nije uspjela. Provjerite bazu i konfiguraciju.");
  process.exitCode = 1;
});
