# Online seanse preko Daily-ja

Terapeut pri registraciji ili u **Moj pregled → Usluge → Dodaj/Uredi seansu** označava „Online seansa — video poziv“. Ovo je razgovor za **terapeuta i jednog klijenta**, ukupno dva priključka. Partnerske/grupne seanse sa više od dva uređaja nijesu podržane ovom konfiguracijom.

Klijent prije zakazivanja vidi „Online · video poziv“. Način rada kopira se u rezervaciju zajedno sa cijenom i trajanjem. Stare rezervacije i usluge ostaju uživo. Kasnija izmjena ponude ne prepravlja raniji dogovor. Ako se ponuda promijeni dok klijent popunjava formular, server traži novi izbor. Stalna serija čuva način rada polazne rezervacije. Lista čekanja uključuje način rada u saglasnost i traži novu prijavu ako se ponuda promijeni.

Oba učesnika otvaraju **Otvori online seansu** iz potvrđene rezervacije. Priprema kamere i mikrofona je lokalna i ne šalje medije Daily-ju. Ulazak se otvara 10 minuta prije početka; poziv i pristup ističu 10 minuta nakon zakazanog završetka. Vremena se računaju na serveru iz `timestamptz`, a prikazuju u zoni `Europe/Podgorica`. Izlazak iz poziva ne upisuje ishod „Održano“.

## Uključivanje naloga

1. Napravite nalog na [Daily dashboardu](https://dashboard.daily.co/). Izaberite naziv Daily domena, npr. `terapeut-test.daily.co`. To ne mijenja DNS niti postojeći sajt na terapeut.me.
2. U Daily dashboardu otvorite odjeljak za developere/API keys i napravite API ključ. Ključ nikad ne šaljite u chat, ne stavljajte u Git i ne koristite `NEXT_PUBLIC_` prefiks.
3. Na **Render → terapeut-api → Environment** unesite:

   ```dotenv
   ONLINE_SESSIONS_PROVIDER=daily
   DAILY_DOMAIN=terapeut-test
   DAILY_API_KEY=vas-stvarni-tajni-kljuc
   ```

   `DAILY_DOMAIN` je samo naziv prije `.daily.co`, bez protokola, tačaka ili putanje. Na Vercelu nema Daily ključa. Frontend koristi postojeći API proxy i HttpOnly sesiju.

4. Objavite novi kod na Renderu i Vercelu. Render start `npm run start:render` prvo primjenjuje migraciju **015-online-sessions**, zatim pokreće API. Nemojte mijenjati start u komandu koja preskače migracije. Provjerite `/api/v1/health`: `onlineSessions` treba da bude `daily`.
5. Označite jednu testnu uslugu kao online. Iz klijentskog naloga zakažite termin, zatim ga terapeut potvrđuje. Za provjeru uživo uzmite termin koji počinje za najviše 10 minuta. Otvorite rezervaciju sa dva odvojena browser naloga/uređaja; ista prijava u dva taba nije drugi učesnik.

Za lokalni rad ista podešavanja idu u ignorisani root `.env`, pa restart API-ja. `.local/daily-api-key.txt`, ako ga napravite za pomoć pri podešavanju, nije automatski konfiguracija aplikacije. Dok nalog nije spreman, zadržite `ONLINE_SESSIONS_PROVIDER=disabled`: priprema je dostupna, ali aplikacija jasno kaže da stvarni pozivi još nijesu uključeni.

Nije potrebno ručno praviti Daily sobe. API ih pravi tek pri pokušaju ulaska. Koristite HTTPS ili localhost za kameru/mikrofon. Drugi uređaj koji otvara nezaštićeni LAN HTTP nema iste browser dozvole kao localhost.

## Tok koda i podataka

| Dio             | Fajl i odgovornost                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Vrsta usluge    | `features/session-editor.tsx`, registraciona polja i `BookingService.saveSchedule` čuvaju `online`                      |
| Kopija dogovora | `requestBooking`, `BookingRepository`, stalni termini i lista čekanja čuvaju `booking_requests.online`                  |
| HTTP            | `online-sessions/online-sessions.controller.ts`: GET `bookings/:id/online-session`, POST isti put + `/join`             |
| Dozvole i rok   | `OnlineSessionsService`: aktivna JWT sesija, odgovarajuća uloga, vlasništvo, aktivni nalozi, potvrda i vremenski prozor |
| Daily REST      | `DailyService`: privatna soba, najviše dva učesnika, vremenski ograničeni tokeni i zatvaranje                           |
| Poziv           | `/session/[bookingId]`, `features/online-session.tsx`, `online-session.css`                                             |
| SDK adapter     | `lib/video-connection.ts`: SDK, događaji i kontrole; UI koristi naše `VideoParticipant`/`VideoConnection` tipove        |
| Reprodukcija    | `components/session-media.tsx`: video, odvojen tuđi zvuk i dodatni klik ako browser blokira autoplay                    |

Pri `join` server provjerava stvarne učesnike. ADMIN nema automatski ulazak. GET ne vraća Daily URL/token. POST zahtijeva dozvoljeni Origin i JSON kao ostale privatne radnje. Odgovori koriste `Cache-Control: no-store`.

Nasumična oznaka sobe vezana je za ID i verziju rezervacije; nema imena, emaila ili telefona u oznaci. Oznaka se prvo upisuje u kratkoj SQL naredbi, a mreža se čeka van transakcije. Session advisory lock sprečava istovremeno pravljenje/brisanje iste sobe. Drugi paralelni ulazak može dobiti poruku da pričeka nekoliko sekundi i ponovi pokušaj. Direktna PostgreSQL veza je potrebna za ove lock-ove, kao i za postojeće migracije; transaction-pooling veza nije odgovarajuća.

Token ima jednu sobu, pseudonim učesnika koji važi samo u toj sobi, rok i izbacivanje po isteku. Oba učesnika su bez vlasničkih/admin ovlašćenja. Snimanje, automatska transkripcija i čuvanje transkripta nijesu uključeni. Browser ne čuva token u URL-u, istoriji ili localStorage-u. Izlazak i promjena naloga uklanjaju medije, slušaoce i zakašnjele pokušaje ulaska.

Promjena rezervacije označava sobu opozvanom u istoj SQL transakciji. Radnik na 15 sekundi izbacuje oba pseudonima, zabranjuje ponovni ulazak i briše sobu. Provjerava i suspenzije/nedostupnost naloga. Neuspjeh ostaje za ponovni pokušaj bez sirovog provider odgovora u logu. Otvoren ekran takođe provjerava rezervaciju svakih 15 sekundi. Novo izdavanje tokena odmah je odbijeno nakon promjene; prekid već aktivnog poziva nije atomski sa upisom u bazu i zavisi od radnika/mreže. Istek sobe i tokena je dodatno ograničenje i kada je API uspavan ili nedostupan.

## Privatnost i održavanje

PostgreSQL čuva tehničku oznaku, provider, verziju, vrijeme kreiranja/isteka/opoziva/zatvaranja sobe. Ovi redovi se ne brišu automatski. Ne čuvamo video, zvuk, transkript ili meeting tokene. Daily obrađuje medijski saobraćaj i tehničke podatke veze; `enable_terse_logging` smanjuje njegove logove, ali ne znači da provider nema logove. Aplikacija ne šalje sadržaj bilježaka, telefon, email ili puno ime kao Daily `user_name`. U aplikaciji se prikazuje ime terapeuta koje korisnik već smije vidjeti.

Ovo nije tvrdnja da je uključen poseban E2EE režim niti da su ugovorni uslovi za zdravstvene podatke završeni. Prije korišćenja sa stvarnim klijentima treba završiti politiku privatnosti, uslove obrade sa providerom i tražene postavke lokacije obrade; kod trenutno ne garantuje isključivo EU rutiranje. Cloudflare R2 nije potreban za ovaj poziv jer nema snimaka/fajlova razgovora.

Za budući AWS prelazak čuvamo naš ekran i provjere rezervacije. Mijenjaju se REST provider servis, SDK adapter, konfiguracija i podržani provider u šemi. Daily sobe/tokeni nijesu prenosivi u AWS; aktivne pozive treba završiti prije promjene. Ne gradimo paralelni AWS sistem prije nego što je potreban.

## Provjere

`npm run typecheck`, `npm test`, `npm run build` i `npm run format:check` su obavezne provjere. API testovi koriste nasumičnu lokalnu šemu i lažni Daily HTTPS transport: dozvole, jedna soba, privatnost, rokovi, promjena ponude, greške, paralelni ulazak i otkazivanje tokom izdavanja tokena. SDK adapter ima odvojenu provjeru događaja, traka, kontrola i gašenja. Testovi serija i liste čekanja provjeravaju kopiranje i saglasnost za način rada.

`npm run test:auth:e2e -- online-sessions.spec.ts` provjerava stvarnu JWT prijavu, korisnike, CSRF, formular usluge, klijentsku rezervaciju, desktop/mobilni ekran, vještačku kameru/mikrofon, blokirane dozvole i gašenje traka. Runner namjerno koristi `ONLINE_SESSIONS_PROVIDER=disabled` i ne troši Daily minute. To nije potvrda stvarne razmjene zvuka/videa preko Daily mreže.

Poslije povezivanja naloga ručno provjerite dva uređaja: oba smjera zvuka/videa, mute/unmute, promjenu kamere/mikrofona, dijeljenje/prekid ekrana, slušalice, kratki prekid mreže, ponovni ulazak, otkazivanje iz drugog taba i istek termina. Provjerite browser koji će klijenti stvarno koristiti, posebno iPhone/Safari. Ne uključujte snimanje ili AI dodatke na Daily domenu za ovu integraciju.

Zvanična dokumentacija: [Daily call object](https://docs.daily.co/reference/daily-js/factory-methods/create-call-object), [kreiranje sobe](https://docs.daily.co/reference/rest-api/rooms/create-room), [meeting token](https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token), [izbacivanje](https://docs.daily.co/reference/rest-api/rooms/session/eject).
