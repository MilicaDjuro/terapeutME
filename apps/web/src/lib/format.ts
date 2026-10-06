// Pomoćne funkcije za prikaz datuma, nazive dana i pretvaranje vremena iz formulara.
import type { Locale } from "@terapeut/domain";
/** Formatira datum za prikaz, bez pomjeranja kalendarskog dana zbog zone browsera. */
export function formatDate(date: string, locale: Locale, long = false): string {
  return new Intl.DateTimeFormat(locale === "mne" ? "sr-Latn-ME" : "en-GB", {
    timeZone: "UTC",
    weekday: long ? "long" : "short",
    day: "numeric",
    month: long ? "long" : "short",
    ...(long ? { year: "numeric" } : {}),
  }).format(new Date(`${date}T12:00:00Z`));
}

/** Pretvara tekst iz time inputa u minute: "16:15" postaje 975. */
export function timeToMinutes(time: string): number {
  const parts = time.split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  return hours * 60 + minutes;
}

/** Vraća nazive dana u redosljedu podataka: nedjelja ima indeks 0. */
export function getWeekdayNames(locale: Locale): string[] {
  if (locale === "mne") {
    return [
      "Nedjelja",
      "Ponedjeljak",
      "Utorak",
      "Srijeda",
      "Četvrtak",
      "Petak",
      "Subota",
    ];
  }
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
}
