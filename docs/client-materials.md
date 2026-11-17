# Privatni materijali i domaći zadaci

Terapeut na `/dashboard` otvara **„Materijali i domaći zadaci“**, bira klijenta i klikne **„Dodaj materijal ili zadatak“**. Može izabrati domaći zadatak, vježbu, dnevnik ili preporučeni materijal, unijeti naslov i uputstvo, opcioni http/https link, rok i jedan PDF do 5 MB. Potrebno je bar uputstvo, link ili PDF. Za više dokumenata prave se zasebni materijali.

Klijenti u izboru dolaze iz terapeutovih potvrđenih ili ranije održanih seansi. Sam zahtjev bez potvrde ne uspostavlja ovu vezu. Ranija potvrđena, a kasnije otkazana seansa zadržava vezu preko `confirmed_at`. Klijent mora imati potvrđen, nesuspendovan nalog. Terapeut ne traži proizvoljne korisnike po emailu.

Klijent u meniju **„Moj nalog“**, odmah ispod **„Moji termini“**, bira **„Domaći zadaci i materijali“**. Ista prečica je na vrhu `/account`, odmah poslije termina. Link vodi direktno na `#my-materials` i zatvara meni i kada je korisnik već na toj stranici. Terapeutu ista stavka vodi na `/dashboard#my-materials`.

Početno učitavanje rezervacija mijenja visinu dijela iznad materijala. Zato `ServerBookings` poslije svog prvog učitavanja ponovo pomjera pregled na `#my-materials`, samo ako je baš ta sekcija izabrana u adresi. Efekat zavisi od početnog `loading` stanja; redovno osvježavanje ne pomjera korisnikov skrol.

Klijent vidi isključivo materijale dodijeljene njegovom nalogu, sa nazivom terapeuta, uputstvom, rokom i dugmetom **„Preuzmi PDF“**. Ako ima više terapeuta, vidi njihove materijale zajedno; svaki terapeut vidi samo ono što je sam dodijelio. Nema javnih PDF adresa ili prikaza u katalogu. Preporučeni link se otvara u novom tabu, a sadržaj uputstva se prikazuje kao običan tekst.

## Uređivanje i povlačenje

„Uredi materijal“ mijenja naslov, vrstu, uputstvo, link, rok i prilog. Bez novog fajla čuva se postojeći PDF. Novi fajl ga zamjenjuje, a checkbox ga uklanja. Ne može se istovremeno poslati novi PDF i označiti uklanjanje. Primalac postojećeg materijala ostaje isti; za drugog klijenta pravi se novi unos. Broj `version` sprečava da stari formular pregazi noviju izmjenu.

„Povuci materijal“ traži potvrdu, zatim postavlja `archived_at`. Materijal nestaje iz oba pregleda i server odbija preuzimanje starom adresom. Zapis i PDF ostaju u bazi; ovo nije trajno brisanje. Ako je klijent već preuzeo dokument na svoj računar, povlačenje ne može ukloniti tu lokalnu kopiju. Ova funkcija prikazuje zadatke i predloške dnevnika; predaja odgovora i uređivanje klijentovog dnevnika nijesu dio ovog toka.

## Fajlovi i API

| Fajl                                             | Uloga                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `db/migrations/012-client-materials.sql`         | Privatna veza terapeut–klijent, tekst, PDF `bytea`, rok, verzija i arhiva |
| `apps/api/src/materials/materials.validation.ts` | Naslov, tekst, vrsta, datum, dozvoljeni link i osnovna provjera PDF-a     |
| `apps/api/src/materials/materials.service.ts`    | Vlasništvo, veza sa klijentom, čitanje, atomski upis/izmjena i povlačenje |
| `apps/api/src/materials/materials.controller.ts` | Sesija prije multipart parsiranja i privatno preuzimanje                  |
| `apps/api/src/auth/auth.controller.ts`           | Origin provjera dozvoljava multipart samo za tačne upload adrese          |
| `apps/web/src/lib/materials-client.ts`           | Pozivi sa JWT kolačićem i privremeni browser URL za preuzimanje           |
| `apps/web/src/features/materials.tsx`            | Pregled, izbor klijenta, formular, kartica i indikatori čekanja           |
| `apps/web/src/features/account.tsx`              | Klijentov pregled i prečica                                               |
| `apps/web/src/features/dashboard.tsx`            | Terapeutov pregled i prečica                                              |

- `GET /api/v1/client-materials`: vlastiti metapodaci i uputstva; terapeutu i njegovi klijenti. PDF bajtovi nijesu dio liste.
- `POST /api/v1/client-materials`: multipart sa `clientUserId`, `kind`, `title`, `instructions`, `resourceUrl`, `dueDate` i opcionim `file`.
- `POST /api/v1/client-materials/:id/update`: isti sadržaj uz `version` i opcioni `removeFile`; klijent se ne mijenja.
- `POST /api/v1/client-materials/:id/archive`: JSON sa `version`.
- `GET /api/v1/client-materials/:id/file`: PDF isključivo za primaoca i terapeuta koji ga je dodijelio, poslije nove JWT provjere.

## Čuvanje i debugging koraci

1. `MaterialsSessionGuard` provjerava nalog/ulogu prije učitavanja multipart fajla i ograničava pokušaje slanja. `AuthOriginGuard` zahtijeva dozvoljenu aplikaciju.
2. `validateMaterial` provjerava polja i dozvoljava samo http/https linkove bez korisničkog imena/lozinke. Server ih ne otvara i ne preuzima sadržaj sa tih adresa.
3. `validateMaterialFile` provjerava stvarni broj bajtova, limit, PDF početak i završnu oznaku, te naziv. Ovo je osnovna provjera formata, nije potpuni PDF parser niti antivirus. Dokument se preuzima kao prilog, bez javnog ugrađenog prikaza.
4. `MaterialsService.save` ponovo provjerava sesiju, zaključava terapeutov profil, provjerava vezu pri dodjeli ili vlasništvo/verziju pri izmjeni. Tekst i PDF se čuvaju zajedno u jednoj transakciji. Greška vraća ranije stanje.
5. Tek poslije `COMMIT` formular dobija potvrdu. Pregled se ponovo učitava, a zelena poruka nestaje poslije četiri sekunde. `noticeVersion` daje novi ključ potvrdi za svaku uspješnu radnju, pa se isti tekst ponovo prikazuje pri uzastopnom čuvanju/povlačenju. Greška zadržava unos. Spinner i blokirane kontrole traju do odgovora servera. Prazan izabrani PDF dobija jasnu poruku prije slanja.
6. Pregled se osvježava ručno, svakih 30 sekundi i pri povratku u tab. Otvoreni formular zadržava svoj snimak; tuđa novija verzija dovodi do jasne greške pri čuvanju. Efekti uklanjaju timer, slušače i čekanje pri odjavi.
7. `download` u servisu provjerava primaoca/vlasnika i arhivu za svaki zahtjev. Odgovor koristi `private, no-store`, `application/pdf`, `attachment` i `nosniff`. Browser preuzima fajl i uklanja privremeni URL. Dokumenti se čuvaju u PostgreSQL-u, pa su dio iste rezervne kopije kao ostali podaci.

Za debugging postavite breakpoint u `requireClient` kada klijent nedostaje u izboru, `save` prije SQL upisa, poređenje `version` kod konflikta, `download` kod nedostupnog PDF-a i `archive` kod povlačenja. Ne logujte JWT, sadržaj zadataka ili PDF bajtove. API testovi su u `apps/api/test/materials.test.ts`, browser tokovi u `tests/auth-e2e/materials.spec.ts`; mali testni PDF nastaje u `tests/fixtures/material-pdf.ts` bez podataka stvarnih klijenata.
