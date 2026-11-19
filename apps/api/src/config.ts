import { config } from "dotenv";
import { resolve } from "node:path";

// Lokalno čitamo ignorisani root .env; Render vrijednosti iz okruženja imaju prednost.
config({ path: resolve(__dirname, "../../../.env"), quiet: true });

export type EmailMode = "local" | "smtp" | "resend" | "disabled";

/** Bira izričito podešen način dostave; nepoznata vrijednost nikad ne uključuje lokalni email u produkciji. */
export function configuredEmailMode(): EmailMode {
  const mode = process.env.AUTH_EMAIL_MODE || "local";
  if (
    mode === "local" ||
    mode === "smtp" ||
    mode === "resend" ||
    mode === "disabled"
  ) {
    return mode;
  }
  throw new Error(
    "AUTH_EMAIL_MODE mora biti local, smtp, resend ili disabled.",
  );
}

/** Provjerava obaveznu serversku konfiguraciju; ne ispisuje tajne. */
export function validateConfiguration() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Nedostaje DATABASE_URL u .env konfiguraciji.");
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    throw new Error("AUTH_SECRET mora sadržati najmanje 32 nasumična znaka.");
  }
  const emailMode = configuredEmailMode();
  if (emailMode === "local" || emailMode === "smtp") {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
      throw new Error(
        "Nedostaju SMTP_HOST ili SMTP_FROM u .env konfiguraciji.",
      );
    }
    if (
      !Number.isInteger(Number(process.env.SMTP_PORT)) ||
      Number(process.env.SMTP_PORT) < 1 ||
      Number(process.env.SMTP_PORT) > 65535
    ) {
      throw new Error("SMTP_PORT mora biti važeći broj porta.");
    }
    if (
      emailMode === "smtp" &&
      (!process.env.SMTP_USER || !process.env.SMTP_PASS)
    ) {
      throw new Error("SMTP dostava zahtijeva SMTP_USER i SMTP_PASS.");
    }
  }
  if (
    emailMode === "resend" &&
    (!process.env.RESEND_API_KEY?.trim() || !process.env.RESEND_FROM?.trim())
  ) {
    throw new Error("Resend zahtijeva RESEND_API_KEY i RESEND_FROM.");
  }
  if (process.env.NODE_ENV === "production") {
    if (emailMode === "local") {
      throw new Error(
        "Produkcija zahtijeva AUTH_EMAIL_MODE=resend, smtp ili izričito disabled; lokalni Mailpit nije dostupan.",
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
