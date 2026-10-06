# Terapeut.me — dogovor za početnu verziju

Posljednja izmjena: 6. oktobar 2026.

## Obim

Katalog, javni profili, usluge, dostupnost, izbor termina, zahtjevi i osnovna administracija. Nema klinika, online plaćanja, pretplata ni online susreta. Javni neverifikovani profili su dozvoljeni. Verifikaciju dodjeljuje isključivo admin.

## Kalendar

Terapeut određuje sate dostupnosti i unosi usluge sa trajanjem i opcionom cijenom. Klijent prvo bira uslugu, zatim datum i tačan termin u kalendaru. Cijena koja nije unesena prikazuje se kao „Na upit“, bez zamjene nulom.

Sistem oduzima zauzete i blokirane intervale iz dostupnosti. Unutar svakog slobodnog intervala nudi početke na 15 minuta, počevši od početka tog intervala. Seansa mora cijela stati u slobodan interval. Ako se prethodna završi u 16:15, sljedeća može početi u 16:15. Svi zahtjevi i sve usluge koriste istu zauzetost terapeuta.

Klijent trenutno ne unosi proizvoljno vrijeme. Model zauzetosti koristi početak i kraj, tako da kasnije može podržati drugi način generisanja početaka bez zamjene modela rezervacija.

## Zahtjevi

1. Zahtjev za A odmah zauzima A i uklanja sve ponuđene intervale koji se sa njim preklapaju.
2. Terapeut potvrđuje, odbija ili predlaže B.
3. Predlaganje B u istoj promjeni oslobađa A i zauzima B. B čeka prihvatanje klijenta.
4. Prihvatanje potvrđuje B; odbijanje ili povlačenje oslobađa B.
5. Ako B nije dostupan, promjena ne uspijeva i A ostaje nepromijenjen.
6. Istorijski zahtjevi se čuvaju. Nikada ne smiju postojati dva aktivna zahtjeva koji zauzimaju preklopljeno vrijeme istog terapeuta.

Klijent i terapeut mogu otkazati potvrđeni termin u bilo kom trenutku. Razlog je opcionalan. Bilježe se akter, vrijeme promjene i prethodno stanje za buduću statistiku.

## Kontakt i ishodi

Terapeut vidi ime i prezime, email i telefon klijenta. Detalji seanse se dogovaraju mimo platforme. Klijent dobija jasno objašnjenje prije slanja zahtjeva.

Terapeut označava završenu seansu ili nedolazak i može ispraviti oznaku. Posljednja oznaka predstavlja važeći ishod; istorija izmjena se čuva.

Zahtjev bez odgovora do početka seanse označava se „Bez odgovora terapeuta“ i prikazuje žutom bojom. Nije nedolazak klijenta. Prošli termin nije ponovo dostupan.

## Email i arhiva

Planiran je podsjetnik terapeutu u 08:00 na dan termina, po zoni Europe/Podgorica. Slanje mora biti preko trajnog outbox reda sa ključem protiv duplikata i ponovnom provjerom stanja prije slanja.

Pri brisanju naloga planiran je Excel izvoz povezanih podataka, dostavljanje adminu i čuvanje arhive. Demo već podržava lokalno preuzimanje Excel izvještaja; nema stvarnog brisanja naloga, arhiviranja na serveru ni email dostave.

## Pretpostavke samo za demo

- Dostupnost se ponavlja sedmično; kalendar klijentu prikazuje narednih 90 dana.
- Nema pauze između seansi. Podešavanje pauze je naredna mogućnost.
- Seansa se može označiti završenom/nedolaskom nakon početka; precizno pravilo o vremenu označavanja ostaje za dogovor.
- Predlog B bez prihvatanja do početka dobija zaseban status „Bez odgovora klijenta“. Ovo je implementirana demo pretpostavka, još nije konačna produktna odluka.
- Zahtjevi ističu pri početku. U demo verziji to se računa pri otvaranju, mutaciji i svakih 30 sekundi dok je stranica otvorena; produkcija zahtijeva serverski posao.
- Sve uloge su demo pregledi u istom browseru, bez autentifikacije. Ovo nije model produkcionih dozvola.

## Preostale odluke

- Podsjetnici za termine prije 08:00 i zahtjeve poslate nakon 08:00.
- Pravila prihvatanja i odbijanja predloga do početka termina.
- Izuzeci u dostupnosti po datumima, praznici, pauze i minimalno vrijeme do zakazivanja.
- Arhiviranje profila/brisanje naloga sa budućim terminima.
- Sadržaj, mjesto, rok čuvanja i pristup izvozu pri brisanju naloga.
- Konačni dokumenti privatnosti i uslova korišćenja.
