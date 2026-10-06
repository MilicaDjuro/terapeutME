// Samo ovaj fajl zna gdje se demo podaci čuvaju. Poziva se isključivo u browseru.
import type { DemoState, Locale } from "@terapeut/domain";

export const DEMO_STORAGE_KEY = "terapeut-me.demo.v1";
const LOCALE_STORAGE_KEY = "terapeut-me.locale";

/** Čita demo podatke; null znači da browser još nema sačuvanu verziju. */
export function readDemoState(): DemoState | null {
  const savedText = localStorage.getItem(DEMO_STORAGE_KEY);
  if (!savedText) {
    return null;
  }
  const savedState = JSON.parse(savedText) as DemoState;
  if (
    savedState.version !== 1 ||
    !Array.isArray(savedState.therapists) ||
    !Array.isArray(savedState.bookings)
  ) {
    throw new Error("Sačuvani demo podaci imaju nepoznat format.");
  }
  return savedState;
}

/** Čuva podatke kao JSON tekst; false omogućava da ekran radi i bez skladišta. */
export function writeDemoState(state: DemoState): boolean {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Vraća izabrani jezik; podrazumijevano koristimo crnogorski. */
export function readLocale(): Locale {
  try {
    const locale = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (locale === "en") {
      return "en";
    }
  } catch {
    // Zabrana čitanja ne treba da spriječi prikaz stranice na podrazumijevanom jeziku.
  }
  return "mne";
}

/** Pamti izbor jezika; ako browser odbije čuvanje, jezik na ekranu i dalje radi. */
export function writeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Izbor važi do zatvaranja stranice, čak i bez trajnog čuvanja.
  }
}
