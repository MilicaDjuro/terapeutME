import { timeLabel } from "@terapeut/domain";

export type BookingEmailTemplate =
  | "booking-requested"
  | "booking-confirmed"
  | "booking-declined"
  | "booking-proposed"
  | "booking-cancelled"
  | "booking-alternative-accepted"
  | "booking-alternative-rejected"
  | "waitlist-assigned";

export interface BookingEmailDetails {
  online?: boolean;
  therapistName: string;
  clientName: string;
  serviceName: string;
  date: string;
  start: number;
  end: number;
  duration: number;
  price: number | null;
  city: string;
  address: string;
  previousDate: string | null;
  previousStart: number | null;
}

/** Pravi običan tekst poruke iz potvrđenog snimka baze; email ne sadrži tokene ni medicinske bilješke. */
export function buildBookingEmail(
  template: BookingEmailTemplate,
  details: BookingEmailDetails,
  link: string,
) {
  let subject = "Terapeut.me — obavještenje o terminu";
  let introduction = "";
  let instruction = "";
  if (template === "waitlist-assigned") {
    subject = "Terapeut.me — oslobođeni termin je dodijeljen sa liste čekanja";
    introduction = `Oslobođeni termin kod terapeuta ${details.therapistName} automatski je dodijeljen klijentu ${details.clientName}, prema redosljedu liste čekanja. Seansa je potvrđena.`;
    instruction =
      "Termin i istorija dodjele dostupni su u aplikaciji. Ako vam termin više ne odgovara, otkažite ga kroz aplikaciju.";
  }
  if (template === "booking-requested") {
    subject = "Terapeut.me — novi zahtjev za termin";
    introduction = `${details.clientName} je poslao/la zahtjev za zakazivanje seanse kod vas.`;
    instruction =
      "Otvorite aplikaciju da potvrdite, odbijete ili predložite drugi termin.";
  }
  if (template === "booking-confirmed") {
    subject = "Terapeut.me — termin je potvrđen";
    introduction = `${details.therapistName} je potvrdio/la vaš termin.`;
  }
  if (template === "booking-declined") {
    subject = "Terapeut.me — zahtjev za termin je odbijen";
    introduction = `${details.therapistName} je odbio/la zahtjev za termin naveden ispod.`;
    instruction = "U aplikaciji možete izabrati drugi slobodan termin.";
  }
  if (template === "booking-proposed") {
    subject = "Terapeut.me — predložen je novi termin";
    introduction = `${details.therapistName} je predložio/la novi datum ili vrijeme seanse.`;
    instruction =
      "Ovo još nije potvrđena seansa. Otvorite aplikaciju da prihvatite ili odbijete novi termin.";
  }
  if (template === "booking-cancelled") {
    subject = "Terapeut.me — termin je otkazan";
    introduction =
      "Termin naveden ispod je otkazan. Promjena je sačuvana u aplikaciji.";
  }
  if (template === "booking-alternative-accepted") {
    subject = "Terapeut.me — klijent je prihvatio novi termin";
    introduction = `${details.clientName} je prihvatio/la vaš predlog. Seansa je potvrđena.`;
  }
  if (template === "booking-alternative-rejected") {
    subject = "Terapeut.me — klijent je odbio novi termin";
    introduction = `${details.clientName} je odbio/la predloženi termin. Seansa nije potvrđena.`;
  }
  const date = new Intl.DateTimeFormat("sr-Latn-ME", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${details.date}T12:00:00Z`));
  const price =
    details.price === null
      ? "Na upit"
      : new Intl.NumberFormat("sr-Latn-ME", {
          style: "currency",
          currency: "EUR",
        }).format(details.price);
  let previous = "";
  if (
    details.previousDate &&
    details.previousStart !== null &&
    template === "booking-proposed"
  ) {
    previous = `\nPrethodni termin: ${details.previousDate} u ${timeLabel(details.previousStart)}.\nNovi predlog je naveden ispod.\n`;
  }
  const location = details.online
    ? "Način rada: Online video seansa. Ulazak iz potvrđene rezervacije u aplikaciji, 10 minuta prije termina."
    : `Ordinacija: ${[details.city, details.address].filter(Boolean).join(", ")}`;
  const text = `${introduction}\n${previous}\nTerapeut: ${details.therapistName}\nKlijent: ${details.clientName}\nVrsta seanse: ${details.serviceName}\nDatum: ${date}\nVrijeme: ${timeLabel(details.start)}–${timeLabel(details.end)} (Europe/Podgorica)\nTrajanje: ${details.duration} min\nCijena: ${price}\n${location}\n\n${instruction}\n\nOtvorite zahtjev u aplikaciji:\n${link}\n\nNajnovije stanje i istorija zahtjeva dostupni su u aplikaciji. Za promjenu termina koristite aplikaciju.`;
  return { subject, text };
}
