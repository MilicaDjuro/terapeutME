import "./config";
import { Pool } from "pg";
import { seedDirectory } from "./directory/seed-directory";
import { hashPassword } from "./auth/auth.crypto";

/** Uvozi lokalne probne stručnjake; opcioni reset lozinki odbija za udaljenu ili produkcionu bazu. */
async function importDirectory() {
  const url = new URL(process.env.DATABASE_URL || "");
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Testni nalozi su dozvoljeni samo u lokalnoj razvojnoj bazi.",
    );
  const pool = new Pool({ connectionString: url.toString() });
  try {
    await seedDirectory(pool);
    if (process.argv.includes("--test-passwords")) {
      const passwordHash = await hashPassword("Test123");
      // Korisnik je izričito tražio testnu lozinku: mijenjamo samo povezane terapeutske naloge.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE users SET password_hash=$1,updated_at=now() WHERE role='THERAPIST' AND id IN (SELECT linked_user_id FROM therapists)",
          [passwordHash],
        );
        await client.query(
          "DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE role='THERAPIST' AND id IN (SELECT linked_user_id FROM therapists))",
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    const result = await pool.query<{ full_name: string; email: string }>(
      "SELECT u.full_name,u.email FROM users u JOIN therapists t ON t.linked_user_id=u.id WHERE u.role='THERAPIST' ORDER BY u.full_name",
    );
    for (const row of result.rows)
      console.log(`${row.full_name}: ${row.email}`);
  } finally {
    await pool.end();
  }
}
importDirectory().catch((error) => {
  console.error(error instanceof Error ? error.message : "Uvoz nije uspio.");
  process.exitCode = 1;
});
