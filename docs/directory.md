# Katalog iz baze i fotografije

Početna stranica, katalog, javni profil i usluge/dostupnost u kalendaru čitaju PostgreSQL preko NestJS API-ja. `localStorage` nije izvor javnih profila. Novi terapeut se poslije email potvrde pojavljuje u istom katalogu.

## Pokretanje i uvoz probnih stručnjaka

Iz korijena projekta, uz pokrenut Docker:

```powershell
docker compose up -d db mailpit
npm.cmd run db:migrate
npm.cmd run db:seed
```

`db:seed` uvozi četiri postojeća izmišljena profila, njihove usluge i sedmične dostupnosti. Ponovno pokretanje ne pravi duplikate i ne prepisuje kasnije izmjene. Postojeći registrovani terapeuti ostaju sačuvani. Konflikt testnog emaila sa drugim nalogom prekida uvoz umjesto preuzimanja tog naloga.

Za izričit lokalni reset lozinki svih povezanih terapeutskih naloga, uključujući nove registrovane profile:

```powershell
npm.cmd run db:seed -- --test-passwords
```

Ova opcija postavlja hash lozinke `Test123` i opoziva ranije sesije terapeuta. Ne mijenja klijente ni admine. Komanda odbija udaljenu bazu i `NODE_ENV=production`. Javno pravilo registracije ostaje 15–128 znakova: kratka testna lozinka je samo razvojno podešavanje koje je korisnik izričito zatražio.

| Probni profil    | Email                         | Lokalna lozinka |
| ---------------- | ----------------------------- | --------------- |
| Ana Marković     | ana.markovic@example.test     | Test123         |
| Milica Jovanović | milica.jovanovic@example.test | Test123         |
| Jelena Petrović  | jelena.petrovic@example.test  | Test123         |
| Maja Radović     | maja.radovic@example.test     | Test123         |

Poslije ovoga API pokrenite sa `npm.cmd run dev:api`, a frontend sa `npm.cmd run dev`. Prijava je na `/login`, a vlastiti profil i fotografije su u `/account`. Komanda uvoza ispisuje i emailove drugih postojećih terapeutskih naloga.

## Tok podataka

`DirectoryProvider` u `lib/directory-context.tsx` čita `/api/v1/therapists`. Pri povratku u tab, novoj registraciji ili promjeni fotografije ponovo čita podatke. Prethodni HTTP zahtjev se prekida da stariji odgovor ne prepiše noviju fotografiju.

`DirectoryService` čita javne podatke, usluge, dostupnost, blokade i metapodatke fotografija u jednom SQL snimku. Ne vraća email, telefon, datum rođenja, hash lozinke ili ID vlasnika. Neaktivni profili i suspendovani nalozi se ne prikazuju.

Postojeći linkovi ostaju `/therapist/ana-markovic` i slično: `therapists.public_id` čuva prethodnu oznaku. `services.public_id` čuva prethodne oznake usluga radi postojeće demo istorije. Novi profil koristi UUID kao javnu oznaku. Nedostajući podaci o obrazovanju, jezicima ili pristupu se ne izmišljaju.

Stvarni `BookingFlow` čita živu zauzetost i šalje zahtjev API-ju. Radno vrijeme i rezervacije čuvaju se u bazi, uz dijeljenu zauzetost za sva trajanja. Tok i debugging su u [scheduling.md](scheduling.md). `DemoBookingFlow` i `DemoProvider` ostaju na odvojenim `/demo/...` adresama; demo administracija ne mijenja bazu ni javni katalog.

## Fotografije

Prijavljeni terapeut u **Moj nalog → Vaše fotografije** dodaje JPEG, PNG ili WebP, do 5 MB po datoteci i najviše osam fotografija. Prva postaje profilna; drugu može postaviti kao profilnu ili obrisati svoju sliku. Nakon brisanja profilne bira se najstarija preostala.

Server prije parsiranja datoteke provjerava sesiju, ulogu i dozvoljeni Origin. Poslovni servis ponovo provjerava vlasništvo. Naziv datoteke i ID drugog terapeuta ne odlučuju gdje će slika biti sačuvana.

`normalizePhoto` provjerava stvarne početne bajtove i dekodiranje, odbija SVG/lažne/animirane datoteke i slike iznad 16 miliona piksela. Ispravnu sliku okreće prema EXIF orijentaciji, smanjuje na najviše 1600 × 1600 i ponovo kodira u WebP bez EXIF podataka. Ne čuva originalnu datoteku ili korisničku putanju.

`therapist_photos` čuva WebP bajtove (`bytea`), dimenzije, vlasnika i oznaku profilne. Izmjene zaključavaju red terapeuta, pa paralelni upload ne zaobilazi limit osam slika. Jedinstveni indeks dozvoljava samo jednu profilnu sliku po terapeutu.

Javni `/api/v1/therapist-photos/:id` šalje samo slike aktivnih profila kao `image/webp`, sa `nosniff` i bez dugog cache-a. Obrišana slika ili slika neaktivnog/suspendovanog profila vraća 404. Katalog prikazuje profilnu sliku, a profil i cijelu galeriju. Bez slike ostaju inicijali; nema izmišljenih portreta stručnjaka.

Za ovaj lokalni projekat slike su u bazi. Pri većem produkcionom prometu moguće je zasebno objektno skladište uz iste provjere uloge/vlasništva; takvo skladište nije trenutno uključeno.

## Važni fajlovi

| Fajl                                                | Odgovornost                                   |
| --------------------------------------------------- | --------------------------------------------- |
| `db/migrations/004-directory-photos.sql`            | Javni podaci, stabilne oznake i fotografije   |
| `apps/api/src/directory/directory.service.ts`       | Čitanje javnog kataloga                       |
| `apps/api/src/directory/directory.controller.ts`    | Javni profil/slika i zaštićeni upload         |
| `apps/api/src/directory/photos.service.ts`          | Dekodiranje, čuvanje i vlasništvo fotografija |
| `apps/api/src/directory/seed-directory.ts`          | Uvoz iz postojećih seed podataka              |
| `apps/api/src/seed-directory.ts`                    | Lokalna CLI komanda i testni reset lozinki    |
| `apps/web/src/lib/directory-context.tsx`            | Učitavanje javnih podataka iz API-ja          |
| `apps/web/src/features/therapist-photos-editor.tsx` | Izbor, upload, profilna slika i brisanje      |

Testovi koriste odvojene šeme. Provjeravaju idempotentan uvoz, prijave, izmjene kataloga iz baze, format slike, tuđe naloge, paralelni limit, profilnu sliku i javni prikaz.
