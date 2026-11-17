# Terapeut.me

Početna lokalna verzija, napravljena prema dogovoru o kalendaru, uslugama i zahtjevima.

Ako tek upoznajete Next.js i NestJS, počnite od [vodiča za čitanje i održavanje koda](docs/maintaining.md). On pokazuje gdje je koji ekran, šta funkcije rade i kako zahtjev prolazi od formulara do čuvanja.

## Pokretanje

Potrebni su Node.js 22.12+ i npm. Na Windowsu koristite `npm.cmd` ako PowerShell ne dozvoljava `npm.ps1`.

```powershell
npm.cmd install
docker compose up -d db mailpit
# Prvo podesite .env i AUTH_SECRET prema docs/auth.md.
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Otvorite http://localhost:3000. Katalog, profili, radno vrijeme, rezervacije i istorija koriste bazu i API. Terapeut unosi trajanje seanse od 5 do 240 minuta. Tok zakazivanja i vodič za debugging su u [scheduling.md](docs/scheduling.md), email u [auth.md](docs/auth.md), a fotografije u [directory.md](docs/directory.md).

API osnova se pokreće u drugom terminalu:

```powershell
npm.cmd run dev:api
```

Provjera: http://localhost:4000/api/v1/health.

## Šta radi

- MNE/EN početna stranica, katalog sa URL filterima i javni profili.
- Registracija na `/register`: ime, prezime, email, datum rođenja i lozinka, pa četvorocifreni email kod.
- Posebna registracija na `/register/therapist`: THERAPIST nalog, profesionalni profil i početna usluga, povezani sa bazom i email potvrdom.
- JWT prijava na `/login`: pacijent otvara katalog `/psychotherapy`, terapeut radni prostor `/dashboard`. Vlastiti nalog i uređivanje profesionalnih podataka/fotografija su na `/account`; odjava opoziva sesiju u PostgreSQL-u.
- Javni stručnjaci, usluge/dostupnost i novoregistrovani profili iz baze. Terapeut dodaje i bira svoje fotografije u `/account`; prikazuju se u katalogu i javnoj galeriji.
- Izbor usluge, datum u kalendaru i dostupni intervali; početci na 15 minuta od početka slobodnog intervala.
- Zahtjev u bazi odmah zauzima vrijeme za sva trajanja seanse; drugi klijenti vide zauzetost. Zaključavanje, nova provjera i SQL zabrana preklapanja štite paralelne upise.
- Klijentski pregled: povlačenje/otkazivanje i prihvatanje/odbijanje novog termina.
- Terapeutski pregled: potvrda, odbijanje, A → B, otkazivanje i ispravka ishoda seanse.
- Nedjeljni kalendar, uređivanje usluga i ponavljajuće dostupnosti.
- Admin demo: verifikacija, aktivnost profila i stvarni `.xlsx` izvoz zahtjeva i istorije promjena.
- Evidencija otkazivanja, nedolaska i zahtjeva bez odgovora.
- Prilagodljiv prikaz za telefon, označena stanja i kontrole dostupne tastaturom.

Na `/demo/dashboard` promijenite demo ulogu da isprobate cijeli tok. Probne podatke možete resetovati pri dnu pregleda.

## Granice početne verzije

**Javno zakazivanje i `/dashboard` koriste stvarne naloge i PostgreSQL.** `localStorage` rezervacije ostaju samo na `/demo/dashboard` i `/demo/therapist/[id]/book`. Demo uloge ne daju serverske dozvole i njihove izmjene ne mijenjaju stvarne zahtjeve.

Email potvrda koristi SMTP: lokalni Mailpit za testiranje ili konfigurisan servis za stvarnu dostavu. Stvarni raspored, seanse, zahtjevi, promjene statusa i isticanje rade na serveru. Booking emailovi, podsjetnik u 08:00 i admin upravljanje još nijesu uključeni. Demo Excel se preuzima lokalno.

NestJS API izlaže health, auth, katalog, fotografije, `/schedule`, `/bookings` i javnu `/therapists/:id/slots` zauzetost. Upis i privatno čitanje provjeravaju JWT, ulogu i vlasništvo. Admin endpointi još nijesu implementirani.

Google Fonts se opciono učitavaju iz CSS-a; ako mreža nije dostupna koristi se sistemski font. Demo nema analitiku.

## Struktura

```text
apps/web/          Next.js + React: javni sajt i demo pregledi
apps/api/          NestJS autentifikacija, SMTP i PostgreSQL pristup
packages/domain/   zajednički tipovi, računanje dostupnosti i promjene zahtjeva
db/schema.sql      početna PostgreSQL migracija
db/migrations/    dodatne migracije za postojeću bazu
docs/auth.md      registracija, sesije i konfiguracija emaila
docs/decisions.md  prihvaćena pravila, demo pretpostavke i otvorene odluke
docs/maintaining.md vodič kroz kod i mjesto svake odgovornosti
compose.yaml      lokalni PostgreSQL i Mailpit
```

## PostgreSQL

Ako imate Docker, `docker compose up -d db` kreira lokalnu bazu i primjenjuje `db/schema.sql` na novom volumenu. Lokalna lozinka je samo za razvoj; ne koristiti je u produkciji.

Model sadrži korisnike, profile, usluge, sedmične prozore dostupnosti, blokade, zahtjeve, istoriju, audit, legal acceptance i notification outbox. PostgreSQL exclusion constraint sprečava preklapanje aktivnih rezervacija istog terapeuta. Promjena A → B treba da bude jedna transakcija zajedno sa istorijom i outbox događajem. Servis mora dodatno provjeravati dostupnost i blokade.

## Provjere

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:auth:e2e
npm.cmd run format:check
```

Za E2E potreban je Playwright Chromium: `npx.cmd playwright install chromium`. Može se koristiti instalirani Edge uz `$env:PLAYWRIGHT_CHANNEL = "msedge"`. Demo testovi koriste port 3100. Auth testovi zahtijevaju prethodni API build i `docker compose up -d db mailpit`; pokreću zaseban API na 4100 i frontend na 3200, sa izolovanom testnom šemom i lokalnim email sandučetom. Ne šalju email spoljnim primaocima.

## Sljedeća faza

Booking emailovi koriste trajni red i isti SMTP kao registracija; tok, retry i debugovanje opisani su u [docs/booking-notifications.md](docs/booking-notifications.md). Dodati admin dozvole i verifikaciju, podsjetnike i konačna pravila arhive, brisanja i privatnosti. Samo admin mijenja verifikaciju i administrativnu aktivnost.
