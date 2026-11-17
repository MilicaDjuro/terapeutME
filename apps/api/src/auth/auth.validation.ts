import { BadRequestException } from "@nestjs/common";
import type {
  AccountProfileInput,
  RegistrationInput,
  TherapistRegistrationDetails,
  TherapistProfileInput,
} from "./auth.types";

/** Zahtijeva JSON objekat; browser provjere nijesu zamjena za serversku validaciju. */
export function requireBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Neispravan zahtjev.");
  }
  return value as Record<string, unknown>;
}

/** Čita ograničeni tekst i uklanja rubne razmake, osim kod lozinke. */
export function requireText(
  value: unknown,
  label: string,
  maximum: number,
  trim = true,
): string {
  if (typeof value !== "string")
    throw new BadRequestException(`${label} je obavezno polje.`);
  const text = trim ? value.trim() : value;
  if (!text || text.length > maximum)
    throw new BadRequestException(`${label} nije ispravno uneseno.`);
  return text;
}

/** Normalizuje email tako da velika/mala slova ne stvaraju različite naloge. */
export function requireEmail(value: unknown): string {
  const email = requireText(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new BadRequestException("Unesite važeću email adresu.");
  return email;
}

/** Provjerava stvarni kalendarski datum; budući datum rođenja nije dozvoljen. */
export function requireBirthDate(value: unknown): string {
  const date = requireText(value, "Datum rođenja", 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Podgorica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    date > today ||
    date < "1900-01-01"
  ) {
    throw new BadRequestException(
      "Unesite važeći datum rođenja koji nije u budućnosti.",
    );
  }
  return date;
}

/** Provjerava kontakt telefon; prazan broj dozvoljava samo formular ličnih podataka klijenta. */
export function requirePhone(value: unknown): string {
  const phone = requireText(value, "Telefon", 30);
  const digitCount = phone.replace(/\D/g, "").length;
  if (!/^[+\d][\d ()-]+$/.test(phone) || digitCount < 6 || digitCount > 15)
    throw new BadRequestException("Unesite važeći broj telefona.");
  return phone;
}

/** Čita opcioni kontakt; izostavljeno polje se čuva, a prazna vrijednost znači uklanjanje. */
function optionalContact(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  if (value === null || (typeof value === "string" && !value.trim()))
    return null;
  return requireText(value, label, maximum);
}

/** Dozvoljava podatke profila i kontakta; ulogu i vlasnika određuje serverska sesija. */
export function validateAccountProfile(value: unknown): AccountProfileInput {
  const body = requireBody(value);
  const input: AccountProfileInput = {
    firstName: requireText(body.firstName, "Ime", 60),
    lastName: requireText(body.lastName, "Prezime", 60),
    dateOfBirth: requireBirthDate(body.dateOfBirth),
  };
  // Izostavljen telefon ostaje nepromijenjen, a prazno polje briše opcioni kontakt klijenta.
  if (body.phone !== undefined) {
    input.phone =
      body.phone === null ||
      (typeof body.phone === "string" && !body.phone.trim())
        ? null
        : requirePhone(body.phone);
  }
  if (body.city !== undefined)
    input.city = optionalContact(body.city, "Grad", 80);
  if (body.address !== undefined)
    input.address = optionalContact(body.address, "Adresa", 160);
  if (body.title !== undefined)
    input.title = requireText(body.title, "Stručno zvanje", 120);
  if (body.biography !== undefined)
    input.biography = requireText(body.biography, "Biografija", 400);
  return input;
}

/** Provjerava sva polja registracije; korisnik ne bira svoju serversku ulogu. */
export function validateRegistration(value: unknown): RegistrationInput {
  const body = requireBody(value);
  const password = requireNewPassword(body.password);
  return {
    firstName: requireText(body.firstName, "Ime", 60),
    lastName: requireText(body.lastName, "Prezime", 60),
    email: requireEmail(body.email),
    dateOfBirth: requireBirthDate(body.dateOfBirth),
    password,
  };
}

/** Koristi isto pravilo pri registraciji i obnovi; razmaci su dozvoljeni i ne uklanjaju se. */
export function requireNewPassword(value: unknown): string {
  const password = requireText(value, "Lozinka", 128, false);
  if (password.length < 15)
    throw new BadRequestException("Lozinka mora imati najmanje 15 znakova.");
  return password;
}

/** Provjerava novu lozinku i potvrdu na serveru, nezavisno od browser formulara. */
export function validatePasswordReset(value: unknown) {
  const body = requireBody(value);
  const password = requireNewPassword(body.password);
  const confirmation = requireText(
    body.confirmPassword,
    "Potvrda lozinke",
    128,
    false,
  );
  if (password !== confirmation)
    throw new BadRequestException("Lozinke se ne podudaraju.");
  return {
    token: requireText(body.token, "Link za obnovu", 2048, false),
    password,
  };
}

/** Provjerava opcionu cijenu u eurima; prazno ostaje NULL, dok je nula dozvoljena cijena. */
export function requireSessionPrice(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const text =
    typeof value === "number"
      ? String(value)
      : requireText(value, "Cijena seanse", 20);
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) {
    throw new BadRequestException(
      "Cijena mora biti nenegativan iznos sa najviše dvije decimale.",
    );
  }
  const price = Number(text.replace(",", "."));
  if (!Number.isFinite(price) || price > 99999999.99)
    throw new BadRequestException("Cijena seanse je prevelika.");
  return price;
}

/** Provjerava javne podatke profila; ulogu, vlasnika i verifikaciju nikad ne čita iz formulara. */
export function validateTherapistProfile(
  value: unknown,
): TherapistProfileInput {
  const body = requireBody(value);
  const phone = requirePhone(body.phone);
  let address: string | null = null;
  if (
    body.address !== undefined &&
    body.address !== null &&
    body.address !== ""
  )
    address = requireText(body.address, "Adresa", 160);
  return {
    title: requireText(body.title, "Stručno zvanje", 120),
    biography: requireText(body.biography, "Biografija", 400),
    city: requireText(body.city, "Grad", 80),
    address,
    phone,
  };
}

/** Čita profesionalne podatke i početnu uslugu; uloga i verifikacija se ne uzimaju iz formulara. */
export function validateTherapistRegistration(value: unknown): {
  registration: RegistrationInput;
  profile: TherapistRegistrationDetails;
} {
  const body = requireBody(value);
  const registration = validateRegistration(body);
  const profile = validateTherapistProfile(body);
  const durationText =
    typeof body.durationMinutes === "number"
      ? String(body.durationMinutes)
      : requireText(body.durationMinutes, "Trajanje seanse", 3);
  const durationMinutes = Number(durationText);
  if (
    !/^\d+$/.test(durationText) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 5 ||
    durationMinutes > 240
  ) {
    throw new BadRequestException(
      "Trajanje seanse mora biti cijeli broj od 5 do 240 minuta.",
    );
  }
  return {
    registration,
    profile: {
      ...profile,
      serviceName: requireText(body.serviceName, "Naziv usluge", 120),
      durationMinutes,
      priceEur: requireSessionPrice(body.priceEur),
    },
  };
}

/** Provjerava nasumičnu oznaku registracije prije pristupa bazi. */
export function requireChallengeId(value: unknown): string {
  const id = requireText(value, "Oznaka registracije", 36);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id,
    )
  )
    throw new BadRequestException("Neispravna oznaka registracije.");
  return id;
}
