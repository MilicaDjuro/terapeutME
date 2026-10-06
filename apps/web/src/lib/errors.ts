// Poruke grešaka. Oznake iz domain paketa se ovdje pretvaraju u tekst za korisnika.
import { DomainError } from "@terapeut/domain";

/** Pretvara oznaku poslovne greške u razumljivu poruku na izabranom jeziku. */
export function errorText(
  error: unknown,
  translate: (mne: string, en: string) => string,
): string {
  const code = error instanceof DomainError ? error.code : "";
  if (code === "SLOT_UNAVAILABLE")
    return translate(
      "Termin više nije dostupan. Izaberite drugo vrijeme.",
      "This time is no longer available. Please select another.",
    );
  if (code === "INVALID_CONTACT")
    return translate(
      "Provjerite ime i prezime, email i broj telefona.",
      "Please check your full name, email and phone number.",
    );
  if (code === "OVERLAPPING_AVAILABILITY")
    return translate(
      "Periodi dostupnosti se preklapaju. Provjerite vremena.",
      "Availability windows overlap. Please check the times.",
    );
  if (code === "INVALID_AVAILABILITY")
    return translate(
      "Kraj dostupnosti mora biti poslije početka.",
      "Availability must end after it starts.",
    );
  if (code === "SAME_SLOT")
    return translate(
      "Izaberite termin različit od trenutnog.",
      "Please choose a different time.",
    );
  if (code === "INVALID_SERVICE")
    return translate(
      "Unesite naziv, trajanje od 5 do 240 minuta i ispravnu cijenu.",
      "Enter a name, a duration from 5 to 240 minutes and a valid price.",
    );
  return translate(
    "Promjena nije moguća u trenutnom stanju. Osvježite pregled.",
    "This change is not available in the current state. Refresh the view.",
  );
}
