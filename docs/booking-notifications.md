# Email obavještenja o terminima

Na Render Free koristi se `AUTH_EMAIL_MODE=resend` i Resend HTTPS API; lokalni razvoj zadržava Mailpit/SMTP. U privremenom `disabled` režimu red se upisuje uz rezervaciju, ali worker ne šalje poruke niti mijenja pokušaje ili `sent_at`. Kada se dostava uključi, ponovo provjerava aktuelno stanje i primaoca. Resend koristi `Idempotency-Key: booking/<outbox-id>` za retry u okviru provajderovog roka od 24 sata; outbox ostaje trajni izvor stanja. Detalji su u [auth.md](auth.md) i [deployment.md](deployment.md).

Zahtjevi, termini i istorija ostaju u aplikaciji i PostgreSQL-u. Email je dodatno obavještenje sa linkom ka istom zahtjevu, bez automatske prijave ili promjene statusa klikom na email.

## Ko prima poruku

| Radnja                                | Primalac     | Poruka                               |
| ------------------------------------- | ------------ | ------------------------------------ |
| Klijent pošalje zahtjev               | Terapeut     | Novi zahtjev za termin               |
| Terapeut potvrdi                      | Klijent      | Termin je potvrđen                   |
| Terapeut odbije                       | Klijent      | Zahtjev je odbijen                   |
| Terapeut predloži drugi datum ili sat | Klijent      | Novi predlog, koji još nije potvrđen |
| Klijent prihvati ili odbije predlog   | Terapeut     | Odgovor klijenta                     |
| Jedna strana otkaže                   | Druga strana | Termin je otkazan                    |

Označavanje završene seanse ili nedolaska ne šalje dodatne emailove. Podsjetnici u 08:00 nijesu dio ovog toka.

Poruka sadrži imena, vrstu seanse, datum, vrijeme u zoni `Europe/Podgorica`, trajanje, sačuvanu cijenu i tadašnju adresu ordinacije. Predlog sadrži i prethodni datum/sat. Primalac dolazi iz povezanog naloga u `users`, a ne iz browser formulara. Poruke ne sadrže lozinke, JWT ili medicinske bilješke.

## Fajlovi i koraci za debugovanje

1. `BookingService.create` ili `respond` provjerava prijavu, vlasnika i dostupnost i pokreće SQL transakciju.
2. Servis upisuje rezervaciju/promjenu i istoriju, pa poziva `BookingNotificationService.queue` **na istoj konekciji**. Tek zatim slijedi `COMMIT`. Greška bilo kog upisa vraća sve kroz `ROLLBACK` i ne šalje email.
3. `notification_outbox` dobija događaj. Ključ `booking:<id>:<state_version>:<uloga primaoca>` sprečava dupli upis iste promjene. Migracija `009-booking-notifications.sql` dopunjava postojeću tabelu; ne pravi poruke za stare rezervacije.
4. Poslije `COMMIT` poziva se `wake`. Odgovor korisniku ne čeka SMTP. Worker radi i svakih pet sekundi, kao i pri pokretanju API-ja, pa nastavlja neposlate poruke poslije restarta.
5. `deliverBatch` koristi PostgreSQL session advisory lock za istu šemu. Samo jedan API proces obrađuje taj red u jednom trenutku. Nema SQL transakcije koja čeka SMTP; ostale rezervacije se normalno upisuju. Lock se oslobađa prije vraćanja konekcije pool-u, ili zatvaranjem neispravne konekcije.
6. `deliverOne` ponovo čita trenutnu verziju rezervacije, potvrdu emaila, suspenziju, ulogu i vlasništvo primaoca. Ako se stanje promijenilo, stara poruka dobija `skipped_at` i `BOOKING_CHANGED`. Ako primalac više nije dostupan, dobija `RECIPIENT_UNAVAILABLE`.
7. `buildBookingEmail` u `notifications/booking-email-message.ts` pravi običan tekst iz snimka događaja. Link koristi prvu adresu iz `WEB_ORIGINS`; zaglavlje zahtjeva ili proizvoljan link klijenta ne određuju odredište. Zaštićene stranice i dalje zahtijevaju prijavu.
8. `EmailService.sendBookingNotification` koristi postojeći SMTP. Uspjeh postavlja `sent_at`. Greška ostavlja poruku u bazi i pomjera `scheduled_at` za 30, 60, 120 sekundi, do najviše jednog sata između daljih pokušaja. Isti outbox ID ostaje u SMTP `Message-ID`.

`onModuleDestroy` uklanja interval i čeka aktivnu seriju. Restart ne resetuje broj pokušaja ni sadržaj reda. Greške workera ne poništavaju ranije potvrđenu rezervaciju.

## Kako pregledati red u bazi

U Prisma Studio otvorite `notification_outbox`. Važna polja:

- `booking_id`: veza sa zahtjevom.
- `recipient_user_id`: nalog primaoca; njegov email je u `users.email`.
- `template_key`: vrsta obavještenja.
- `expected_version`: verzija zahtjeva za koju je poruka pripremljena; trenutna je `booking_requests.state_version`.
- `scheduled_at`: kada je poruka spremna za pokušaj.
- `attempts`: broj pokušaja slanja.
- `sent_at`: SMTP je prihvatio poruku.
- `last_error`: bezbjedna dijagnostička oznaka, bez sadržaja emaila i SMTP tajni.
- `skipped_at`, `skipped_reason`: poruka je namjerno preskočena zbog novijeg stanja ili nedostupnog primaoca.

Za brzu provjeru, bez ispisa sadržaja poruka:

```sql
SELECT id, booking_id, template_key, expected_version,
       attempts, scheduled_at, sent_at, last_error,
       skipped_at, skipped_reason
FROM notification_outbox
ORDER BY created_at DESC
LIMIT 30;
```

| Oznaka                   | Šta provjeriti                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `SMTP_CONNECTION_FAILED` | Da li rade Mailpit/SMTP, `SMTP_HOST`, port, mreža i TLS                                      |
| `SMTP_AUTH_FAILED`       | Lokalno podešene `SMTP_USER` i `SMTP_PASS`                                                   |
| `SMTP_REJECTED`          | Dozvoljeni pošiljalac/domen i adresa primaoca kod SMTP provajdera                            |
| `SMTP_SEND_FAILED`       | Breakpoint u `EmailService.sendBookingNotification`, uz uključeno zaustavljanje na izuzecima |
| `BOOKING_CHANGED`        | Novija verzija zahtjeva; ne vraćati stari email u red                                        |
| `RECIPIENT_UNAVAILABLE`  | Primalac, potvrda emaila, suspenzija, uloga i veza sa zahtjevom                              |

Nije potrebno ručno pokretanje retry-ja: interval sam ponavlja neuspješno slanje. Pri lokalnom debugovanju jednog neposlatog zapisa može se pomjeriti njegov `scheduled_at` na `now()`. Ne brišite `sent_at` i ne vraćajte zastarjele poruke u red.

## Lokalni i stvarni email

Primijenite `npm.cmd run db:migrate` i pokrenite API. Health provjerava i migraciju 009 i vraća `bookingNotifications: outbox`. Već pokrenuti razvojni API sa `tsx watch` učitava kod automatski; produkcioni API treba ponovo pokrenuti nakon migracije i build-a.

Trenutni lokalni režim šalje u [Mailpit](http://127.0.0.1:8025), a ne na Gmail ili drugu stvarnu adresu. Uputstvo za Resend HTTPS i verifikovan domen je u [auth.md](auth.md). Isti `RESEND_API_KEY` i `RESEND_FROM` služe za registraciju, obnovu lozinke i booking obavještenja; SMTP režimi i dalje koriste `SMTP_*` vrijednosti. Ne upisujte pristupne podatke u frontend ili Git.

`sent_at` znači da je SMTP prihvatio poruku, ne da je pročitana ili završila u glavnom sandučetu. Ako se proces prekine poslije SMTP prihvatanja, a prije upisa `sent_at`, moguć je ponovni pokušaj već primljene poruke. Stabilan `Message-ID` i jedinstven ključ smanjuju duplikate; obični SMTP ne daje atomsku potvrdu sa PostgreSQL-om. Ako se status promijeni dok je poruka već u slanju, email opisuje raniju promjenu, a aplikacija ostaje izvor najnovijeg stanja.

## Provjere

`apps/api/test/booking-notifications.test.ts` koristi izolovanu šemu i lažni SMTP. Provjerava primaoce, tekst i trajanje/cijenu, jedinstven upis, rollback, trajni retry, novi worker, zastarjele poruke, nedostupnog primaoca i paralelne workere. `tests/auth-e2e/booking-email.spec.ts` koristi stvarni lokalni SMTP i provjerava novi zahtjev, potvrdu, odbijanje i predlog kroz dvije prijavljene osobe i njihove prikaze u aplikaciji.
