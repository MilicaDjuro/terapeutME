"use client";
import { useDemo } from "@/lib/demo-context";
/** Objašnjava gdje demo čuva podatke; ovo još nije politika produkcione platforme. */
export default function Privacy() {
  const { translate } = useDemo();
  return (
    <div className="container page-space reading-page">
      <span className="eyebrow">
        {translate("POČETNA VERZIJA", "INITIAL VERSION")}
      </span>
      <h1>{translate("Privatnost demo verzije", "Demo privacy")}</h1>
      <p>
        {translate(
          "Ovo je razvojna demonstracija, sa izmišljenim profilima i probnim podacima. Nije pokrenuta usluga za stvarno zakazivanje.",
          "This is a development demonstration with fictional profiles and sample data. It is not a live appointment service.",
        )}
      </p>
      <h2>{translate("Gdje se podaci čuvaju?", "Where is data stored?")}</h2>
      <p>
        {translate(
          "Zahtjevi i izmjene čuvaju se u lokalnom skladištu ovog browsera. Nema slanja emaila, naloga na serveru ni razmjene podataka sa stvarnim terapeutima. Koristite samo probne kontakt podatke.",
          "Requests and changes are saved in this browser’s local storage. No emails are sent, no server accounts are created and no data is shared with real therapists. Use sample contact details only.",
        )}
      </p>
      <h2>{translate("Ko vidi podatke?", "Who can see the data?")}</h2>
      <p>
        {translate(
          "Sve demo uloge dostupne su u istom browseru, bez prijavljivanja. Svako sa pristupom tom browseru može otvoriti probni pregled i vidjeti sačuvane podatke.",
          "All demo roles are accessible in the same browser without sign-in. Anyone with access to that browser can open the sample dashboard and see saved data.",
        )}
      </p>
      <h2>{translate("Uklanjanje demo podataka", "Removing demo data")}</h2>
      <p>
        {translate(
          "Probne podatke možete vratiti na početno stanje iz pregleda ili obrisati podatke ovog sajta u podešavanjima browsera. Preuzeti Excel fajlovi ostaju na vašem uređaju dok ih sami ne uklonite.",
          "Restore sample data from the dashboard or clear this site’s data in your browser settings. Downloaded Excel files remain on your device until you remove them.",
        )}
      </p>
      <h2>{translate("Prije stvarnog lansiranja", "Before a live launch")}</h2>
      <p>
        {translate(
          "Potrebno je usaglasiti i objaviti punu politiku privatnosti, pravila čuvanja i brisanja podataka i pristup arhivi. Ova stranica opisuje samo ponašanje demo verzije.",
          "A complete privacy policy, retention and deletion rules, and archive access must be agreed and published. This page describes only the demo’s behaviour.",
        )}
      </p>
    </div>
  );
}
