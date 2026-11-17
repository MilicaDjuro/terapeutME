# Lista čekanja — tok i debugging

Klijent kod terapeuta bira seansu, pa **„Čekaj određeni zauzeti termin“** i npr. „Čekaj 09:00–09:50“. Formular ispod kalendara prihvata tačan datum/sat ili **„Odgovarajuće dane i raspon vremena“**: početni/krajnji datum, dane u sedmici, najraniji početak i najkasniji završetak. Zona je `Europe/Podgorica`, period narednih 90 dana, a cijela seansa mora stati u raspon.

Klijent izričito pristaje na **jednu automatski potvrđenu seansu** uz prikazano trajanje i cijenu. Ako već postoji odgovarajući slobodan termin, dodjela može biti odmah. Prijava nije sedmično ponavljanje; za to postoje stalni termini. Dozvoljeno je najviše 20 aktivnih prijava po nalogu.

## Prikaz i statusi

„Lista čekanja“ na `/account` prikazuje vlastiti izbor, vrijeme prijave i status. Na `/dashboard` terapeut vidi prijave svojih klijenata. Aktivne prijave se prikazuju redom prijave. „Napusti listu čekanja“ povlači samo prijavu koja još čeka.

- `WAITING`: čeka odgovarajuće slobodno vrijeme.
- `ASSIGNED`: dodijeljena je potvrđena rezervacija; klijent i terapeut dobijaju email i link na rezervaciju. Sadašnje stanje seanse čita se iz povezane kartice. Kasnije otkazivanje ne vraća prijavu na čekanje.
- `CANCELLED`: klijent je napustio listu.
- `EXPIRED`: period čekanja je istekao.
- `UNAVAILABLE`: usluga/nalog nijesu dostupni ili se promijenila cijena/trajanje. Klijent mora napraviti novu prijavu uz novu saglasnost.

Ako dodjela stigne prije povlačenja, server jasno traži otkazivanje same seanse. Promjena radnih sati ne briše prijavu: ona čeka do isteka izabranog perioda.

## Važni fajlovi

| Fajl                                                  | Odgovornost                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `db/migrations/011-waitlist.sql`                      | Trajni izbori, rastući broj reda, zaštita od duplikata i dodijeljena rezervacija |
| `apps/api/src/bookings/waitlist.service.ts`           | Dozvole, validacija, FIFO dodjela, povlačenje, istek i oporavak                  |
| `apps/api/src/bookings/waitlist.controller.ts`        | `POST /api/v1/waitlist` i `POST /api/v1/waitlist/:id/cancel`                     |
| `apps/api/src/bookings/booking.service.ts`            | Dodjela pri otkazivanju/odbijanju/predlogu, novom rasporedu i prije rezervacije  |
| `apps/api/src/bookings/recurring-booking.service.ts`  | Provjera liste prije nove serije/zamjene i dodjela poslije prekida serije        |
| `apps/api/src/notifications/booking-email-message.ts` | Tekst `waitlist-assigned`; postojeći outbox šalje objema stranama                |
| `apps/web/src/features/waitlist.tsx`                  | Formular, saglasnost, spinneri, pregled i povlačenje                             |
| `apps/web/src/components/server-calendar.tsx`         | Poseban izbor čekanja; sivi termini i dalje ne dozvoljavaju redovnu rezervaciju  |
| `apps/web/src/features/server-bookings.tsx`           | Privatni pregled i osvježavanje na pet sekundi                                   |
| `apps/api/test/waitlist.test.ts`                      | SQL red, konkurentnost, rollback, istek i povezane stalne serije                 |
| `tests/auth-e2e/waitlist.spec.ts`                     | Stvarni JWT nalozi, formulari, mobilni prikaz i Mailpit                          |

## Čuvanje korak po korak

1. `join` provjerava JWT klijenta, saglasnost, datume, dane, telefon i ponudu. `requestId` ostaje isti pri mrežnom ponovnom pokušaju da izgubljen odgovor ne napravi novu dodjelu.
2. Transakcija prvo zaključava red terapeuta `FOR UPDATE`, kao redovno zakazivanje i raspored. `queue_number` određuje red; browser ne šalje prioritet. Ponovljeni isti aktivni izbor zadržava mjesto.
3. `allocate` prolazi po broju reda. Stariji izbor koji ne odgovara slobodnom datumu/satu ne blokira odgovarajućeg mlađeg klijenta. Jedna prijava pravi najviše jednu rezervaciju.
4. `availableStarts` provjerava aktivnu uslugu, sedmične/posebne sate, neradne dane, zauzetost i cijelo trajanje. Biraju se postojeći ponuđeni počeci: poslije zauzetog 09:00–09:50 to su 09:50, 10:05, 10:20 itd. Raspon 10:00–11:00 prihvata seansu 10:05–10:55. SQL provjerava stvarni lokalni sat pri promjeni ljetnjeg/zimskog vremena. Postojeće seanse se ne pomjeraju.
5. Rezervacija `CONFIRMED`, istorija `WAITLIST_ASSIGNED`, veza sa prijavom, status `ASSIGNED` i dva email outbox reda čuvaju se u istoj transakciji. Greška vraća sve.
6. SMTP počinje poslije `COMMIT`. SMTP greška ne oslobađa rezervaciju; postojeći outbox ponavlja slanje i preskače zastarjele poruke.

Obrada se izvršava u transakciji oslobađanja termina, prije novog zakazivanja, pri čitanju kalendara/privatnog pregleda, poslije restarta i svakih 30 sekundi. API mora biti pokrenut. SQL lock štiti više API instanci. Lokalni SMTP je Mailpit na `http://localhost:8025`; stvarni email zahtijeva konfigurisan SMTP.

Za upis postavite breakpoint u `join` kod `requestId` i provjere ponude. Za red u `allocate` provjerite `entries.rows`, datume i početke. Kod nedodijeljenog termina provjerite neradni datum, sate, cijenu/trajanje, status naloga i da li cijela seansa staje. Za povlačenje koristite `cancel`, poslije zaključavanja. Za email pogledajte `BookingNotificationService.queue`, `deliverOne` i `notification_outbox.last_error`. Ne logujte JWT, lozinke ili tuđe kontakte.
