import "../apps/api/src/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, ChildProcess } from "node:child_process";
import { Pool } from "pg";
import { seedDirectory } from "../apps/api/src/directory/seed-directory";

/** Čeka stvarni health endpoint testnog API-ja; ne zamjenjuje neuspjeh fiksnim sleep-om. */
async function waitForApi(url: string, process: ChildProcess) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (process.exitCode !== null)
      throw new Error("Testni API se ugasio prije provjera.");
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* API još učitava konfiguraciju. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Testni API nije spreman.");
}

/** Prati završetak Playwright procesa i prenosi njegov izlaz/grešku. */
function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

/** Kreira izolovanu šemu i API; po završetku briše samo testne naloge i zaustavlja svoj proces. */
async function runAuthBrowserTests() {
  const connectionString =
    process.env.AUTH_TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("Podesite DATABASE_URL i pokrenite Docker bazu.");
  if (process.env.AUTH_EMAIL_MODE !== "local")
    throw new Error(
      "Browser testovi zahtijevaju Mailpit režim; ne šalju stvarne emailove.",
    );
  const admin = new Pool({ connectionString });
  const schemaName = `auth_e2e_${randomUUID().replaceAll("-", "")}`;
  if (!/^auth_e2e_[a-f0-9]{32}$/.test(schemaName))
    throw new Error("Neispravan naziv testne šeme.");
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schemaName},public`);
  const isolated = new Pool({ connectionString: url.toString() });
  let apiProcess: ChildProcess | undefined;
  let schemaCreated = false;
  try {
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    schemaCreated = true;
    await isolated.query(await readFile(resolve("db/schema.sql"), "utf8"));
    await isolated.query(
      await readFile(resolve("db/migrations/002-auth.sql"), "utf8"),
    );
    await isolated.query(
      await readFile(
        resolve("db/migrations/003-therapist-registration.sql"),
        "utf8",
      ),
    );
    await isolated.query(
      await readFile(resolve("db/migrations/004-directory-photos.sql"), "utf8"),
    );
    await seedDirectory(isolated);
    await isolated.query(
      await readFile(resolve("db/migrations/005-booking-sessions.sql"), "utf8"),
    );
    await isolated.query(
      await readFile(resolve("db/migrations/006-profile-contact.sql"), "utf8"),
    );
    await isolated.query(
      await readFile(resolve("db/migrations/007-password-reset.sql"), "utf8"),
    );
    await isolated.query(
      await readFile(
        resolve("db/migrations/008-date-availability.sql"),
        "utf8",
      ),
    );
    await isolated.query(
      await readFile(
        resolve("db/migrations/009-booking-notifications.sql"),
        "utf8",
      ),
    );
    await isolated.query(
      await readFile(
        resolve("db/migrations/010-recurring-bookings.sql"),
        "utf8",
      ),
    );
    await isolated.query(
      await readFile(resolve("db/migrations/011-waitlist.sql"), "utf8"),
    );
    await isolated.query(
      await readFile(resolve("db/migrations/012-client-materials.sql"), "utf8"),
    );
    await isolated.query(
      await readFile(
        resolve("db/migrations/013-profile-analytics.sql"),
        "utf8",
      ),
    );
    await isolated.query(
      await readFile(
        resolve("db/migrations/014-profile-view-events.sql"),
        "utf8",
      ),
    );
    apiProcess = spawn(process.execPath, [resolve("apps/api/dist/main.js")], {
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: url.toString(),
        API_PORT: "4100",
        WEB_ORIGINS: "http://127.0.0.1:3200",
        AUTH_EMAIL_MODE: "local",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1025",
        SMTP_SECURE: "false",
        SMTP_USER: "",
        SMTP_PASS: "",
      },
    });
    await waitForApi("http://127.0.0.1:4100/api/v1/health", apiProcess);
    const playwright = spawn(
      process.execPath,
      [
        require.resolve("@playwright/test/cli"),
        "test",
        "--config",
        "playwright.auth.config.ts",
      ],
      {
        stdio: "inherit",
        windowsHide: true,
        env: {
          ...process.env,
          AUTH_E2E_DATABASE_URL: url.toString(),
          API_ORIGIN: "http://127.0.0.1:4100",
        },
      },
    );
    process.exitCode = await waitForExit(playwright);
  } finally {
    if (apiProcess && apiProcess.exitCode === null) {
      apiProcess.kill();
      await waitForExit(apiProcess);
    }
    await isolated.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
    await admin.end();
  }
}
runAuthBrowserTests().catch(() => {
  console.error(
    "Auth browser provjere nijesu uspjele. Provjerite Docker, Mailpit i API build.",
  );
  process.exitCode = 1;
});
