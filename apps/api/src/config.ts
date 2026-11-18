import { config } from "dotenv";
import { resolve } from "node:path";

// Lokalno čitamo ignorisani root .env; Render vrijednosti iz okruženja imaju prednost.
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
    Number(process.env.SMTP_PORT) < 1 ||
    Number(process.env.SMTP_PORT) > 65535
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
    if (!process.env.WEB_ORIGINS?.trim()) {
      throw new Error("Produkcija zahtijeva WEB_ORIGINS sa adresom frontenda.");
    }
    for (const origin of allowedOrigins()) {
      let address: URL;
      try {
        address = new URL(origin);
      } catch {
        throw new Error("WEB_ORIGINS mora sadržati važeće HTTPS adrese.");
      }
      if (address.protocol !== "https:" || address.origin !== origin) {
        throw new Error(
          "WEB_ORIGINS mora sadržati HTTPS origin bez putanje, završne kose crte ili pristupnih podataka.",
        );
      }
    }
  }
  apiListenAddress();
}

/** Render zadaje PORT; lokalno zadržava API_PORT i pristup samo sa ovog računara. */
export function apiListenAddress(): { host: string; port: number } {
  const port = Number(process.env.PORT || process.env.API_PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API port mora biti cijeli broj između 1 i 65535.");
  }
  const host =
    process.env.API_HOST ||
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  return { host, port };
}

/** Vraća eksplicitno dozvoljene adrese frontenda za CORS i zaštitu od CSRF-a. */
export function allowedOrigins(): string[] {
  return (
    process.env.WEB_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000"
  )
    .split(",")
    .map((origin) => origin.trim());
}
