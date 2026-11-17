import { config } from "dotenv";
import { resolve } from "node:path";

// npm workspace pokreće API iz apps/api; tajne čitamo iz ignorisanog root .env fajla.
config({ path: resolve(__dirname, "../../../.env"), quiet: true });

/** Provjerava obaveznu serversku konfiguraciju; ne ispisuje tajne. */
export function validateConfiguration() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Nedostaje DATABASE_URL u .env konfiguraciji.");
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    throw new Error("AUTH_SECRET mora sadržati najmanje 32 nasumična znaka.");
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    throw new Error("Nedostaju SMTP_HOST ili SMTP_FROM u .env konfiguraciji.");
  }
  if (
    !Number.isInteger(Number(process.env.SMTP_PORT)) ||
    Number(process.env.SMTP_PORT) < 1
  ) {
    throw new Error("SMTP_PORT mora biti važeći broj porta.");
  }
  if (process.env.NODE_ENV === "production") {
    if (
      process.env.AUTH_EMAIL_MODE !== "smtp" ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASS
    ) {
      throw new Error(
        "Produkcija zahtijeva stvarni SMTP servis i njegove pristupne podatke.",
      );
    }
    if (
      !process.env.WEB_ORIGINS?.split(",").every((origin) =>
        origin.trim().startsWith("https://"),
      )
    ) {
      throw new Error("Produkcioni WEB_ORIGINS mora koristiti HTTPS.");
    }
  }
}

/** Vraća eksplicitno dozvoljene adrese frontenda za CORS i zaštitu od CSRF-a. */
export function allowedOrigins(): string[] {
  return (
    process.env.WEB_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000"
  )
    .split(",")
    .map((origin) => origin.trim());
}
