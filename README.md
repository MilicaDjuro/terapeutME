# Terapeut.me

Početna lokalna verzija, napravljena prema dogovoru o kalendaru, uslugama i zahtjevima.

Ako tek upoznajete Next.js i NestJS, počnite od [vodiča za čitanje i održavanje koda](docs/maintaining.md). On pokazuje gdje je koji ekran, šta funkcije rade i kako zahtjev prolazi od formulara do čuvanja.

## Pokretanje

Potrebni su Node.js 22.12+ i npm. Na Windowsu koristite `npm.cmd` ako PowerShell ne dozvoljava `npm.ps1`.

```powershell
npm.cmd install
npm.cmd run dev
```

Otvorite http://localhost:3000. Frontend radi samostalno, bez baze i email servisa.

API osnova se pokreće u drugom terminalu:

```powershell
npm.cmd run dev:api
```

Provjera: http://localhost:4000/api/v1/health.

## Šta radi

- MNE/EN početna stranica, katalog sa URL filterima i javni profili.
- Izbor usluge, datum u kalendaru i dostupni intervali; početci na 15 minuta od početka slobodnog intervala.
- Zahtjev zauzima izabrano vrijeme i blokira preklapanja za sve usluge terapeuta.
- Klijentski pregled: povlačenje/otkazivanje i prihvatanje/odbijanje novog termina.
- Terapeutski pregled: potvrda, odbijanje, A → B, otkazivanje i ispravka ishoda seanse.
- Nedjeljni kalendar, uređivanje usluga i ponavljajuće dostupnosti.
- Admin demo: verifikacija, aktivnost profila i stvarni `.xlsx` izvoz zahtjeva i istorije promjena.
- Evidencija otkazivanja, nedolaska i zahtjeva bez odgovora.
- Prilagodljiv prikaz za telefon, označena stanja i kontrole dostupne tastaturom.

U dashboardu promijenite demo ulogu da isprobate cijeli tok. Probne podatke možete resetovati pri dnu pregleda.

## Granice početne verzije

**Ovo je funkcionalni browser demo, ne produkciona platforma.** Profili su izmišljeni. Podaci se čuvaju u `localStorage`, a sve uloge su javno dostupne u tom browseru. Ne unosite stvarne kontakt podatke.

Nema stvarnih naloga, registracije, OTP-a, server-side RBAC-a, email slanja, automatskog podsjetnika u 08:00 ni pozadinskog posla kada je browser zatvoren. Excel se preuzima lokalno; ne šalje se adminu. Lokalna provjera preklapanja nije garancija protiv istovremenih zahtjeva sa različitih uređaja.

NestJS API trenutno izlaže samo health endpoint i nije povezan sa frontendom ili bazom. Nema nezaštićenih booking/admin endpointa koji bi izgledali kao produkciona implementacija.

Google Fonts se opciono učitavaju iz CSS-a; ako mreža nije dostupna koristi se sistemski font. Demo nema analitiku.

## Struktura

```text
apps/web/          Next.js + React: javni sajt i demo pregledi
apps/api/          NestJS osnova za backend
packages/domain/   zajednički tipovi, računanje dostupnosti i promjene zahtjeva
db/schema.sql      početna PostgreSQL migracija
docs/decisions.md  prihvaćena pravila, demo pretpostavke i otvorene odluke
docs/maintaining.md vodič kroz kod i mjesto svake odgovornosti
compose.yaml      lokalni PostgreSQL
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
npm.cmd run format:check
```

Za E2E potreban je Playwright Chromium: `npx.cmd playwright install chromium`. Testovi pokreću svoj server na portu 3100, koriste izolovan browser i ne šalju email.

## Sljedeća faza

Povezati PostgreSQL, implementirati server-side autentifikaciju/vlasništvo i API koristeći provjerena domenska pravila, zatim outbox, email, podsjetnike i serversko isticanje zahtjeva. Registrovani terapeuti uređuju profil i usluge; samo admin mijenja verifikaciju i administrativnu aktivnost. Prije stvarnog korišćenja zatvoriti pravila arhive i brisanja, privatnost i provjeriti produkcione dozvole i konkurentne transakcije.
