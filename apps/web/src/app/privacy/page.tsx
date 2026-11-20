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
          "Demo zahtjevi i izmjene čuvaju se u lokalnom skladištu browsera. Registracija čuva ime, prezime, email, datum rođenja i hash lozinke u serverskoj bazi nakon potvrde email koda. Terapeutska registracija dodatno čuva stručno zvanje, biografiju, grad, telefon, opcionu adresu i početnu uslugu. Prijava koristi sesijski kolačić. Kod se šalje preko podešenog email servisa; u lokalnom testiranju poruke ostaju u testnom sandučetu. Demo rezervacije ne dijele podatke sa stvarnim terapeutima.",
          "Demo requests and changes are saved in browser storage. Registration stores your first name, last name, email, date of birth and password hash in the server database after email verification. Therapist registration also stores your professional title, biography, city, phone, optional address and first service. Sign-in uses a session cookie. Codes are sent through the configured email service; local testing retains messages in a test inbox. Demo bookings do not share data with real therapists.",
        )}
      </p>
      <h2>{translate("Online seanse", "Online sessions")}</h2>
      <p>
        {translate(
          "Ako je usluga označena kao online, poziv je dostupan samo terapeutu i klijentu iz potvrđene rezervacije u predviđenom vremenu. Lokalni pregled kamere ne šalje sliku drugim osobama. Kada je Daily servis uključen i pridružite se pozivu, Daily obrađuje zvuk, video i tehničke podatke veze. Aplikacija ne snima razgovor i ne pravi transkript. U bazi ostaju tehnička oznaka sobe i vremena njenog kreiranja, isteka i zatvaranja; pristupni tokeni se ne čuvaju. Ovo nije završena politika produkcione usluge.",
          "For services marked online, only the booked therapist and client can join a confirmed session within its access window. The local camera preview does not send your image to anyone. When Daily is enabled and you join, Daily processes audio, video and connection metadata. The app does not record or transcribe calls. The database retains the technical room identifier and creation, expiry and closure times; access tokens are not stored. This is not the final production privacy policy.",
        )}
      </p>
      <h2>{translate("Ko vidi podatke?", "Who can see the data?")}</h2>
      <p>
        {translate(
          "Svako otvaranje ili osvježavanje javnog profila bilježimo u serverskoj bazi, uključujući ponavljanja. Prijavljene posjetioce razlikujemo po nalogu, a neprijavljene po nasumičnom browser kolačiću koji traje 30 dana. Različiti browseri ili brisanje kolačića mogu istu osobu prikazati više puta. Terapeut vidi brojeve i oznake posjetilaca za svoj profil, bez njihovih imena, email adresa i identifikatora naloga. IP adrese se ne čuvaju u događajima pregleda.",
          "We record each public profile opening or reload in the server database, including repeat visits. Signed-in visitors are distinguished by account; anonymous visitors use a random 30-day browser cookie. Different browsers or clearing cookies can count the same person more than once. Therapists see counts and visitor labels for their own profile, without names, email addresses or account identifiers. IP addresses are not stored in view events.",
        )}
      </p>
      <p>
        {translate(
          "Sve demo uloge dostupne su u istom browseru, bez prijavljivanja. Svako sa pristupom tom browseru može otvoriti probni pregled i vidjeti sačuvane podatke.",
          "All demo roles are accessible in the same browser without sign-in. Anyone with access to that browser can open the sample dashboard and see saved data.",
        )}
      </p>
      <h2>{translate("Uklanjanje demo podataka", "Removing demo data")}</h2>
      <p>
        {translate(
          "Probne podatke možete vratiti na početno stanje iz pregleda ili obrisati podatke ovog sajta u podešavanjima browsera. To ne briše serverski nalog; brisanje naloga još nije implementirano. Preuzeti Excel fajlovi ostaju na vašem uređaju dok ih sami ne uklonite.",
          "Restore sample data from the dashboard or clear this site’s data in your browser settings. This does not delete your server account; account deletion is not implemented yet. Downloaded Excel files remain on your device until you remove them.",
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
