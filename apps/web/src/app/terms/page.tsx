"use client";
import { useDemo } from "@/lib/demo-context";
/** Opisuje korišćenje demo verzije; ovo još nije konačan dokument uslova platforme. */
export default function Terms() {
  const { translate } = useDemo();
  return (
    <div className="container page-space reading-page">
      <span className="eyebrow">
        {translate("POČETNA VERZIJA", "INITIAL VERSION")}
      </span>
      <h1>{translate("Korišćenje demo verzije", "Using the demo")}</h1>
      <p>
        {translate(
          "Ova verzija služi za pregled i provjeru dogovorenih tokova. Prikazani stručnjaci i termini su probni. Zahtjevi nijesu stvarne rezervacije i ne šalju se stvarnim osobama.",
          "This version is for reviewing and testing the agreed workflows. Professionals and times are samples. Requests are not real reservations and are not sent to real people.",
        )}
      </p>
      <h2>{translate("Zakazivanje", "Scheduling")}</h2>
      <p>
        {translate(
          "Zahtjev zauzima izabrani interval i čeka potvrdu. Predlog novog vremena oslobađa prethodno i zauzima novo vrijeme. Prihvatanjem predloga termin postaje potvrđen.",
          "A request holds the selected interval and awaits confirmation. Proposing another time releases the previous interval and holds the new one. Accepting the proposal confirms it.",
        )}
      </p>
      <h2>{translate("Plaćanje i kontakt", "Payment and contact")}</h2>
      <p>
        {translate(
          "Nema online plaćanja ni online seansi. Budući korisnici dogovaraće detalje direktno sa terapeutom. U demo verziji nije omogućen kontakt sa stvarnim terapeutima.",
          "There are no online payments or online sessions. Future users will arrange details directly with their therapist. The demo does not provide contact with real therapists.",
        )}
      </p>
      <h2>{translate("Prije stvarnog lansiranja", "Before a live launch")}</h2>
      <p>
        {translate(
          "Ovo nije konačan dokument uslova korišćenja. Puna pravila platforme biće definisana prije korišćenja sa stvarnim podacima.",
          "This is not a final terms-of-service document. Complete platform rules will be defined before use with real data.",
        )}
      </p>
    </div>
  );
}
