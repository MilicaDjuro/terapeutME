# Ocjene završenih seansi

Klijent na `/account`, u „Moji termini → Za ocjenjivanje“, bira broj od 1 do 5 uz svoju potvrđenu seansu čim prođe njeno vrijeme završetka. Nije potreban ručni klik terapeuta na „Završena seansa“. Ranije ručno završene seanse takođe se mogu ocijeniti. Ocjena je jednom po rezervaciji, bez teksta i bez zvjezdica. Isti klijent može ocijeniti svaku svoju seansu. Poslata ocjena ostaje prikazana kao „Vaša ocjena: 4/5“; kratka potvrda čuvanja nestaje nakon četiri sekunde. Filter „Za ocjenjivanje“ prikazuje samo termine koji još čekaju ocjenu; u „Svi termini“ ostaju vidljive i poslate ocjene.

Na javnom `/therapist/[id]` prikazuju se **ukupno bodova** i **broj ocijenjenih seansi**. To je zbir, ne prosjek: ocjene 5, 4 i 3 daju **12 bodova iz 3 seanse**. Profil bez ocjena prikazuje 0 i objašnjenje da još nema ocjena. Imena, pojedinačne ocjene i ID-evi rezervacija nijesu dio javnog zbira. Veći broj seansi može dati veći zbir; ne prikazujemo ga kao prosječnu ocjenu kvaliteta.

## Tok čuvanja, redom

`TherapistCard` u `components/ui.tsx` prikazuje isti `ratingTotal` i `ratingCount` u istaknutoj tirkiznoj traci i na početnoj `/` i u katalogu `/psychotherapy`. Broj je veći i podebljan, uz oznaku „Ukupno bodova“ i broj ocijenjenih seansi. Profil bez ocjena prikazuje 0 i „Još nema ocjena“. Stil je u `brand.css` kroz `.card-rating`; prelama se na uskim ekranima. Kartica ne računa novi zbir i ne pravi dodatni API poziv.

1. Migracija `016-session-ratings.sql` dodaje tabelu `session_ratings`. Primarni ključ `booking_id` dozvoljava samo jedan red po seansi, a `CHECK` samo cijele ocjene 1–5. Ranijim seansama se ne dodjeljuju izmišljene ocjene. Mogu se ocijeniti kada klijent otvori svoj nalog.
2. `BookingRepository.list` vraća `canRate` samo klijentu vlasniku, za `CONFIRMED` ili `COMPLETED` seansu čiji je `end_at` prošao. `rating` vraća njegovu raniju ocjenu; terapeutski prikaz dobija `null` i nema formular za ocjenjivanje. `ServerBookings` osvježava listu svakih pet sekundi dok je tab vidljiv, pa se formular otvara i bez ponovnog učitavanja stranice. Ne mijenjamo status, istoriju i analitiku samo zato što je sat prošao.
3. `features/session-rating.tsx` čuva privremeni izbor samo u React stanju. Klik na „Pošalji ocjenu“ prikazuje spinner i zaključava izbor/ponovni klik. Nema upisa u `localStorage`.
4. `POST /api/v1/bookings/:id/rating` šalje `{ score: "4" }`. `SessionRatingController` koristi postojeći JWT kolačić, JSON/Origin zaštitu i `private, no-store`. `SessionRatingService.save` ponovo provjerava ulogu `CLIENT`, vlasništvo, broj 1–5, trenutno `CONFIRMED`/`COMPLETED` stanje i stvarni trenutak završetka na serveru.
5. Transakcija zaključava prvo terapeuta, pa rezervaciju, istim redosljedom kao izmjena ishoda. Paralelni upis ne može dodati dvije ocjene. Ponovljen isti broj vraća istu potvrdu, koristan ako je prethodni odgovor izgubljen. Pokušaj drugog broja za već ocijenjenu seansu vraća 409. Greška radi `ROLLBACK`.
6. Tek nakon `COMMIT` prikaz potvrđuje čuvanje i ponovo učitava katalog. Greška ostavlja izabrani broj i omogućava pokušaj. Zatvaranje kartice/odjava prekida čekanje odgovora; server je možda već sačuvao ocjenu, pa ponovno otvaranje naloga čita stvarno stanje.
7. `DirectoryService.list` računa `ratingTotal` i `ratingCount` direktno kroz ocjene i rezervacije u istom SQL snimku. Ne čuvamo zaseban brojač koji može otići u minus ili se uvećati dvostrukim klikom. Profil ih prikazuje u `features/profile.tsx` i osvježava pri otvaranju.

## Ispravka ishoda

Ako terapeut ispravi ishod u `NO_SHOW` ili otkaže prošli potvrđeni termin, ranija ocjena ostaje sačuvana, ali se isključuje iz zbira i klijentskog prikaza te seanse. Povratak na dozvoljeni ishod vraća iste bodove, bez nove ocjene. Naknadna oznaka `COMPLETED` za već ocijenjenu `CONFIRMED` seansu ne uvećava zbir. Otkazani, odbijeni, nepotvrđeni termini, te buduće i seanse koje još traju, nemaju pravo ocjenjivanja. Postojeća istorija rezervacija ostaje nepromijenjena, a upis ocjene ne šalje email niti bilježi sadržaj privatnih bilješki.

## Gdje staviti breakpoint

- Nema formulara: otvorite „Za ocjenjivanje“ i provjerite JWT korisnika, `booking_requests.client_user_id`, `status`, `end_at` i `session_ratings.booking_id`. Seansa mora biti potvrđena ili ručno završena i njen stvarni kraj mora proći na serverskom satu. Nije dovoljno da je prošlo vrijeme početka. Terapeut ne mora označiti završetak.
- Upis ne uspijeva: pratite `SessionRatingService.save` od `getAccount`, preko `eligible`, do `INSERT` i `COMMIT`. 401 znači sesiju, 403 ulogu/Origin, 404 tuđu/nepostojeću seansu, 409 nedozvoljeno stanje ili već poslatu drugu ocjenu.
- Zbir djeluje neočekivano: provjerite `DirectoryService.list` i uslove `status IN ('CONFIRMED','COMPLETED')` i `end_at<=now()`. `ratingTotal` sabira ocjene svih klijenata i svih važećih seansi; `ratingCount` broji ocijenjene seanse, a ne jedinstvene klijente.
- API/baza nijesu spremni: pokrenite `npm.cmd run db:migrate`, zatim restartujte API. Health endpoint zahtijeva migraciju 016. Produkcioni start radi migracije prije pokretanja servisa.

`apps/api/test/session-ratings.test.ts` provjerava vlasništvo, uloge, granice, ishode i sat, paralelne pokušaje, zbir više klijenata, odvajanje terapeuta, ispravke ishoda i rollback. `tests/auth-e2e/session-ratings.spec.ts` prolazi stvarnu JWT prijavu, potvrđenu seansu bez ručne oznake završetka, filter, formular, spinner, grešku/retry, ponovno učitavanje, javni zbir i mobilni prikaz u izolovanoj testnoj bazi. Kraj scenarija pomjera vrijeme sintetičke seanse u prošlost i provjerava da postojeći polling sam prikaže formular.
