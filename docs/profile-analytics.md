# Analitika profila

Terapeut otvara **Analitika profila** na `/dashboard/analytics`, preko radnog prostora ili menija „Moj nalog“. Bira posljednjih 7, 30 ili 90 dana, uključujući današnji dan u zoni `Europe/Podgorica`. „Osvježi analitiku“ ponovo čita bazu; ne stvara preglede.

## Šta se računa

Na vrhu je **Trenutno stanje zahtjeva i termina**, nezavisno od izabranog perioda: svi zapisi, čekanje sada (posebno odgovor terapeuta/klijenta), sada potvrđeni i istorija. Brojevi se računaju iz trenutnih statusa svih vlastitih rezervacija u istom SQL snapshotu. Čekanje prestaje početkom termina; analitika ne mijenja status dok čita podatke.

Ispod je **Aktivnost u izabranom periodu**, računata iz istorijskih događaja. „Primljeni zahtjevi u periodu: 6“ i „Na čekanju sada: 0“ mogu oba biti tačna ako su svih šest zahtjeva već potvrđena, otkazana ili drugačije zatvorena. Automatske seanse iz serije povećavaju ukupan broj termina, ali nijesu novi primljeni upiti. Naslovi i napomene u prikazu naglašavaju tu razliku.

- **Svi pregledi profila:** svako otvaranje ili osvježavanje profila, uključujući više otvaranja istog posjetioca tokom istog dana. Katalog i prefetch nijesu otvaranja profila. Klijenti, anonimni browseri, drugi prijavljeni nalozi i vlasnik profila prikazani su u odvojenim grupama.
- **Različiti posjetioci:** jedan prijavljeni nalog ili jedan anonimni browser računa se jednom u periodu. Isti prijavljeni nalog na više uređaja ostaje isti posjetilac. Anonimni browser dobija nasumični HttpOnly/SameSite kolačić `terapeut_analytics` na 30 dana; brisanje kolačića, drugi browser ili kasnija prijava mogu istu osobu predstaviti kao više posjetilaca. To nije broj provjerenih različitih fizičkih osoba.
- **Ponovljeni pregledi:** svi pregledi minus različiti posjetioci. Prikazuju se i posjetioci sa tačno jednim/više pregleda, prvi put/ranije zabilježeni posjetioci, prosjek i najveći broj pregleda jednog posjetioca.
- **Po posjetiocu:** tabela sa stabilnom oznakom samo za taj profil, grupom, svim i ponovljenim pregledima, brojem aktivnih dana i prvim/posljednjim pregledom u periodu. Nema imena, emaila, ID-a naloga ili vrijednosti kolačića. Redosljed je po broju pregleda, 50 po stranici, uz navigaciju kroz sve stranice.
- **Po danima:** svi pregledi, dnevni različiti posjetioci, ponavljanja, pregledi klijenata i anonimni pregledi. Različiti posjetioci za cijeli period računaju se zasebno; nijesu zbir dnevnih različitih posjetilaca.
- **Primljeni zahtjevi u periodu:** događaji `REQUEST_CREATED`, uključujući zahtjeve koji su kasnije potvrđeni, otkazani, odbijeni ili istekli. Ovo nije broj sada otvorenih zahtjeva. Automatski potvrđeni stalni termini i dodjele sa liste čekanja nijesu novi upiti.
- **Potvrđeni termini:** prva potvrda pojedinačne rezervacije, uključujući serije i listu čekanja. Naknadno pomjeranje, ispravka ishoda ili otkazivanje ne briše prvu potvrdu i ne dodaje drugu.
- **Otkazivanja:** svi istorijski prelazi u `CANCELLED`, uključujući povučene zahtjeve i prekinute serije. Odbijanja se računaju zasebno u dnevnoj tabeli.
- **Predlozi novog vremena:** svako `ALTERNATIVE_PROPOSED`. **Prihvaćena pomjeranja:** svako `ACCEPT_ALTERNATIVE`; odbijeni predlozi ne ulaze u prihvaćena pomjeranja.
- **Konverzija profila:** različiti klijenti koji su nakon pregleda poslali zahtjev u istom izabranom periodu / različiti klijenti koji su pregledali profil u tom periodu × 100. Jedan klijent se broji jednom, bez obzira na broj zahtjeva. Bez pregleda prikazuje se „—“. Ovo je mjerljivi dio prijavljenih posjetilaca, ne procjena svih posjeta.

Period se odnosi na **vrijeme radnje**, ne na datum održavanja seanse. Prva potvrda u periodu ostaje u broju i ako je seansa kasnije otkazana. Zbog toga kartice nijesu zbir trenutnih statusa. Istorija rezervacija prije ove funkcije ostaje dostupna; pregledi se ne izmišljaju retroaktivno. Datum početka praćenja prikazan je na stranici.

## Tok podataka i mjesta za breakpoint

1. Migracija `013-profile-analytics.sql` je ranije dodala dnevni minimum pregleda. `014-profile-view-events.sql` dodaje `profile_view_events` i poseban datum početka detaljnog praćenja. Stari dnevni minimum prenosi se bez duplikata; izgubljena ranija ponavljanja ne izmišljamo. Stara tabela ostaje sačuvana. Pokretanje: `npm.cmd run db:migrate`.
2. `features/profile.tsx` montira `components/profile-view-tracker.tsx` tek kada je aktivni profil stvarno prikazan. Komponenta čeka `useAuth`, zatim šalje `POST /api/v1/analytics/profiles/:id/view`. Ako upis ne uspije, konzola ima kratku poruku; profil i zakazivanje nastavljaju da rade.
3. `ProfileViewTracker` dodjeljuje novi UUID za svako otvaranje/refresh. Ref čuva isti UUID tokom razvojnih Strict Mode efekata i osvježavanja auth stanja. Dupli HTTP upis **istog otvaranja** ne broji se dva puta; nova otvaranja imaju nove UUID-ove i sva se broje. `AnalyticsController` određuje anonimni kolačić, dok servis provjerava postojeći JWT ako je prisutan; neispravna sesija ne pretvara se tiho u anonimnog posjetioca. Grupa i vlasništvo dolaze sa servera. Limiti su 2000 upisa po identitetu/satu i 10000 po socket adresi/satu; IP adrese se ne čuvaju u događajima (postojeći rate limit koristi privatni hash ključa).
4. `GET /api/v1/analytics?days=30&page=1` provjerava terapeuta i pronalazi profil preko `linked_user_id`. Ne prihvata terapeutski ID za izbor tuđih podataka. Jedan SQL snapshot povezuje istoriju rezervacija, dnevne događaje, različite posjetioce, grupe i paginiranu tabelu. Konverzija koristi samo različite klijente; anonimni, vlasnik i drugi nalozi ne ulaze u imenilac.
5. `features/profile-analytics.tsx` čuva izabrani period i stranicu posjetilaca. `features/analytics-visitors.tsx` prikazuje brojeve i odvojene tabele posjetilaca. Promjena perioda vraća prvu stranicu i prekida stari zahtjev; greška ne predstavlja nulu i ima ponovni pokušaj. Promjena naloga uklanja prethodni prikaz. `packages/domain/src/types.ts` dijeli oblik izvještaja između API-ja i prikaza.

Izvještaj vraća isključivo agregate: terapeut ne dobija spisak identiteta posjetilaca. Provjere su u `apps/api/test/analytics.test.ts` i `tests/auth-e2e/analytics.spec.ts`.
