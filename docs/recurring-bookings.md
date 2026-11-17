# Stalni termini — kako rade i gdje se debuguju

Terapeut na svom pregledu otvara potvrđenu buduću seansu određenog klijenta. Checkbox **„Stalni termin za ovog klijenta“** otvara izbor razmaka: svake sedmice (7 dana) ili svake druge sedmice (14 dana). „Sačuvaj stalni termin“ čuva pravilo u bazi. Prvi termin je već potvrđena seansa iz koje se pravilo pravi; početni sat, trajanje i cijena su dogovor te serije.

Serija nema krajnji datum. Server unaprijed održava pojedinačne potvrđene seanse za **narednih 90 dana**. Time prati postojeći opseg kalendara. Svakog dana novi datum ulazi u taj opseg; pozadinski pregled na minut, restart API-ja ili čitanje kalendara dopunjavaju dospjele serije. API mora biti pokrenut da bi pozadinski proces radio. Ako je ugašen, pravilo ostaje u PostgreSQL-u i dopuna se nastavlja pri sljedećem pokretanju.

## Šta korisnik vidi

- Klijent i terapeut vide svaku seansu zasebno, zajedno sa oznakom ponavljanja. Ti termini zauzimaju isti kalendar kao ostale rezervacije.
- „Stalni termini“ prikazuje dan i sat ponavljanja, npr. „Svakog ponedjeljka u 09:00“ ili „Svakog drugog ponedjeljka u 09:00“, aktivna/zaustavljena pravila i datume koji zahtijevaju pažnju. Dan se računa iz prvog datuma serije, pa pomjeranje jedne seanse ne mijenja ovaj opis.
- Na potvrđenoj seansi iz serije terapeut bira **„Predloži drugi termin“**. Klijent prihvata ili odbija predlog kroz postojeći tok. Mijenja se samo taj zapis; sedmični ritam ostaje isti.
- Otkazivanje jedne seanse oslobađa samo njen interval. Server je ne pravi ponovo pri automatskoj dopuni.
- **„Zaustavi seriju“** otvara potvrdu koja jasno navodi posljedice: prestaje dopuna i otkazuju se sve buduće seanse te serije. Prošli ishodi i istorija se čuvaju.
- Za svaku novostvorenu potvrđenu seansu i otkazivanje koristi se postojeći email outbox. Početno čuvanje može napraviti više seansi, pa klijent dobija zasebno obavještenje za svaku. Pomjeranje i odgovor klijenta takođe koriste postojeća obavještenja.

## Važni fajlovi

| Fajl                                                    | Odgovornost                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `db/migrations/010-recurring-bookings.sql`              | Trajna pravila, veza seanse sa nominalnim datumom i problemi dopune              |
| `apps/api/src/bookings/recurring-booking.service.ts`    | Dozvole, početno čuvanje, dopuna, zamjena problematičnog datuma i zaustavljanje  |
| `apps/api/src/bookings/recurring-booking.controller.ts` | HTTP adrese; identitet dolazi iz JWT kolačića                                    |
| `apps/api/src/bookings/booking.service.ts`              | Dopuna prije javnog kalendara i rezervacije; privatna lista uključuje pravila    |
| `apps/api/src/bookings/booking.repository.ts`           | Čita oznake serije i trajnu istoriju                                             |
| `packages/domain/src/bookings.ts`                       | Dopušta predlog drugog vremena i za potvrđenu seansu koja pripada seriji         |
| `apps/web/src/features/recurring-bookings.tsx`          | Checkbox, pregled pravila, pojedinačna zamjena i potvrda zaustavljanja           |
| `apps/web/src/features/server-bookings.tsx`             | Uključuje formular i oznake u postojeće kartice i osvježavanje                   |
| `apps/api/test/recurring-bookings.test.ts`              | Stvarni SQL: dozvole, preklapanje, rollback, restart, izdvojena izmjena i prekid |
| `tests/auth-e2e/recurring-bookings.spec.ts`             | Browser tokovi obje učestalosti, mobilni prikaz i zamjena neradnog datuma        |

## Čuvanje korak po korak

1. `RecurringBookingService.create` provjerava sesiju, ulogu, vlastiti profil i potvrđenu buduću seansu. Klijent se izvodi iz postojeće rezervacije; browser ne šalje proizvoljan ID pacijenta.
2. Transakcija zaključava isti red terapeuta koji zaključava obično zakazivanje. Zbog toga dva zahtjeva za isto vrijeme ne mogu proći paralelno.
3. `booking_series` dobija prvi datum, početni sat, razmak i `next_date`. Polazna rezervacija dobija `series_id` i `occurrence_date`.
4. `fillForTherapist` prolazi kroz naredne nominalne datume do 90 dana unaprijed. `createOccurrence` ponovo provjerava aktivnu uslugu, naloge, radne sate, posebne datume, zauzetost i stvarno lokalno vrijeme pri promjeni sata.
5. Nova potvrđena seansa, događaj `RECURRING_CREATED` i email red upisuju se u istoj transakciji. `SERIES_STARTED` označava uključenje na polaznoj seansi.
6. Tek poslije `COMMIT` prikaz potvrđuje uspjeh i pokreće se obrada emaila. Neuspjeh početnog čuvanja vraća cijelu novu seriju, uključujući istoriju i email red.

Prvi skup termina mora biti slobodan. Ako postoji konflikt, početna serija se ne čuva djelimično: poruka navodi problematičan datum. Postojeća pojedinačna rezervacija ostaje sačuvana.

## Kasnija dopuna i izuzeci

`next_date` je prvi neobrađeni nominalni datum. Za obrađeni datum ostaje rezervacija ili zapis problema. Jedinstveni indeks `(series_id, occurrence_date)` i zaključavanje profila sprečavaju duplikate poslije restarta ili paralelnog prolaza.

Kod kasnije dopune očekivani konflikt, neradni dan ili nedostupna usluga čuvaju se u `booking_series_issues`. Ostali datumi se nastavljaju. Problem nije potvrđena rezervacija i ne prikazuje se kao uspješno zakazana seansa. Klijent i terapeut vide da taj datum nije zakazan; terapeut bira zamjenski datum/sat u tom pregledu. Uspješan upis označava problem riješenim i dodaje samo jednu zamjensku rezervaciju. Ne šalje se potvrda seanse za datum koji nije zakazan.

Neočekivana SQL/mrežna greška vraća transakciju i ne pomjera cursor unaprijed. Server pokušava ponovo. Kvar jedne grupe ne zaustavlja automatsku obradu drugih terapeuta.

`occurrence_date` je datum iz prvobitnog pravila, dok `start_at` predstavlja stvarno dogovoreni početak seanse. Poslije pojedinačne promjene ta dva datuma mogu biti različita. Tu razliku ne treba „ispravljati“: ona sprečava ponovno kreiranje starog termina. Izmjena trajanja/cijene javne usluge ne prepravlja dogovor postojeće serije; za novi dogovor terapeut zaustavlja staru i pravi novu seriju iz nove potvrđene seanse.

## API i mjesta za breakpoint

- `POST /api/v1/booking-series`: `bookingId`, `intervalDays` (`7` ili `14`). Samo vlasnik terapeut.
- `GET /api/v1/bookings`: privatne rezervacije i `series` trenutnog naloga.
- `POST /api/v1/booking-series/:id/resolve`: `occurrenceDate`, novi `date` i `start` u minutima.
- `POST /api/v1/booking-series/:id/stop`: prekida jednu vlastitu seriju. Ponovljen isti poziv ne otkazuje termine i ne šalje obavještenja ponovo.
- Promjena jedne seanse koristi postojeći `POST /bookings/:id/respond`, sa `propose` i odgovorom klijenta.

Za nedostajući budući termin stavite breakpoint u `fillForTherapist`, provjerite `next_date` i `booking_series_issues`, pa `createOccurrence`. Za duplikat provjerite jedinstveni indeks i zaključavanje terapeuta. Za pogrešno pomjeranje provjerite `occurrence_date` i poziv `proposeAlternative`. Za email koristite [booking-notifications.md](booking-notifications.md); za opšti kalendar [scheduling.md](scheduling.md). Ne logujte JWT, lozinke ili tuđe kontakt podatke.
