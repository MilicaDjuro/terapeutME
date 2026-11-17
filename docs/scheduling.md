# Radno vrijeme, seanse i rezervacije

Ovaj tok koristi PostgreSQL i stvarnu JWT prijavu. Terapeut na `/dashboard` uređuje radno vrijeme i svaku seansu: naziv, trajanje od 5 do 240 minuta i opcionu cijenu. Pacijent bira ponuđenu aktivnu seansu na `/therapist/[id]/book`. Privatni zahtjevi pacijenta su na `/account`, a terapeuta na `/dashboard`.

## 1. Pokretanje i migracija

Lista čekanja dodaje automatsku dodjelu oslobođenog vremena prvom odgovarajućem klijentu. Formular, pravila redosljeda, transakcije i debugging koraci opisani su u [waitlist.md](waitlist.md).

Iz korijena projekta pokrenite `npm.cmd install`, `docker compose up -d db mailpit`, pa `npm.cmd run db:migrate`. Tabela `services` već podržava cijela trajanja od 5 do 240 minuta. Stara migracija `005-booking-sessions.sql` predstavljala je prethodni dogovor za 30/60 minuta. Loader sada preskače svaku migraciju koja je već evidentirana u vlastitoj `schema_migrations` tabeli; ponovno pokretanje ne isključuje nove seanse od 40/50 minuta. Ranije neaktivne seanse ne vraćaju se automatski. Terapeut ih može zamijeniti novom aktivnom vrstom seanse, bez brisanja ranije istorije.

Pokrenite `npm.cmd run dev:api` i `npm.cmd run dev` u dva terminala. Root npm komande prvo kompajliraju `packages/domain` da isti kod pravila mogu koristiti NestJS i Next.js. TypeScript izlaz je u `packages/domain/dist`; taj folder je generisan i ne uređuje se ručno. Poslije promjene pravila ponovo pokrenite `npm.cmd run build --workspace=@terapeut/domain` i restartujte API.

## 2. Terapeut unosi kada radi

`features/schedule-editor.tsx` učitava `GET /api/v1/schedule`. Server iz JWT sesije čita vlasnika i njegov profil; ID terapeuta iz formulara ne daje dozvolu.

Terapeut dodaje dan u nedjelji i interval od–do. Može dodati više intervala istog dana ako se ne preklapaju, na primjer 09–12 i 14–18. Interval se ponavlja sedmično. Nema pretpostavljenog radnog vremena za novoregistrovani profil: terapeut ga prvo unosi. Poseban formular i API radnje za pauze/odsustva uklonjeni su na zahtjev korisnika. Zakazani zahtjevi i istorija ostaju sačuvani.

Ako isti dan i isti interval već postoje, API vraća `notice: window-already-exists`, a formular prikazuje „Radno vrijeme je već sačuvano“. Novi red se ne pravi. Provjera je poslije zaključavanja profila, pa važi i za paralelne klikove. Drugačiji interval koji se preklapa i dalje se odbija sa jasnom porukom „Radno vrijeme se preklapa sa već sačuvanim periodom“. Dugme „Uredi period“ otvara postojeći sedmični red: dan i vrijeme se mijenjaju slanjem istog `id`, bez prethodnog uklanjanja. Server provjerava budući raspored bez stare verzije tog reda; greška ostavlja ranije sate sačuvanim.

`POST /schedule` prihvata `window`, `remove-window`, `date-availability`, `remove-date`, `service` i `remove-service`. Za seansu se šalju `name`, `duration` i `price`; `serviceId` se šalje samo pri izmjeni postojeće seanse. Server provjerava da ta seansa pripada trenutnom terapeutu. Uklanjanje postavlja `is_active=false`, a raniji zahtjevi ostaju sačuvani. Stare radnje `block` i `remove-block` nijesu dostupne. Radno vrijeme se šalje u minutima od ponoći; `weekday=0` je nedjelja, `weekday=1` ponedjeljak, 09:00 je 540. Svaki upis zaključava isti red terapeuta kao zakazivanje.

`features/session-editor.tsx` prikazuje formular svake aktivne seanse i prazan formular za dodavanje nove. Prazna cijena ostaje „Na upit“; unesena nula je 0 €. Promjena naziva, trajanja ili cijene ne mijenja kopije u ranijoj rezervaciji. Registracija kreira samo početnu seansu koju terapeut unese; nema automatskog dodavanja drugog trajanja.

### Dostupnost za konkretan datum

`features/availability-editor.tsx` sadrži `WeeklyWindowEditor` i `DateAvailabilityEditor`. Roditeljski `ScheduleEditor.saveSchedule` vodi HTTP poziv, poruke uspjeha/greške i osvježavanje kataloga; formular zadržava unos ako čuvanje ne uspije. Dashboard prvo prikazuje zahtjeve i link ka uređivanju profila; usluge, sedmični raspored i posebni datumi otvaraju se kroz tri padajuće sekcije. Zatvaranje sekcije ne briše lokalni unos.

`components/time-field.tsx` koristi obične padajuće liste za sat i minut, dostupne tastaturom i na telefonu. Sati su 00–23, a minuti 00–59. Pri čuvanju `readTimeField(form, "start")` spaja `start-hour` i `start-minute`, pa `timeToMinutes` daje broj za postojeći API. Isti unos koristi predlog drugog termina. `form.reset()` nakon novog sačuvanog datuma vraća početne izbore bez dodatnog React stanja. Početna vrijednost izmjene dolazi iz sačuvanog intervala, a završetak 00:00 i dalje označava kraj dana.

Migracija `008-date-availability.sql` dodaje `availability_dates`. Jedan aktivan red po terapeutu i datumu sadrži jedan radni period ili oznaku cijelog neradnog dana. Poseban raspored **zamjenjuje** sedmične sate samo za taj datum. Na primjer, redovan utorak 09–17 i posebni 20. oktobar 11–14 znače da se 20. oktobra nude samo sati 11–14, a naredni utorak ostaje 09–17. Konkretan datum može biti radan i kada nema sedmičnih sati za taj dan.

1. „Sačuvaj datum“ šalje `action: date-availability`, datum i tekst `working: true/false`. Kod radnog dana šalje minute od/do; `false` čuva `NULL` vremena. To je raspored cijelog dana, bez vraćanja formulara za pojedinačne pauze.
2. `BookingService.saveSchedule` provjerava JWT terapeuta, datum u narednih 90 dana i redosljed sati. Unutar transakcije zaključava njegov profil, pa upisuje samo vlastiti red. Dva konkurentna unosa istog datuma ne mogu napraviti duplikat zbog djelimičnog jedinstvenog indeksa.
3. „Uredi datum“ šalje isti `id` sa novim datumom/satima. Ako ciljni datum već ima poseban raspored, API vraća 409 i stari red ostaje nepromijenjen. Pomjeranje datuma vraća stari datum na sedmične sate.
4. „Vrati sedmični raspored“ postavlja `is_active=false`. Ne briše rezervacije. Neradni dan se ne uklanja ovim dugmetom ako želite da ostane zatvoren; otvorite ga kroz „Uredi datum“ i odznačite „Radim ovog datuma“.
5. `DirectoryService.list` u istom SQL snimku vraća buduće aktivne datume kao `dateAvailability`. `freeRanges` prvo bira konkretan datum ili redovan sedmični raspored, pa oduzima postojeću zauzetost. Isto pravilo koriste automatski izbor prvog dana u `BookingFlow` i serverska provjera slanja zahtjeva.

Promjene dostupnosti ne pomjeraju i ne otkazuju već zakazanu seansu. Raniji zahtjevi zadržavaju prvobitni datum, vrijeme, naziv, trajanje, cijenu i događaje istorije. Za pomjeranje klijentovog termina koristi se postojeći predlog A → B.

## 3. Pacijent bira seansu i vrijeme

`features/booking-flow.tsx` prikazuje sve aktivne seanse iz baze. `components/server-calendar.tsx` čita `GET /therapists/:id/slots?duration=50&date=YYYY-MM-DD` i prikazuje slobodne i stvarno zauzete početke. Zauzeta dugmad su siva i onemogućena. Sva trajanja koriste istu zauzetost terapeuta. Poslije seanse 09:00–09:40 sljedeći slobodan period počinje u 09:40, pa su njegovi početci 09:40, 09:55, 10:10 itd. Početak iz starog koraka koji se ne preklapa sa rezervacijom ne označava se lažno zauzetim.

Frontend šalje i prikazano trajanje uz zahtjev. Ako je terapeut u međuvremenu izmijenio trajanje iste seanse, server vraća konflikt i frontend ponovo učitava katalog. Ime, cijena i konačno trajanje i dalje dolaze iz baze, ne iz proizvoljnog klijentskog unosa.

`BookingService.slots` u jednom PostgreSQL snimku čita radno vrijeme i zauzetost, pa poziva zajednički `availableStarts` iz `packages/domain/src/scheduling.ts`. Početci su na 15 minuta unutar slobodnih intervala, a seansa mora cijela stati. Ako se prethodna završi u 16:15, naredna može početi u 16:15. Zona je `Europe/Podgorica`, a horizont 90 dana. `validStarts` dodatno provjerava stvarno trajanje pri promjeni ljetnjeg/zimskog sata i odbija nepostojeća lokalna vremena.

Kalendar ponovo čita API svakih pet sekundi i pri povratku u tab. Cleanup prekida prethodni HTTP zahtjev, timer i slušač. Ako je izabrani početak zauzet u međuvremenu, izbor se briše. Javna zauzetost ne sadrži imena, emailove, telefone ili ID-eve klijenata. Kratko zastarjeli prikaz nije dozvola za rezervaciju: server uvijek ponavlja provjeru pri upisu.

Aktivan neradni datum vraća `slots: []` i `dayOff: true`, pa pacijent vidi „Terapeut ne radi ovog datuma“. To važi za sva trajanja seanse. Dugme „Vrati sedmični raspored“ prvo prikazuje objašnjenje i potvrdu: uklanjanje izuzetka može ponovo otvoriti taj dan. Odustajanje ne šalje upis. Tek potvrda šalje `remove-date` i označava zapis neaktivnim. Pri debugovanju provjerite i `availability_dates.is_active`: neaktivan neradni zapis više ne zatvara datum.

## 4. Klik na „Pošalji zahtjev“

Pratite ove korake kroz `apps/api/src/bookings/booking.service.ts: create`:

1. `auth.getAccount` provjerava JWT, aktivnu sesiju i ulogu `CLIENT`.
2. `requireBookingDate` i `requireInteger` provjeravaju datum i vrijeme.
3. `BEGIN` otvara jednu transakciju. `lockTherapist` koristi `SELECT ... FOR UPDATE` nad profilom terapeuta.
4. Poslije dobijanja zaključavanja API ponovo čita uslugu, radno vrijeme i sve zauzete rezervacije. Drugi istovremeni zahtjev istog terapeuta čeka ovaj korak.
5. `requestBooking` provjerava kontakt i da li cijela seansa staje. Ime i email dolaze iz naloga, a cijena i trajanje iz usluge. Browser ne može podmetnuti drugog vlasnika ili cijenu.
6. `INSERT booking_requests` čuva status `REQUESTED` i kopije usluge/kontakta. Zahtjev odmah zauzima vrijeme, prije potvrde terapeuta.
7. `BookingRepository.recordEvent` upisuje početni događaj istorije.
8. `COMMIT` potvrđuje oba upisa. Svaka greška radi `ROLLBACK`. PostgreSQL `EXCLUDE` zabrana preklapanja ostaje dodatna zaštita, uključujući direktan SQL upis.

Pravila zaključavanja i zabrana preklapanja prate [PostgreSQL zaključavanja](https://www.postgresql.org/docs/17/explicit-locking.html) i [range exclusion pravila](https://www.postgresql.org/docs/17/rangetypes.html). Dva istovremena preklopljena zahtjeva ne mogu oba uspjeti.

## 5. Odgovor, otkazivanje i istorija

Stalne serije uređuje vlasnik terapeut iz potvrđene buduće seanse. `RecurringBookingService` održava termine na 7/14 dana dok se pravilo ne zaustavi, sa istim zaključavanjem i provjerom zauzetosti kao pojedinačna rezervacija. Svaka seansa ima vlastiti ID, istoriju i nominalni datum koji se ne mijenja pri pojedinačnom pomjeranju. Detalji dopune, prekida i konflikata su u [recurring-bookings.md](recurring-bookings.md).

`GET /bookings` vraća isključivo zahtjeve trenutnog pacijenta ili vlastitog terapeuta. `features/server-bookings.tsx` prikazuje te zahtjeve i njihove događaje, bez lokalnog skladišta. `POST /bookings/:id/respond` provjerava vlasnika i dozvoljenu radnju prije svake promjene.

Terapeut potvrđuje, odbija, otkazuje, predlaže drugo vrijeme ili bilježi/ispravlja ishod. Pacijent otkazuje ili prihvata/odbija predlog. Prije početka seanse još nije dozvoljen ishod „završena“/„nedolazak“. Otkazivanje i odbijanje oslobađaju termin, ali ne brišu zahtjev. Razlog je opcionalno API polje `reason` i ostaje u istoriji.

Predlog A → B koristi `proposeAlternative`: prvo provjerava B, a tek zatim jednim upisom oslobađa A i zauzima B. Greška ostavlja A nepromijenjenim. Istorija čuva prethodni datum i vrijeme. Servis svakih 30 sekundi i prije čitanja/radnje označava istekle zahtjeve; status i `SYSTEM` događaj čuvaju se zajedno. Timer se uklanja pri gašenju API-ja. Zahtjev bez odgovora nije nedolazak.

## Gdje staviti breakpoint pri debugovanju

Klijentov pregled na `/account` prvo prikazuje termine, uključujući terapeuta, naziv, puno vrijeme i cijenu iz rezervacije. `ClientBookingSummary` dodaje podatke javnog profila kada su dostupni; kvar kataloga ne blokira privatne termine. `ServerBookings.compareBookings` kod obje uloge prvo prikazuje buduće aktivne termine po datumu i satu od najbližeg, zatim prošle seanse bez upisanog ishoda, pa istoriju od najnovije. Status zahtjeva ne preskače raniji datum. Filteri mijenjaju samo prikaz. Izdvojeni sljedeći termin bira se među budućim potvrđenim rezervacijama pomoću zajedničkog `hasStarted`, po zoni projekta. `getHistoryTimeLabel` objašnjava sačuvani datum prema radnji: kod predloga je prethodni A, a kod prihvatanja prihvaćeni B. API polje `previousDate` označava stanje prije radnje, pa se pri prihvatanju ne odnosi na A. Akcije, istorijski zapisi i provjere zauzetosti ostaju u postojećem API-ju.

| Problem                                | Prvo mjesto                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| Radno vrijeme nije sačuvano            | `ScheduleEditor.handleAddWindow`, zatim `BookingService.saveSchedule`        |
| Pogrešno trajanje/cijena               | `BookingFlow.handleChooseService`, zatim `BookingService.create`             |
| Zauzet termin je prikazan kao slobodan | `ServerCalendar.loadSlots`, zatim `BookingService.slots` i `availableStarts` |
| Dupla rezervacija                      | `BookingService.lockTherapist`, nova provjera nakon lock-a, SQL `EXCLUDE`    |
| Zahtjev nije vidljiv                   | `BookingService.list`: vlasnik JWT-a i `client_user_id`/`linked_user_id`     |
| Nema istorije promjene                 | `BookingRepository.recordEvent` i `COMMIT` u `respond`                       |

Greška `409` znači zauzet/preklopljen termin. `403` znači pogrešnu ulogu ili tuđi zahtjev. `401` znači da je potrebna nova prijava. `400` znači neispravan unos ili nedozvoljenu promjenu statusa. U Network tabu prvo provjerite HTTP status i poruku, pa parametre koji su poslati. Ne logujte JWT ili lozinke.

## Provjere i granice

Pokrenite `npm.cmd run typecheck`, `npm.cmd test` uz `AUTH_TEST_DATABASE_URL`, `npm.cmd run build`, `npm.cmd run test:auth:e2e` uz Mailpit i `npm.cmd run format:check`. API integracija koristi zasebnu testnu šemu i provjerava paralelne pacijente, sva trajanja, vlasništvo, otkazivanje, A → B, nepromijenjenu cijenu istorijske seanse i isticanje. Browser koristi tri odvojena naloga i provjerava ažuriranje zauzetosti bez refresh-a.

Odvojeni `/demo/dashboard` i `/demo/therapist/[id]/book` i dalje služe za probne tokove. Njihov `localStorage` ne mijenja stvarne rezervacije. Booking emailovi koriste trajni red opisan u [booking-notifications.md](booking-notifications.md): transakcija čuva rezervaciju, istoriju i poruku, a worker poslije upisa šalje obavještenje. Podsjetnici u 08:00, admin upravljanje i serverski izvoz još nijesu uključeni.
