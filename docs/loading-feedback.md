# Spinneri i čekanje API odgovora

Spinner znači da aplikacija čeka stvarni mrežni zahtjev. Ne dodajemo vještačku pauzu niti prijavljujemo uspjeh prije nego što server potvrdi upis.

## Zajednički prikaz

`apps/web/src/components/ui.tsx` sadrži zajedničke prikaze:

- `Spinner` crta kružić. Dekorativan je; tekst objašnjava radnju.
- `ActionButton` prima obična svojstva HTML dugmeta i `pending`. Dok je `pending=true`, dodaje spinner, `aria-busy` i `disabled`. Opcioni `pendingText` mijenja tekst tokom čekanja.
- `PendingStatus` prikazuje spinner i tekst uz `role="status"`, tako da i čitač ekrana dobija obavještenje o čekanju.
- `SaveFeedback` prikazuje poruku sa ikonom: čekanje, zelenu potvrdu ili grešku. Uspjeh se dodaje tek poslije API odgovora, prikazuje samo kratak naslov i automatski nestaje poslije četiri sekunde. Greške i čekanje ne koristi taj timer.
- `ProfileLoading` daje poseban prikaz učitavanja profila sa objašnjenjem i ukrasnim linijama umjesto praznog prostora.

`ScheduleEditor.saveSchedule` vraća `ScheduleSaveResult` sa dva obična polja: `saved` i `message`. Roditelj prikazuje jedinu potvrdu uspjeha iznad editora: „Seansa je sačuvana.“ za uslugu i „Raspored je sačuvan.“ za sedmične sate ili datum. `getSavedMessage` bira tekst prema `body.action`. Pojedinačni formulari prikazuju samo grešku uz unos, pa nema duplih zelenih potvrda. Ovo nije novi API format; to je rezultat frontend funkcije. HTTP odgovor i dalje donosi profil iz baze. Ako odgovor nema profil, čuvanje se ne prikazuje kao potvrđeno.

Potvrda pri vrhu koristi `.schedule-feedback` i ostaje ispod zaglavlja kada korisnik skroluje do datuma, dok ne isteknu četiri sekunde. `handleScheduleChange` je uklanja pri novom unosu, a `handleChange` pojedinačnog formulara uklanja njegovu raniju grešku. Timer je u `SaveFeedback.useEffect`; `stopTimer` uklanja prethodni timer pri promjeni poruke i zatvaranju komponente. Nova radnja uklanja prethodni rezultat prije slanja zahtjeva, pa i ponovljena ista potvrda dobija nove četiri sekunde. Skriva se samo poruka; podaci ostaju sačuvani.

`TherapistAccountProfileCard` zadržava prethodno učitan profil pri osvježavanju nakon fotografije. Zato se `TherapistPhotosEditor` ne uklanja iz prikaza i timer potvrde se ne resetuje tokom čitanja. Potvrda i dalje ističe poslije četiri sekunde. Do završetka osvježavanja fotografije imaju onemogućene kontrole. Prvo učitavanje bez profila pokazuje `ProfileLoading`, a naredno čitanje pokazuje manji indikator uz postojeće podatke.

CSS je u `apps/web/src/app/globals.css`, kod `.spinner`, `button .spinner` i `.pending-status`. Spinner u dugmetu prati boju teksta. Postojeći `prefers-reduced-motion` isključuje okretanje, a poruka i dalje ostaje vidljiva.

## Koraci jedne radnje

1. `handle...` prvo pročita `FormData`, prije onemogućavanja polja. Inače onemogućeno polje može izostati iz podataka formulara.
2. Postojeći `useRef` prekida drugi istovremeni upis. `disabled` je vidljiva zaštita, a ref djeluje i prije narednog React prikaza.
3. `setSubmitting(true)` ili `setPendingAction("save")` pokreće spinner prije `await` poziva.
4. `try` čeka stvarni API odgovor. Tek uspjeh mijenja prikaz ili prazni novi formular.
5. `catch` prikazuje postojeću poruku greške. Unos ostaje dostupan za ispravku i novi pokušaj.
6. `finally` gasi čekanje i oslobađa zaštitu. Za zahtjeve sa `AbortController` postojeća provjera sprečava izmjenu stanja poslije zatvaranja komponente.

`pendingAction` je običan tekst koji razlikuje radnje, npr. `save` i `remove`. Samo aktivno dugme dobija spinner; ostala povezana dugmad su onemogućena. Kod rasporeda roditeljski `ScheduleEditor` zaključava cijeli `fieldset`, a lokalni editor označava svoje aktivno dugme.

## Gdje pratiti radnju

| Radnja                                          | Funkcija/fajl                                                                        | Šta se čeka                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| Prijava, registracija, kod                      | `auth-pages.tsx: handleLogin/handleRegistration/handleVerification/handleResendCode` | Auth API odgovor                        |
| Obnova lozinke                                  | `password-reset-pages.tsx: handleSendLink/handleResetPassword`                       | Email zahtjev ili čuvanje nove lozinke  |
| Profil obje uloge                               | `account-profile-editor.tsx: handleEditProfile/handleSaveProfile`                    | Profesionalna polja ili potvrda čuvanja |
| Usluge                                          | `session-editor.tsx: handleSaveSession/handleRemoveSession`                          | `ScheduleEditor.saveSchedule`           |
| Sedmični sati i datumi                          | `availability-editor.tsx` i `schedule-editor.tsx`                                    | Čuvanje/uklanjanje rasporeda            |
| Nova rezervacija                                | `booking-flow.tsx: handleSubmitRequest`                                              | Upis zahtjeva i istorije                |
| Potvrda, odbijanje, predlog, otkazivanje, ishod | `server-bookings.tsx: handleRespond`                                                 | Potvrđen novi status rezervacije        |
| Fotografije                                     | `therapist-photos-editor.tsx: handleUpload/changePhoto`                              | Upis slike i osvježavanje kataloga      |
| Ručno osvježavanje zahtjeva                     | `server-bookings.tsx: handleReload`                                                  | Novi odgovor liste rezervacija          |

`ServerBookings.handleBookingChanged` odmah primjenjuje status koji je server potvrdio, pa osvježava listu i istoriju. Tako staro dugme za potvrdu ne ostaje aktivno dok se čeka novo čitanje. Automatski polling svakih pet sekundi ostaje tih; spinner se prikazuje pri početnom učitavanju ili izričito pokrenutoj radnji.

## Provjera u browseru

U DevTools Network tabu uključite sporiju mrežu i pokrenite čuvanje. Spinner mora biti vidljiv sve do odgovora, a drugo slanje onemogućeno. Kod greške spinner nestaje i unos ostaje u formularu. Za breakpoint prvo otvorite odgovarajući `handle...`, zatim `requestAuth`/`requestBookingApi`.

`tests/auth-e2e/spinners.spec.ts` namjerno zadržava testni HTTP zahtjev dok pregleda spinner i blokirano dugme. Posebno provjerava ponovljeni klik, grešku i novi pokušaj, obje uloge, stvarni upis u izolovanu bazu, mobilnu širinu i smanjeno kretanje. Produkcioni kod nema ove pauze.
