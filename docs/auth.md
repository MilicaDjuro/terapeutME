# Registracija i JWT prijava

Ovaj dio koristi PostgreSQL i NestJS API. Klijenti se registruju na `/register`, a terapeuti na `/register/therapist`. Katalog, raspored i stvarne rezervacije koriste bazu; odvojene `/demo/...` stranice ostaju lokalna demonstracija. Zakazivanje je opisano u [scheduling.md](scheduling.md), a fotografije u [directory.md](directory.md).

## Lokalno pokretanje

Komande izvršavajte iz korijena projekta. Docker Desktop mora biti pokrenut.

1. Instalirajte zavisnosti: `npm.cmd install`.
2. Kopirajte `.env.example` u `.env`. `.env` je ignorisan u Git-u.
3. Generišite tajni ključ i upišite ga u `AUTH_SECRET`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. Pokrenite bazu i lokalni email servis:

   ```powershell
   docker compose up -d db mailpit
   npm.cmd run db:migrate
   ```

5. U jednom terminalu pokrenite `npm.cmd run dev:api`, u drugom `npm.cmd run dev`.
6. Otvorite http://localhost:3000/register. Email kodove u lokalnom režimu čitate na http://127.0.0.1:8025.

Mailpit prima stvarne SMTP poruke API-ja, ali ih zadržava na računaru. Ne dostavlja ih na Gmail ili drugu stvarnu adresu. Aplikacija u ovom režimu jasno prikazuje link ka testnom sandučetu. Kod se nikada ne vraća u JSON odgovoru.

Isti SMTP sada šalje i obavještenja o zahtjevima i odgovorima na termine. Njihov trajni red, retry i debugovanje opisani su u [booking-notifications.md](booking-notifications.md). Za ta obavještenja ne unose se posebni SMTP pristupni podaci.

## Stvarna dostava preko Resend-a

1. Napravite nalog na [Resend-u](https://resend.com).
2. U **Domains** dodajte domen kojim upravljate. U DNS provajderu upišite tačne zapise koje Resend prikaže i sačekajte potvrdu domena. Može se koristiti poddomen za slanje.
3. Kreirajte API ključ sa dozvolom za slanje na tom domenu.
4. U lokalnom `.env` promijenite:

   ```dotenv
   AUTH_EMAIL_MODE=resend
   RESEND_API_KEY=ovdje-upisite-svoj-API-kljuc
   RESEND_FROM=Terapeut.me <noreply@vas-verifikovani-domen.me>
   ```

   Adresa `RESEND_FROM` mora pripadati domenu koji ste verifikovali. Ako je verifikovan poddomen, prilagodite adresu. Ključ pripada samo `.env` fajlu ili Render Environment podešavanjima, nikad browseru. SMTP varijable nijesu potrebne za Resend HTTPS režim.

5. Zaustavite i ponovo pokrenite API. Restart učitava izmijenjenu email konfiguraciju.
6. Registrujte testni nalog sa emailom koji kontrolišete i provjerite dostavu i unos koda. SMTP prihvatanje poruke nije dokaz da poruka nije završila u spam folderu.

Podešavanja prate [Resend HTTPS API](https://resend.com/docs/api-reference/emails/send-email). `EmailService` koristi ugrađeni `fetch`, rok od 15 sekundi i potvrđuje odgovor sa ID-em poruke. Odgovor provajdera se ne loguje jer može sadržati privatne podatke. Isti servis dostavlja registracione kodove, reset linkove i booking obavještenja. Režimi `local` i `smtp` ostaju podržani za Mailpit i okruženja koja dozvoljavaju SMTP.

## Privremeno isključen email na Render Free

`AUTH_EMAIL_MODE=disabled` dozvoljava pokretanje API-ja bez SMTP/Resend tajni. Registracija, ponovno slanje koda i zahtjev za obnovu lozinke vraćaju 503 sa porukom da email još nije uključen, prije čuvanja privremenih podataka. Isto važi za poznate i nepoznate email adrese. Potvrda emaila se ne zaobilazi; postojeće prijave ostaju provjerene u bazi. Outbox se i dalje upisuje uz poslovnu transakciju, ali se ne obrađuje dok se dostava ne uključi. Koraci za Free hosting su u [deployment.md](deployment.md).

## Tok podataka

```mermaid
sequenceDiagram
  participant Browser
  participant API as NestJS API
  participant DB as PostgreSQL
  participant Email as SMTP servis
  Browser->>API: POST /auth/register (podaci i lozinka)
  API->>DB: Privremena registracija, hash lozinke i koda
  API->>Email: Četvorocifreni kod
  Email-->>Browser: Email / lokalno testno sanduče
  Browser->>API: POST /auth/verify (oznaka i kod)
  API->>DB: Provjera, kreiranje users reda i sesije u transakciji
  API-->>Browser: Javni podaci naloga i HttpOnly kolačić
  Browser->>API: GET /auth/me sa kolačićem
  API->>DB: Važnost sesije, vlasnik i suspenzija
  API-->>Browser: Isključivo vlastiti nalog
```

`users` red nastaje tek poslije tačnog koda. Obična registracija dodjeljuje `CLIENT`, a poseban serverski endpoint `/auth/register/therapist` dodjeljuje `THERAPIST` tek nakon provjere podataka profila i email potvrde. Slanje proizvoljnog `role: ADMIN` ne daje privilegije. Administratorska uloga nije dostupna kroz javnu registraciju.

## Registracija terapeuta

Terapeut unosi ime, prezime, email, datum rođenja i lozinku, zatim stručno zvanje, biografiju do 400 znakova, grad, telefon i opcionu adresu ordinacije. Početna usluga ima naziv, proizvoljno cijelo trajanje od 5 do 240 minuta i opcionu cijenu u eurima sa najviše dvije decimale. Nalog dobija samo tu početnu seansu. Dodatne seanse i njihove izmjene terapeut čuva na dashboardu. Prazna cijena je `NULL` („Na upit”); unesena nula je stvarna cijena 0 €.

Prije koda `registration_challenges` čuva serverski odabranu vrstu registracije, a `therapist_registration_details` privremene profesionalne podatke. Po potvrdi jedna transakcija kreira `users` sa ulogom `THERAPIST`, povezani `therapists` red, prvu `services` uslugu i sesiju. Ako bilo koji upis ne uspije, svi upisi se povlače. Privremeni profesionalni podaci brišu se zajedno sa zahtjevom nakon potvrde ili isteka.

`users.verified_at` potvrđuje email. `therapists.is_verified` ostaje `false`: stručnu verifikaciju dodjeljuje admin. Unosi `isVerified`, `verified_by` ili `role` iz browsera ne koriste se za te odluke. Engleska polja profila i usluge zasad čuvaju isti tekst koji je korisnik unio; nema automatskog prevoda.

Poslije prijave i email potvrde pacijent (`CLIENT`) otvara `/psychotherapy` bez filtera, a terapeut (`THERAPIST`) `/dashboard`. Administrator otvara `/account`; javna registracija ne dodjeljuje ADMIN ulogu. Terapeutski dashboard otvara uređivanje vlastitih podataka na `/account`. URL parametri `mode` i `therapist` ne mijenjaju ovaj prikaz. Odvojeni demo rezervacija ostaje na `/demo/dashboard`.

Terapeut na `/account` vidi profil, usluge i fotografije. `GET /auth/therapist-profile` provjerava sesiju, ulogu `THERAPIST` i `linked_user_id` vlasnika. `POST /auth/therapist-profile` čuva stručno zvanje, biografiju, grad, telefon i opcionu adresu. Profil i kontakt čuvaju se u jednoj transakciji, a vlasnik se određuje iz provjerene JWT sesije. Proizvoljni ID, uloga i verifikaciona polja iz formulara se ignorišu. Usluge, fotografije, rezervacije i istorija ostaju sačuvani. Engleska polja zvanja/biografije zasad prate uneseni tekst. Novi profili se pojavljuju u javnom katalogu iz baze. Terapeut cijene seansi, radno vrijeme uređuje na `/dashboard` preko API-ja.

Lozinka ima 15–128 znakova i čuva se kao scrypt hash sa nasumičnom soli. Datum rođenja se provjerava na serveru, uključujući stvarne datume i zabranu budućih datuma.

Kod ima četiri cifre, uključujući moguće vodeće nule, i važi najviše 10 minuta. Poslije pet grešaka zahtjev je zaključan. Ponovno slanje dozvoljeno je nakon 60 sekundi i poništava prethodni kod; ne resetuje greške. Jedan zahtjev traje najviše 30 minuta uz ponovno slanje. Novi početni zahtjev za istu adresu dozvoljen je tek po isteku prethodnog. Trajna ograničenja pokušaja štite i prijavu i slanje.

Kratak kod štiti HMAC sa `AUTH_SECRET`, koji nije u bazi. Promjena ovog ključa poništava ranije nepotvrđene kodove i sve postojeće JWT tokene. Sesije koriste potpisani JWT i SHA-256 hash tokena u bazi.

## Uređivanje vlastitog profila

Klijent i terapeut otvaraju `/account`, pa „Uredi profil“. Jedan formular obuhvata ime, prezime, datum rođenja, telefon, grad i adresu. Klijentovi telefon, grad i adresa su opcioni i privatni; sačuvani telefon popunjava sljedeći formular zakazivanja. Terapeut u istom formularu mijenja i zvanje i biografiju; telefon i grad su obavezni, a adresa ordinacije opciona. Dugme „Sačuvaj profil“ čuva sva polja zajedno. Fotografije se uređuju u istoj stranici, a seanse i radno vrijeme na dashboardu. Email i lozinka za prijavu nijesu dio izmjene profila.

Tok za debugging:

1. `AccountProfileEditor.handleEditProfile` otvara formular sa posljednjim podacima iz `AuthProvider`-a. Za terapeuta prvo učitava profesionalna polja iz `GET /auth/therapist-profile`; greška ostavlja dugme za novi pokušaj. „Odustani“ zatvara formular bez HTTP upisa. Provjera sesije pri povratku u tab ne uklanja nesnimljeni unos.
2. `handleSaveProfile` šalje `POST /api/v1/auth/profile` kroz `requestAuth`. Browser ne šalje ID vlasnika ni ulogu.
3. `AuthOriginGuard` i `validateAccountProfile` provjeravaju porijeklo zahtjeva, dužinu imena, stvarni datum i opcioni telefon. Polja poput `userId`, `role`, `email` i verifikacije ne ulaze u dozvoljeni unos.
4. `AuthService.updateAccountProfile` provjerava JWT sesiju i otvara transakciju. Kod terapeuta prvo zaključava njegov red i provjerava sva profesionalna polja, pa mijenja javno ime, zvanje, biografiju, grad i adresu u `therapists`. Zatim čuva ime, prezime, datum rođenja i telefon u `users`; za klijenta tamo čuva i privatni grad/adresu. Izostavljeno kontakt polje ostaje nepromijenjeno; prazno opciono polje se čuva kao `NULL`. Terapeut ne može ukloniti obavezni telefon ili grad. Uloga klijenta ne omogućava upis profesionalnog profila.
5. Tek nakon `COMMIT` odgovor vraća sačuvane podatke. `setUser` osvježava pozdrav i lične podatke, a terapeutska promjena imena osvježava javni katalog. Greška vraća transakciju sa `ROLLBACK`, čuva unesena polja i prikazuje poruku bez lažnog uspjeha.

Migracija `006-profile-contact.sql` dodaje opcione kolone `users.city` i `users.address` za klijentov kontakt. Ne mijenja postojeće ordinacije, naloge ili rezervacije. `GET /auth/me` i nova prijava čitaju najnovije podatke iz PostgreSQL-a. Ranije rezervacije i događaji istorije zadržavaju kontakt zabilježen u trenutku zakazivanja; naredni zahtjev koristi novo ime naloga. Klijentov grad/adresa ne ulaze u javni katalog niti u rezervaciju.

## Zaboravljena lozinka i jednokratni JWT link

Na `/login` postoji „Zaboravili ste lozinku?“. `/forgot-password` traži email, a `/reset-password` otvara unos nove lozinke i potvrde. Obje uloge koriste isti tok; uspješan klijent otvara `/psychotherapy`, a terapeut `/dashboard`.

1. `ForgotPasswordPage.handleSendLink` šalje `POST /auth/forgot-password`. Odgovor je isti za nepoznat email i aktivan nalog; token nikad nije dio JSON odgovora. Server ograničava zahtjeve po IP adresi i normalizovanom emailu.
2. `PasswordResetService.requestReset` zaključava red korisnika, provjerava potvrdu emaila/suspenziju i zamjenjuje prethodni reset zapis. `password-reset.jwt.ts` potpisuje JWT sa HS256, nasumičnim `jti`, `sub`, posebnom namjenom `password-reset`, publikom `terapeut.me-password-reset` i rokom od 15 minuta. JWT za prijavu se ne može koristiti za obnovu, niti reset JWT za prijavu.
3. Migracija `007-password-reset.sql` dodaje `password_reset_tokens`. Baza čuva samo SHA-256 hash JWT-a, korisnika i rok. SMTP servis šalje link ka dozvoljenom frontend Origin-u; ne prihvata proizvoljan povratni URL ili Host. Novi zahtjev poništava stariji link. Kod neuspjele dostave zapis se uklanja, a log ne sadrži email ili JWT.
4. Link je oblika `/reset-password#token=...`. Fragment čita samo browser poslije mount-a: ne ulazi u HTTP putanju, server logove ili Referer. Token ostaje samo u URL-u i React stanju, bez `localStorage` ili `sessionStorage`; refresh linka radi. Stranica ima `no-referrer` metadata.
5. `ResetPasswordPage.handleResetPassword` poredi lozinke, pa šalje `POST /auth/reset-password`. Server nezavisno provjerava potvrdu i pravilo 15–128 znakova. Razmaci u lozinci se čuvaju.
6. `PasswordResetService.resetPassword` provjerava JWT, pa u transakciji zaključava korisnika, provjerava hash/rok linka i aktivnost naloga. Čuva novi scrypt hash, briše reset linkove i stare sesije, pa `AuthService.createSession` izdaje novu JWT sesiju. `COMMIT` potvrđuje sve korake zajedno. Paralelna korišćenja istog linka daju samo jedan uspjeh; greška pri čuvanju nove sesije vraća i staru lozinku/sesije/link.
7. Controller postavlja postojeći HttpOnly kolačić. Browser prihvata nalog kroz `setUser`, uklanja fragment i otvara početni ekran po ulozi. Stara lozinka i stari sesijski kolačići više ne važe. Samo otvaranje linka ne mijenja lozinku.

U lokalnom `AUTH_EMAIL_MODE=local` režimu email je u Mailpit-u na http://127.0.0.1:8025. Isti `EmailService` koristi konfigurisan SMTP pri stvarnoj dostavi. Istekli reset zapisi se čiste postojećim minutnim auth timerom; serverski rok važi i bez timera.

## Fajlovi i odgovornosti

| Fajl                                                      | Odgovornost                                          |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `apps/web/src/features/auth-pages.tsx`                    | Prijava, podaci za registraciju i unos koda          |
| `apps/web/src/features/account.tsx`                       | Vlastiti podaci i uređivanje profila                 |
| `apps/web/src/features/account-profile-summary.tsx`       | Pregled potvrđenih ličnih i kontakt podataka         |
| `apps/web/src/components/account-menu.tsx`                | Padajući nalog, profil i serverska odjava            |
| `apps/web/src/features/account-profile-editor.tsx`        | Izmjena ličnih podataka klijenta i terapeuta         |
| `apps/web/src/features/dashboard.tsx`                     | Radni prostor stvarnog terapeuta                     |
| `apps/web/src/features/demo-dashboard.tsx`                | Odvojeni probni tok rezervacija                      |
| `apps/web/src/features/therapist-profile-editor.tsx`      | Profesionalna polja zajedničkog formulara            |
| `apps/web/src/features/therapist-registration-fields.tsx` | Dodatna polja stručnog profila i početne usluge      |
| `apps/web/src/features/therapist-account-profile.tsx`     | Vlastiti terapeutski profil učitan iz baze           |
| `apps/web/src/lib/auth-client.ts`                         | HTTP pozivi i prikaz grešaka                         |
| `apps/web/src/lib/auth-context.tsx`                       | Učitavanje stvarne serverske sesije                  |
| `apps/web/next.config.ts`                                 | Proxy auth zahtjeva sa iste adrese sajta             |
| `apps/api/src/auth/auth.controller.ts`                    | HTTP, dozvoljeni Origin i kolačići                   |
| `apps/api/src/auth/auth.service.ts`                       | Registracija, zaključavanja, pokušaji i sesije       |
| `apps/api/src/auth/auth.validation.ts`                    | Serverska provjera unosa                             |
| `apps/api/src/auth/auth.crypto.ts`                        | Hash lozinke, tokena i koda                          |
| `apps/api/src/auth/auth.jwt.ts`                           | Potpis i provjera JWT-a, rok i namjena               |
| `apps/api/src/auth/email.service.ts`                      | SMTP slanje i provjera prihvatanja                   |
| `apps/api/src/database.service.ts`                        | PostgreSQL konekcije                                 |
| `apps/api/src/config.ts`                                  | Učitavanje `.env` i provjera konfiguracije           |
| `db/migrations/002-auth.sql`                              | Nova polja korisnika i auth tabele                   |
| `db/migrations/003-therapist-registration.sql`            | Vrsta registracije i privremeni profesionalni podaci |
| `db/migrations/006-profile-contact.sql`                   | Privatni grad i adresa klijenta                      |

Browser nema pristup JWT tokenu kroz JavaScript: kolačić je `HttpOnly`, `SameSite=Lax`, a u produkciji i `Secure`. JWT koristi HS256, `sub` (ID korisnika), `role`, nasumični `jti`, `iat`, `exp`, `iss` i `aud`, prema [dokumentaciji jsonwebtoken biblioteke](https://github.com/auth0/node-jsonwebtoken). Potpis, dozvoljeni algoritam, rok i namjena provjeravaju se prije pristupa nalogu. Sesija traje sedam dana, njen SHA-256 hash postoji u `auth_sessions`, provjerava se pri pristupu zaštićenom API-ju i briše pri odjavi. API dodatno provjerava potvrdu emaila, suspenziju i podudarnost uloge sa bazom; promjena uloge zahtijeva novu prijavu. Vlasnik se određuje iz sesije, ne iz ID-a ili demo uloge koju browser pošalje.

Stari ne-JWT kolačići više ne važe i korisnik se prijavljuje ponovo. Nova SQL migracija nije potrebna.

Samo oznaka nepotvrđene registracije, email i vrijeme ponovnog slanja kratko ostaju u `sessionStorage` tog taba, da osvježavanje ne izgubi korak koda. Lozinka i kod se tamo ne čuvaju. Poslije potvrde privremeni zapis se uklanja. Ovaj zapis nije sesija niti autentifikacija.

Svaki minut API uklanja istekle sesije, istekle brojače i nepotvrđene zahtjeve starije od jednog dana. Timer se uklanja pri gašenju. Rok i broj pokušaja provjeravaju se direktno u poslovnim radnjama, nezavisno od timera.

## Migracije i provjere

`db/schema.sql` ostaje početna šema. Docker je primjenjuje samo na novom volumenu. `npm.cmd run db:migrate` redom primjenjuje migracije od `002-auth` do `008-date-availability` bez reseta ili uklanjanja rezervacija. Evidentirane migracije iz `schema_migrations` preskaču se pri ponovnom pokretanju.

Osnovne provjere su `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build` i `npm.cmd run format:check`.

Za integracione API provjere:

```powershell
$env:AUTH_TEST_DATABASE_URL = "postgresql://terapeut:local-development-only@127.0.0.1:5432/terapeut"
npm.cmd test
```

Testovi kreiraju i brišu samo svoju nasumičnu `auth_test_...` šemu, ne stvarne podatke. Bez `AUTH_TEST_DATABASE_URL` PostgreSQL integracione provjere su preskočene i test izlaz to navodi.

Browser auth provjere koriste poseban API, zasebnu testnu šemu i lokalni Mailpit, bez spoljne dostave. Pogledajte komandu `npm.cmd run test:auth:e2e` u README-u.

## Prije javnog puštanja

Koristite HTTPS, serverske tajne, Resend HTTPS ili dozvoljeni SMTP servis i tačne `WEB_ORIGINS` adrese. Postojeći lokalni DB korisnik/lozinka i javni razvojni portovi nijesu podešavanje javne produkcije. `NODE_ENV=production` odbija lokalni email režim i frontend adrese bez HTTPS-a. Privremeni `disabled` režim služi pripremi hostinga prije uključivanja emaila i ne omogućava novu registraciju.

IP ograničenje trenutno koristi adresu stvarne socket veze. Iza Next.js proxy-ja to je zajednička adresa proxy-ja, pa je limit konzervativan i dijeljen. Javni deployment treba dodatno ograničenje na pouzdanom reverse proxy-ju; ne prihvatajte proizvoljna `X-Forwarded-For` zaglavlja kao dokaz identiteta.

JWT prijava i stvarni terapeutski dashboard su odvojeni od demo dashboarda na `/demo/dashboard`. Terapeut čita/čuva vlastiti profil, vrste seanse, raspored i zahtjeve iz baze, a pacijent bira aktivnu seansu terapeuta i vidi samo svoje zahtjeve. Novi terapeut dobija početnu seansu koju je unio; radno vrijeme i dodatne seanse unosi na dashboardu. Detalji provjera vlasništva, transakcija i istorije su u [scheduling.md](scheduling.md). Admin endpointi još ne postoje. Konačna politika privatnosti, uslovi i pravila uklanjanja naloga ostaju za dogovor prije javne upotrebe.
