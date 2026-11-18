import "../src/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";

const executeFile = promisify(execFile);

test(
  "deploy migracije pripremaju praznu šemu, čuvaju nove seanse i preskaču primijenjene korake",
  { skip: !process.env.AUTH_TEST_DATABASE_URL },
  async () => {
    const admin = new Pool({
      connectionString: process.env.AUTH_TEST_DATABASE_URL,
    });
    const schemaName = `migration_test_${randomUUID().replaceAll("-", "")}`;
    const databaseAddress = new URL(process.env.AUTH_TEST_DATABASE_URL!);
    databaseAddress.searchParams.set(
      "options",
      `-c search_path=${schemaName},public`,
    );
    const isolated = new Pool({ connectionString: databaseAddress.toString() });
    try {
      // Svi upisi idu u nasumičnu testnu šemu; postojeći nalozi i rezervacije se ne diraju.
      await admin.query(`CREATE SCHEMA ${schemaName}`);
      const migrationArguments = [
        require.resolve("tsx/cli"),
        resolve(__dirname, "../src/migrate.ts"),
      ];
      const migrationOptions = {
        env: { ...process.env, DATABASE_URL: databaseAddress.toString() },
        windowsHide: true,
        timeout: 30000,
      };
      await executeFile(process.execPath, migrationArguments, migrationOptions);
      const migrations = await isolated.query(
        "SELECT name FROM schema_migrations",
      );
      assert.equal(migrations.rowCount, 13);
      const users = await isolated.query("SELECT id FROM users");
      assert.equal(users.rowCount, 0);
      const therapist = await isolated.query(
        "INSERT INTO therapists(full_name,title_mne,title_en,city) VALUES('Migration test','Terapeut','Therapist','Podgorica') RETURNING id",
      );
      await isolated.query(
        "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes) VALUES($1,'Seansa','Session',40)",
        [therapist.rows[0].id],
      );
      await executeFile(process.execPath, migrationArguments, migrationOptions);
      const services = await isolated.query(
        "SELECT duration_minutes,is_active FROM services",
      );
      assert.deepEqual(services.rows, [
        { duration_minutes: 40, is_active: true },
      ]);
      const repeatedMigrations = await isolated.query(
        "SELECT name FROM schema_migrations",
      );
      assert.equal(repeatedMigrations.rowCount, 13);
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await admin.end();
    }
  },
);
