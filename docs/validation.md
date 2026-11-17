# Provjera početne verzije

## Primljeni zahtjevi i trenutno čekanje — 25. oktobar 2026.

- Provjera zbirnih podataka razjasnila je primjer sa 6 primljenih zahtjeva u 30 dana i 0 na čekanju: tri su sada potvrđena i tri otkazana. To su različite mjere. Analitika sada odvojeno prikazuje trenutno stanje svih rezervacija (nezavisno od perioda) i istorijske radnje u periodu. Kartice su preimenovane u „Primljeni zahtjevi u periodu“ i „Potvrde termina u periodu“, sa objašnjenjima.
- `currentBookings` se računa u istom SQL snapshotu iz vlastitih rezervacija, uključuje automatske termine i razlikuje odgovor terapeuta/klijenta. Isteklo čekanje ne prikazuje se kao aktivno čak i prije sljedećeg rada expiry worker-a; samo čitanje ne mijenja rezervaciju.
- Prolaze TypeScript, svih **101 domenskih/API provjera** (26 domenskih i 75 API), produkcioni build i provjera formata. Novi API scenario provjerava razliku između istorijskog broja i čekanja, nezavisnost trenutnih brojeva od perioda, oba tipa čekanja i prestanak čekanja pri isteku.
- Oba browser scenarija analitike završno prolaze **2/2**. Zahtjev prvo čeka, poslije potvrde ima 0 na čekanju i 1 trenutno potvrđen, poslije otkazivanja 0 trenutno potvrđenih i 1 u istoriji; broj primljenih zahtjeva ostaje 1. Provjereni su novi naslovi, odvojeni brojevi i mobilna širina bez prelivanja. Upute su u [profile-analytics.md](profile-analytics.md).

## Analitika svih pregleda profila — 25. oktobar 2026.

- Privatna stranica `/dashboard/analytics` dostupna je iz pregleda terapeuta i menija „Moj nalog“. Periodi su 7/30/90 dana, sa karticama, grafikom, dnevnom tabelom i tabelom posjetilaca (50 po stranici).
- Svako otvaranje ili refresh se računa, uključujući ponavljanja. Različiti posjetioci, ponovljeni pregledi, posjetioci sa jednim/više pregleda, novi/raniji, prosjek i maksimum su odvojeni. Klijenti, anonimni browseri, drugi nalozi i vlastiti pregledi imaju posebne brojeve. Konverzija koristi samo prijavljene klijente. Tabela posjetilaca ne otkriva identitete.
- Migracije `013-profile-analytics` i `014-profile-view-events` primijenjene su na razvojnu bazu bez reseta. Stari dnevni minimum ostaje sačuvan, a nepoznata ranija ponavljanja se ne dopisuju. Lokalni API health potvrđuje `profileAnalytics: enabled`.
- Prolaze `npm.cmd run typecheck`, svih **100 domenskih/API provjera** (26 domenskih i 74 API), produkcioni frontend/API build i `npm.cmd run format:check`. Novi skup pokriva vlasništvo, svako novo otvaranje, dupli HTTP upis, istoriju rezervacija, lokalnu ponoć, ranije potvrde, anonimne ponovne preglede, odvojene grupe, privatnost i paginaciju.
- Završno prolaze **4/4 browser scenarija**: dva za analitiku (stvarne JWT sesije, anonimni HttpOnly kolačić, svi/različiti/ponovljeni pregledi, zahtjev/potvrda/otkazivanje, konverzija, vlasništvo, periodi, učitavanje/greška/ponovni pokušaj i mobilna širina) i dva postojeća za privatne materijale. Testovi koriste izolovanu šemu i testne naloge.
- Provjereni su snimci `test-results/analytics-therapist-*/analytics-desktop.png` i `analytics-mobile.png`. Testni Next server ne čuva dodatni Turbopack disk cache, da ponovna pokretanja ne popunjavaju disk. Prvo pokretanje otkrilo je preširok selektor za grešku (uključivao Next route announcer) i nedostatak prostora; selektor je ograničen na analitiku i očišćen je samo generisani cache ugašenog testnog servera. Završno pokretanje prolazi u cijelosti.
- Definicije, ograničenja razlikovanja anonimnih osoba i debugging koraci su u [profile-analytics.md](profile-analytics.md).

## Privatni materijali i domaći zadaci — 25. oktobar 2026.

- Terapeut dodjeljuje jednom svom klijentu tekst, preporučeni link, opcioni rok i PDF do 5 MB. Vrste su domaći zadatak, vježba, dnevnik i preporučeni materijal. Klijent koristi „Moji materijali“ u nalogu. Izbor klijenta dolazi iz potvrđenih/ranije održanih seansi; svaki terapeut vidi samo svoje dodjele, a klijent samo ono što je njemu dodijeljeno.
- Migracija `012-client-materials` dodata je u razvojnu bazu bez reseta. Tekst i PDF `bytea` čuvaju se zajedno. API health na portu 4000 potvrđuje `clientMaterials: private`; frontend na portu 3000 odgovara uspješno. Privatni PDF nema javnu putanju i provjera sesije/vlasništva izvršava se za svako preuzimanje.
- Prolaze `npm.cmd run typecheck`, svih **93 domenskih/API provjera** (26 domenskih i 67 API), produkcioni frontend/API build i provjera formata. Novi skup ima sedam provjera: osnovna PDF/link validacija, privatnost dva klijenta i dva terapeuta istog klijenta, veza sa potvrđenom seansom, uređivanje bez promjene primaoca, verzijski konflikt, zamjena/uklanjanje priloga, odbijanje neispravnog/praznog unosa bez gubitka dokumenta i povlačenje.
- Potvrđeno je šest relevantnih browser scenarija kroz ciljane provjere: klijentov nalog/profil, dvije postojeće provjere fotografija, postojeći indikatori čekanja i dva nova scenarija materijala. Završno oba nova prolaze **2/2**. Testovi koriste stvarne JWT sesije u izolovanoj šemi.
- Browser dokazuje slanje PDF-a sa nazivom koji sadrži naša slova, vidljiv spinner i blokirano dugme, prikaz samo odabranom klijentu, uskraćen pristup drugom klijentu/terapeutu i anonimnom posjetiocu, Origin zaštitu, stvarno preuzimanje identičnih PDF bajtova, uređivanje uz očuvani prilog i povlačenje sa zatvorenim starim linkom. Odbijeni su lažni, prazni i preveliki prilozi i nedozvoljeni linkovi. Mobilna kartica nema horizontalno prelivanje; snimak je `test-results/materials-therapist-*/client-material-mobile.png`.
- Tehnički vodič, granice osnovne PDF provjere, privatnost, verzije, arhiva i mjesta za breakpoint nalaze se u [client-materials.md](client-materials.md). Povlačenje zatvara budući pristup kroz aplikaciju, dok prethodno preuzeta lokalna kopija ostaje kod klijenta.

## Lista čekanja — 25. oktobar 2026.

- Klijent bira konkretan zauzeti termin ili dane i vremenski raspon, uz saglasnost za jednu automatski potvrđenu seansu. Dodjela po serverskom redosljedu, status prijave, rezervacija, istorija i dva email outbox reda čuvaju se atomskim upisom. Prijava se može povući dok čeka.
- Migracija `011-waitlist` primijenjena je na razvojnu bazu bez reseta; dodata je i oznaka formulara za ponovne pokušaje. Aktivni API na portu 4000 vraća `waitlist: enabled`, a postojeći frontend na portu 3000 odgovara uspješno.
- Prolaze TypeScript, svih **86 domenskih/API provjera** (26 domenskih i 60 API), produkcioni frontend/API build i provjera formata. Novi SQL skup provjerava red prijave, duplikate, isti ponovljeni formular poslije dodjele, vlasništvo, povlačenje, saglasnost, raspon/dane, neradne datume, konkurentno redovno zakazivanje, rollback outbox kvara, izmijenjenu ponudu, istek, restart, A → B i prekid stalne serije.
- Potvrđeno je osam relevantnih browser scenarija: šest postojećih tokova rezervacija, emaila, klijentovog naloga i stalnih termina, te dva nova toka liste čekanja. Oba nova završno prolaze u ciljanoj provjeri **2/2**. Test fleksibilnog izbora koristi ponuđeni početak 10:05 poslije zauzetog 09:00–09:50, prema postojećem koraku od 15 minuta od početka slobodnog intervala.
- U stvarnom browseru potvrđeni su FIFO dodjela sa dva odvojena klijenta, odmah potvrđena seansa kod obje uloge, stvarne Mailpit poruke za klijenta i terapeuta, zaštita tuđe prijave, povlačenje i mobilna širina bez prelivanja. Mobilni snimak pregleda je u `test-results/waitlist-first-*/waitlist-mobile.png`. Sve rezervacije i poruke u provjerama pripadaju izolovanim testnim nalozima.
- Tehnički vodič, ograničenja i mjesta za breakpoint nalaze se u [waitlist.md](waitlist.md). Lokalni SMTP ostaje Mailpit; spoljna dostava koristi konfigurisan SMTP.

## Stalni termini na 7 i 14 dana — 25. oktobar 2026.

- Terapeut uključuje checkbox na potvrđenoj budućoj seansi konkretnog klijenta. Pravilo ostaje aktivno dok ga ne zaustavi; server održava pojedinačne potvrđene rezervacije za narednih 90 dana. Promjena ili otkazivanje jedne seanse ne pomjera ostale i ne dovodi do ponovnog stvaranja otkazanog termina.
- Migracija `010-recurring-bookings` primijenjena je na razvojnu bazu bez reseta. Health potvrđuje `recurringBookings: enabled`. Pokrenuti su postojeći PostgreSQL i Mailpit kontejneri nakon oporavka zaustavljenog Docker engine-a; postojeći podaci ostaju sačuvani.
- Novi API skup ima devet provjera: 7/14 dana i paralelno uključivanje, vlasništvo, početni konflikt uz rollback, pojedinačna izmjena i otkazivanje, nastavak iz sačuvanog cursora poslije restarta, neradni datum i njegova zamjena, prekid uz očuvane prošle ishode, zaštita dospjelog termina od tuđeg predloga, neočekivani kvar outbox upisa i trka sa nezavisnim pacijentom.
- Završno prolaze TypeScript, svih 77 domenskih/API provjera (26 domenskih i 51 API), produkcioni frontend/API build i provjera formata.
- Potvrđeno je sedam relevantnih browser scenarija kroz dva pokretanja. Pet prolazi u prvom (postojeće rezervacije/email, klijentov pregled/profil, spinners i zamjena neradnog datuma). Dva nova toka 7/14 dana završno prolaze 2/2 poslije ispravke testnog selektora padajuće liste. Provjereni su checkbox, uloga vlasnika, oba naloga, zauzet kalendar, pojedinačno prihvatanje/otkazivanje, prekid i mobilna širina bez prelivanja. Mobilni snimci su u `test-results/recurring-bookings-*/`.
- Svi testni upisi koriste izolovane šeme i testne email adrese. Početni skup se čuva atomskim upisom; kasniji nedostupni datumi vidljivi su za zamjenu i nijesu predstavljeni kao zakazane seanse. Postojeći email outbox čuva potvrde i otkazivanja za svaku seansu. Tok podataka, ograničenja i debugging koraci su u [recurring-bookings.md](recurring-bookings.md).

## Izgled po uzoru na terapeut.me — 17. oktobar 2026.

- Uvedeni su lokalni Inter i Plus Jakarta Sans, tirkizna paleta, svijetla pozadina, bijele kartice, javni logo/simbol i dekorativna fotografija reference. Početna ima centriran uvod; isti vizuelni sloj koriste prijava, registracija, katalog, profili, klijentovi termini i terapeutov pregled.
- Typecheck, svih 68 domenskih/API provjera i produkcioni frontend/API build prolaze. Kompletan skup browser provjera prolazi **18/18** u Edge-u: prijava, registracija, profili obje uloge, rezervacije i email, istorija, lozinke, fotografije, raspored i indikatori čuvanja. Testovi koriste izolovanu šemu i lokalni Mailpit.
- Dodatno je provjeren 21 javni prikaz: početna, katalog, prijava, registracija terapeuta, javni profil, zakazivanje i FAQ na širinama 1440, 390 i 320 px. Nema horizontalnog prelivanja ili pokvarenih slika. Oba fonta sa našim slovima učitavaju se lokalno. `prefers-reduced-motion` isključuje novu animaciju.
- Vizuelno su pregledani desktop i mobilni snimci javnih stranica, klijentovih termina/profila i terapeutovog rasporeda. Javni snimci i izvještaj su u ignorisanom `.local/design-reference/`; privatni testni snimci su u `test-results/`. Poslovni API, provjere zauzetosti, JWT i sačuvana istorija nijesu mijenjani.
- Izvori materijala, licence fontova, redosljed CSS-a i mjesta za debugging opisani su u [appearance.md](appearance.md).

## Naziv datuma u istoriji i redosljed seansi — 17. oktobar 2026.

- Kod prihvatanja novog termina istorija prikazuje „Prihvaćeni termin“, uz datum već predloženog termina B. „Prethodni termin“ ostaje uz predlog A → B. Potvrda, odbijanje i otkazivanje imaju odgovarajuće nazive. Sačuvani događaji nijesu prepravljani.
- Klijent i terapeut vide buduće aktivne seanse po datumu i satu od najbližeg. Kasniji zahtjev ili predlog ne preskače raniju potvrđenu seansu. Prošle seanse bez upisanog ishoda i istorija slijede iza budućih.
- Typecheck, svih 68 domenskih/API provjera i produkcioni build prolaze. Tri relevantna browser scenarija prolaze u Edge-u, sa izolovanim testnim šemama i lokalnim Mailpit-om.
- Browser provjerava različite statuse i datume kod obje uloge, redosljed početaka istog dana (09:00, 10:00, 13:05), prihvatanje termina pomjerenog za sedam dana, nazive istorije nakon ponovnog učitavanja i očuvane prethodne događaje. SMTP scenario sada provjerava i sedmu poruku: obavještenje terapeutu o prihvatanju predloga. Postojeći tokovi zakazivanja, otkazivanja i profila prolaze.

## Email obavještenja o rezervacijama — 17. oktobar 2026.

- Novi zahtjev, istorija i outbox događaj upisuju se zajedno. Novi zahtjev obavještava terapeuta; potvrda, odbijanje i predlog obavještavaju klijenta. Odgovor klijenta i otkazivanje obavještavaju drugu stranu. Aplikacija zadržava sve postojeće prikaze i provjere vlasništva.
- Migracija `009-booking-notifications` primijenjena je na lokalnu bazu bez reseta i bez retroaktivnog slanja za ranije zahtjeve. Aktivni razvojni API vraća `bookingNotifications: outbox` na health provjeri. Postojeći SMTP režim je lokalni Mailpit.
- Typecheck, produkcioni frontend/API build i format provjera prolaze. Svih **68 domenskih/API provjera** prolazi bez preskakanja: 26 domenskih i 42 API provjere, uključujući stvarne PostgreSQL transakcije.
- Novi API test provjerava sadržaj i primaoca, jedinstven red, rollback pri kvaru outbox upisa, SMTP grešku i retry iz nove instance, stabilan ID poruke, preskakanje zastarjelog stanja i suspendovanog primaoca, kao i dva paralelna workera. Provjereni su bezbjedni kodovi za SMTP prijavu i konekciju.
- Prolaze sva **tri relevantna browser scenarija**: SMTP obavještenja, dvije nezavisne rezervacije i klijentov pregled/profil. Novi SMTP scenario kroz stvarne formulare potvrđuje šest prihvaćenih poruka u Mailpit-u: tri zahtjeva terapeutu i tri odgovora klijentu (potvrda, odbijanje, predlog). Provjereni su linkovi ka odgovarajućim zahtjevima, trajanje 50 minuta, stari i novi sat i isti statusi kod oba naloga u aplikaciji.
- Testovi koriste zasebne šeme i testne adrese; ne šalju spoljne emailove. Stvarna dostava zahtijeva podešen SMTP i domen. SMTP prihvatanje nije potvrda čitanja; rijedak prekid između slanja i `sent_at` može izazvati ponovni pokušaj. Ograničenja, dijagnostičke oznake i breakpoint koraci opisani su u [booking-notifications.md](booking-notifications.md).

## Klijentovi termini i preglednije uređivanje profila — 17. oktobar 2026.

- Klijent prvo vidi termine, četiri filtera i najbliži budući potvrđeni termin. Kartica prikazuje terapeuta, sačuvanu vrstu seanse, puno vrijeme, trajanje, cijenu, status i link ka terapeutu. Javni katalog dopunjava fotografiju, zvanje i sadašnju adresu ordinacije. Predlozi koji čekaju odgovor su prvi, a istorija ima razumljive opise događaja.
- Profil prikazuje lične i kontakt podatke u odvojenim karticama. Uređivanje zamjenjuje pregled jednim formularom sa jasnim grupama. Provjereni su odustajanje bez upisa, greška uz zadržavanje unosa, čuvanje obje uloge i novi pregled iz baze nakon osvježavanja. Terapeut ima i profesionalnu grupu.
- `npm.cmd run typecheck`, svih 59 domenskih/API testova i produkcioni build prolaze. Provjera formata prolazi. Nema novih migracija; testni podaci nastaju u izolovanim šemama.
- Potvrđeno je svih 12 relevantnih browser scenarija kroz dva pokretanja: 10 je prošlo u prvom, a mobilni jezik i novi klijentski pregled završno prolaze 2/2. Prvi mobilni pokušaj prekinut je sa `ERR_NETWORK_IO_SUSPENDED`; testni početak nove rezervacije usklađen je sa postojećim korakom od 15 minuta nakon kraja prethodne seanse.
- Novi scenario koristi dva terapeuta i tri rezervacije: provjerava filtere, izdvojeni termin i povratak sa filtera na detalje, odbijanje predloga, otkazivanje potvrđenog termina, čitljivu istoriju i profil. Kvar javnog kataloga ne sakriva privatne rezervacije; prikazuju se zamjenske ikone. Null cijena ostaje „Na upit“.
- Desktop pregled i mobilni formular su vizuelno pregledani u `test-results/client-account-*/`. Mobilni prikaz nema horizontalno prelivanje. Spinneri i jedna potvrda čuvanja koja nestaje poslije četiri sekunde prolaze postojeći scenario.

## Intuitivniji pregled terapeuta — 17. oktobar 2026.

- Zahtjevi se prikazuju prije podešavanja, sa brojevima i filterima za sve zahtjeve, čekanje, potvrđene termine i istoriju. Novi zahtjevi su prvi. Kartice prikazuju naziv seanse, datum, vrijeme, kontakt i postojeće radnje.
- Usluge, sedmični raspored i posebni datumi koriste tri početno zatvorene padajuće sekcije. Izbor vremena koristi sat 00–23 i minut 00–59. Browser je sačuvao 10:07 i ponovo učitao te sate iz baze; izmjene seansi i neradnih datuma i dalje se vide kod drugog pacijenta.
- „Moj nalog“ otvara profil i odjavu na desktopu i telefonu. Provjereni su Escape i vraćanje fokusa, klik van menija, zatvaranje na link ka već otvorenom profilu, greška odjave sa ponovnim pokušajem i stvarna odjava nakon koje `/auth/me` vraća 401.
- `npm.cmd run typecheck`, svih 59 domenskih/API testova, produkcioni build i provjera formata prolaze. Testovi koriste posebne PostgreSQL šeme; stvarni rasporedi i nalozi nijesu mijenjani.
- Završna fokusirana browser provjera prolazi **4/4**: registracija terapeuta, dvije nezavisne rezervacije, uređivanje usluga/dostupnosti i menija, te indikatori čuvanja. Preostalih 12 scenarija prošlo je u prethodnom punom pokretanju. Prvo puno pokretanje bilo je 13/16: usklađen je stari naslov u testu, klik van menija pomjeren je na slobodnu marginu, a test sa zastalim učitavanjem ponovljen je uspješno bez paralelnog build procesa.
- Pregledani su desktop i mobilni screenshotovi pregleda, časovnika i menija u ignorisanom `test-results/`. Mobilni pregled nema horizontalno prelivanje. Jedna odgovarajuća potvrda čuvanja i automatsko nestajanje poslije četiri sekunde ostaju provjereni.

## Jedna potvrda prema vrsti izmjene — 17. oktobar 2026.

- Čuvanje seanse prikazuje samo „Seansa je sačuvana.“, a čuvanje sedmičnih sati ili datuma samo „Raspored je sačuvan.“. `ScheduleEditor.getSavedMessage` bira tekst, a jedina potvrda uspjeha je u zajedničkom prikazu iznad formulara.
- Lokalni editori ne prikazuju drugu zelenu potvrdu; zadržavaju greške uz unos. Spinner i automatsko nestajanje potvrde poslije četiri sekunde ostaju aktivni. Obavještenja o uklanjanju i već sačuvanom periodu zadržavaju svoj precizan tekst.
- Typecheck, produkcioni build, svih 59 domenskih/API testova i format provjera prolaze.
- Prolaze sva tri relevantna browser scenarija. Nova provjera broji jednu potvrdu u cijelom editoru i provjerava tačan tekst nakon čuvanja seanse, sedmičnih sati i datuma. Provjereno je da formular nema drugu zelenu poruku, da nova izmjena uklanja prethodnu potvrdu i da potvrda i dalje sama nestaje.

## Automatsko skrivanje potvrde čuvanja — 17. oktobar 2026.

- Po novom korisničkom zahtjevu zelena potvrda prikazuje samo kratak naslov i nestaje poslije četiri sekunde. Zajednički `SaveFeedback` to primjenjuje na profil, usluge, radno vrijeme, datume i fotografije.
- Timer se uklanja pri promjeni poruke i zatvaranju komponente. Ponovljeno čuvanje ponovo prikazuje potvrdu, uključujući isti tekst. Skrivanje poruke ne mijenja sačuvane podatke; greške i čekanje se ne skrivaju ovim timerom.
- Typecheck, produkcioni build, svih 59 domenskih/API testova i format provjera prolaze.
- Prolaze tri relevantna browser scenarija za zakazivanje, raspored i povratne poruke. Potvrđeno je automatsko nestajanje na profilu, datumu i fotografiji, ponovna pojava pri uzastopnom čuvanju istog profila i zadržavanje poruke o neuspješnom unosu nakon isteka druge potvrde. Završna DB provjera i dalje potvrđuje sačuvane podatke i istorijsko trajanje rezervacije.

## Jasna potvrda profila i radnog vremena — 17. oktobar 2026.

- `ProfileLoading` prikazuje spinner, objašnjenje i ukrasne linije dok nalog, javni ili vlastiti terapeutski profil čeka podatke. `SaveFeedback` razlikuje čekanje, zelenu potvrdu i grešku pomoću teksta, boje i ikone.
- Profil obje uloge ima izraženu potvrdu poslije API odgovora. Seansa, sedmični period, novi sati i datum imaju potvrdu uz svoj formular. Zajednička poruka rasporeda ostaje ispod zaglavlja pri skrolovanju. Potvrde ne nestaju po tajmeru; novi unos uklanja prethodnu potvrdu.
- Fotografija ima potvrdu upisa, promjene profilne ili brisanja. Terapeutski profil ostaje prikazan dok se osvježava, pa potvrda ne nestaje pri ponovnom čitanju. Kontrole fotografija čekaju završetak osvježavanja.
- Typecheck, produkcioni build i svih 59 domenskih/API testova prolaze. Čuvanje i poslovna pravila na serveru nijesu mijenjani; novi rezultat `{ saved, message }` povezuje postojeći API sa prikazom potvrde u formularu. Vodič za korake i breakpoint-e je dopunjen u [loading-feedback.md](loading-feedback.md).
- Svih 16 browser scenarija prolazi. Prošireni test zadržava početna učitavanja oba profila i upise dok provjerava loader i odsustvo lažne zelene potvrde. Poslije odgovora provjerava potvrdu uz seansu/datum/profil/fotografiju, uklanjanje potvrde pri novom unosu i grešku bez gubitka podataka. Potvrđen je upis terapeutovog grada u bazu, mobilna potvrda tokom skrolovanja i smanjeno kretanje. Screenshotovi potvrda su u ignorisanom `test-results` folderu.

## Spinneri i povratna informacija tokom zahtjeva — 15. oktobar 2026.

- Zajednički `ActionButton` dodaje spinner i `aria-busy`, uz blokiranje ponovnog klika. Obuhvaćeni su prijava/registracija/kod, obnova lozinke, profil obje uloge, odjava, usluge, sedmični sati, datumi, fotografije, novo zakazivanje i radnje nad terminom. Kod više dugmadi spinner označava samo pokrenutu radnju.
- Početna čitanja rasporeda, zahtjeva i kalendara imaju indikator. Ručno osvježavanje zahtjeva pokazuje čekanje, dok automatski polling zadržava postojeći prikaz. Potvrđen novi status termina odmah zamjenjuje stare kontrole, pa se lista i istorija dodatno osvježavaju.
- Typecheck, produkcioni build i svih 59 domenskih/API testova prolaze. Format provjera prolazi. Lokalna prijava je vizuelno pregledana na 390px sa zadržanim zahtjevom, bez slanja probne prijave API-ju. Spinner prati boju teksta; podešavanje smanjenog kretanja isključuje animaciju.
- Svih 16 auth/booking/photo/recovery/schedule browser scenarija prolazi. Novi `spinners.spec.ts` zadržava odgovore za prijavu, profil, rezervaciju, potvrdu termina, uslugu, datum i fotografiju. Potvrđeni su vidljiv spinner, onemogućeno dugme i samo jedan zahtjev pri ponovljenom kliku, ispravka poslije greške bez gubitka unosa, upisi u bazi i mobilni prikaz sa smanjenim kretanjem. Ranija rezervacija zadržava trajanje nakon izmjene usluge.
- Koraci, odgovarajuće funkcije i mjesta za breakpoint opisani su u [loading-feedback.md](loading-feedback.md). Dodati komentari objašnjavaju početak čekanja, potvrdu upisa i obavezno čišćenje stanja u `finally`.

## Neradni datum u kalendaru pacijenta — 15. oktobar 2026.

- U lokalnoj bazi je pronađen neaktivan neradni zapis za 16.10.2026. Ponovo je aktiviran samo taj zapis; radno vrijeme drugih dana i rezervacije nijesu mijenjani. Stvarni frontend/API za sva trajanja 30/40/50/60 vraća nula termina i `dayOff: true`.
- Kalendar prikazuje „Terapeut ne radi ovog datuma“. Uklanjanje posebnog datuma kroz „Vrati sedmični raspored“ sada ima objašnjenje i potvrdu, jer to može ponovo otvoriti redovne termine. Odustajanje ne mijenja bazu.
- Typecheck, build, svih 59 domenskih/API testova i format provjera prolaze. Proširena integracija potvrđuje neradni dan za više trajanja, stanje poslije ponovnog čitanja i odbijanje direktnog zakazivanja. Lokalni prikaz za 16.10. je provjeren i kroz Edge na telefonu širine 390px, bez ponuđenih dugmadi termina.
- Prolaze oba relevantna browser scenarija (`booking.spec.ts` i `schedule-editing.spec.ts`) u izolovanoj bazi. Novi koraci dodaju neradni datum preko formulara, provjeravaju klijentsku poruku i nula termina, osvježavanje, otvaranje potvrde i odustajanje bez ponovnog otvaranja dana. Sačuvana promjena u radni dan ponovo nudi termine; potvrđeno uklanjanje izuzetka vraća sedmični raspored.

## Uređivanje usluga i dostupnosti terapeuta — 15. oktobar 2026.

- Dashboard ima direktne ulaze za profil, usluge, sedmično radno vrijeme i konkretne datume. Svaki sačuvani sedmični period ima „Uredi period“; postojeći ID se čuva pri promjeni dana/sati. Tip seanse određuje naziv, a trajanje se uređuje kao cijeli broj 5–240 minuta.
- Migracija `008-date-availability` primijenjena je bez brisanja podataka. Jedan aktivan raspored za datum zamjenjuje sedmične sate tog dana. Podržani su promjena datuma/sati, cijeli neradni dan i vraćanje sedmičnog rasporeda. Ponovljeni datum se odbija bez djelimične promjene.
- Typecheck, build i svih 59 domenskih/API testova prolaze. Nove provjere obuhvataju prednost datuma nad sedmičnim satima, rad na inače neradnom danu, zajedničku zauzetost, direktnu izmjenu perioda, vlasništvo, preklapanje, konkurentni unos datuma, pomjeranje/uklanjanje datuma i očuvanje trajanja/cijene/naziva/istorije stare rezervacije.
- Svih 15 auth/booking/photo/recovery/schedule browser scenarija prolazi. Novi scenario provjerava promjene trajanja 60 → 30 → 50 → 40, naziva seanse, sedmičnih sati i konkretnog datuma, čuvanje nakon osvježavanja i kalendar drugog prijavljenog klijenta. Provjereni su zatvaranje dana, pomjeranje datuma, vraćanje sedmičnog rasporeda i ulaz u uređivanje profila. Mobilni prikaz je pregledan na 390px bez horizontalnog prelivanja; format provjera prolazi.

## Obnova lozinke email JWT linkom — 15. oktobar 2026.

- Prijava ima link ka `/forgot-password`; email vodi na `/reset-password#token=...`. Obje uloge unose i potvrđuju novu lozinku, pa dobijaju novi HttpOnly JWT i početni ekran prema ulozi.
- Migracija `007-password-reset` primijenjena je na lokalnu bazu bez brisanja podataka. Baza čuva hash i rok linka; link važi 15 minuta i koristi se jednom. Novi zahtjev poništava prethodni link.
- Typecheck, build i svih 55 domenskih/API testova prolaze. Novi testovi obuhvataju potpis/istek/namjenu JWT-a, podudaranje lozinki, hash u bazi, stariju vezu, dva paralelna pokušaja, opoziv starih sesija, novu prijavu, nepoznatu adresu, suspenziju, nepotvrđen email i SMTP kvar. Kvar upisa sesije vraća staru lozinku, sesije i reset link u istoj transakciji.
- Obje nove stranice i lokalni API vraćaju HTTP 200. `AUTH_EMAIL_MODE=local` je potvrđen; testovi i lokalna obnova koriste Mailpit, bez slanja na stvarne spoljne adrese.
- Provjereno je svih 14 auth/booking/photo/recovery browser scenarija. Nova provjera otvara stvarni email link, provjerava nepodudarne lozinke, automatsku JWT prijavu obje uloge, opoziv stare sesije i prijavu samo novom lozinkom. Druga provjera odbija neispravne/istekle linkove i strani Origin. Recovery testovi su uspješno ponovljeni nakon dodavanja čekanja da se stranica za obnovu zaista otvori prije unosa emaila. Mobilni tok staje u 390px. Format provjera prolazi.

## Zajedničko uređivanje profila i kontakta — 15. oktobar 2026.

- „Uredi profil“ otvara jedan formular za ime, prezime, datum rođenja, telefon, grad i adresu. Terapeut u istom formularu ima zvanje i biografiju. Jedan `POST /auth/profile` čuva sva polja i ažurira pregled i javni profil nakon uspjeha.
- Migracija `006-profile-contact` primijenjena je na lokalnu bazu bez brisanja podataka. Klijentov opcioni grad i adresa su privatne kolone u `users`; javna ordinacija ostaje u `therapists`. Health provjerava i novu migraciju.
- Typecheck, build i svih 50 domenskih/API testova prolaze. Proširene provjere obuhvataju čuvanje i uklanjanje kontakta klijenta, promjenu kontakta i biografije terapeuta, odbijanje praznog obaveznog telefona/grada, vlasništvo i zajednički rollback svih polja.
- Svih 12 auth/booking/photo browser scenarija je provjereno. Novi kontakt ostaje nakon ponovne prijave kod obje uloge. Dvije provjere su uspješno ponovljene nakon ispravke pristupačne oznake biografije i preciziranja lokatora poruke uspjeha. Format provjera prolazi; frontend i API vraćaju HTTP 200.

## Uređivanje profila klijenta i terapeuta — 15. oktobar 2026.

- `/account` sada ima „Uredi lične podatke“, čuvanje i odustajanje. Obje uloge mijenjaju ime, prezime i datum rođenja; klijent može sačuvati ili ukloniti opcioni telefon. Terapeutov profesionalni formular i dalje čuva zvanje, biografiju, grad, telefon i adresu u bazi.
- Typecheck, produkcioni build i svih 50 domenskih/API testova prolaze uz PostgreSQL integraciju. Novi testovi provjeravaju dozvoljena polja, odbijanje neispravnog datuma/telefona, vlasništvo, trajno čuvanje, očuvanje emaila/uloge/lozinke i zajednički rollback ličnog i javnog imena terapeuta.
- Nova browser provjera prolazi za obje uloge: odustajanje bez upisa, greška bez gubitka unosa, povratak u tab, potvrda sačuvanog reda u bazi, refresh i ponovna prijava. Klijentov telefon popunjava zakazivanje, a novo ime terapeuta vidi se na javnom profilu. Mobilni formular staje u širinu 390px.
- Provjereno je svih 12 auth/booking/photo browser scenarija i sedam demo tokova. Test prijave ponovljen je uspješno odvojeno: paralelno pokretanje dvije komande izazvalo je koliziju zajedničkog `test-results` foldera i `ENOENT` pri čuvanju trace fajlova. Te komande treba pokretati redom dok koriste isti izlazni folder.
- Format provjera prolazi. Frontend na 3000 i API na 4000 vraćaju HTTP 200. Nova migracija nije potrebna; testovi koriste zasebne nasumične šeme.

## Proizvoljno trajanje seansi — 12. oktobar 2026.

- Terapeut dodaje i uređuje naziv, cijenu i cijelo trajanje od 5 do 240 minuta. Dashboard i registracija više nijesu ograničeni na 30/60 minuta; pacijent bira aktivne seanse iz baze. Uklanjanje seanse je oznaka neaktivnosti i zadržava istoriju.
- Typecheck, build, format i svih 48 domenskih/API provjera prolaze. Dodato je zakazivanje od 40/50 minuta, početak naredne seanse tačno po završetku prethodne, odbijanje tuđe izmjene, očuvanje kopija pri promjeni naziva/trajanja/cijene i provjera da ponovne migracije ne deaktiviraju custom trajanja.
- Svih 11 auth/booking i sedam demo browser provjera prolaze. Browser dodaje seanse od 40 i 50 minuta, pa dva pacijenta koriste zajedničku zauzetost; poslije 09:00–09:40 naredni pacijent bira 09:40.
- Desktop i mobilni dashboard su pregledani bez prelivanja na 390px. Screenshotovi su u `.local/screenshots/custom-sessions-*.png`. Na Sanjinom nalogu potvrđeno je postojeće radno vrijeme za ponedjeljak 09–17; dodatni dani nijesu pretpostavljeni.

## Uklonjene pauze iz rasporeda — 12. oktobar 2026.

- Dashboard prikazuje seanse i sedmično radno vrijeme; formular i prikaz pauza/odsustava su uklonjeni. API više ne prihvata `block` i `remove-block` radnje. U lokalnoj bazi nije bilo sačuvanih pauza.
- Typecheck, build, format i svih 47 domenskih/API provjera prolaze. Relevantni browser test potvrđuje odsustvo formulara za pauze, odbijanje stare API radnje, seansu odmah nakon prethodne i zajedničku zauzetost za 30/60 minuta.

## Ponovljeni unos radnog vremena — 12. oktobar 2026.

- Isti dan, početak i kraj sada vraćaju postojeći interval sa porukom „Radno vrijeme je već sačuvano“, bez duplikata. Provjera poslije zaključavanja profila pokriva i paralelne klikove.
- Stvarno preklapanje i dalje se odbija, uz razumljivu poruku umjesto same oznake `OVERLAPPING_AVAILABILITY`.
- Typecheck, build, format i svih 47 domenskih/API provjera prolaze. Relevantni browser test u izolovanoj šemi provjerava ponovni unos bez greške, jedan sačuvan interval, odbijanje djelimičnog preklapanja i ostatak toka zakazivanja.
- Na lokalnom Sanjinom nalogu potvrđen je postojeći ponedjeljak 09–17 i uspješan ponovljeni unos, uz samo jedan odgovarajući interval u bazi.

## Radno vrijeme i stvarne rezervacije — 12. oktobar 2026.

- Migracija `005-booking-sessions` primijenjena je na lokalnu bazu. Dodate su nedostajuće seanse od 30/60 minuta, bez brisanja naloga, usluga ili istorije; druga trajanja se više ne nude za nove rezervacije.
- `npm.cmd run typecheck` i `npm.cmd run build` prolaze za frontend, API i kompajlirana zajednička pravila.
- `npm.cmd test` uz izolovanu PostgreSQL šemu: svih 23 domenske i 24 API provjere prolazi. Novi testovi pokrivaju paralelne upise za različita trajanja, serverske dozvole, radno vrijeme, pauze, neispravno vrijeme/kontakt, privatnu listu, cijenu iz baze, kopiju istorijske cijene, A → B, otkazivanje i jedan događaj isticanja pri paralelnim radnicima.
- `npm.cmd run test:auth:e2e`: svih 11 browser provjera prolazi u Edge-u. Novi tok koristi terapeuta i dva pacijenta u nezavisnim browser kontekstima. Drugi pacijent bez refresh-a vidi zauzetost za oba trajanja, a nakon otkazivanja ponovo može izabrati oslobođeno vrijeme. Radno vrijeme, zahtjevi i odgovor terapeuta ostaju sačuvani nakon refresh-a.
- `npm.cmd run test:e2e`: svih sedam postojećih demo browser tokova prolazi. Demo zakazivanje je izdvojeno na `/demo/therapist/[id]/book`, dok stvarna javna adresa koristi API.
- Desktop i mobilni izbor seanse/kalendara vizuelno su pregledani, bez horizontalnog prelivanja na 390px. Screenshotovi su u ignorisanom `.local/screenshots/scheduling-*.png`; prikaz stvarne zauzetosti je u `booking-mobile.png`.

Vodič sa koracima transakcije i mjestima za breakpoint je u [scheduling.md](scheduling.md). Frontend i API na portovima 3000/4000 rade, a health vraća `database: connected` i `bookingApi: enabled`. Booking emailovi i automatski podsjetnici nijesu dio ove izmjene.

## JWT i početni ekrani prema ulozi — 12. oktobar 2026.

- `npm.cmd run typecheck`, `npm.cmd run build` i `npm.cmd run format:check` prolaze. Nova ruta `/demo/dashboard` čuva odvojene probne uloge; `/dashboard` koristi stvarni nalog terapeuta.
- `npm.cmd test` uz lokalni PostgreSQL i izolovanu testnu šemu: 23 domenske i 16 API provjera prolaze. JWT testovi provjeravaju potpis, algoritam, namjenu, rok, jedinstven token i izmijenjenu ulogu. Integracija provjerava odjavu, istek u bazi, suspenziju i promjenu uloge.
- `npm.cmd run test:auth:e2e`: svih 10 browser provjera prolazi u Edge-u. Pacijent otvara sve terapeute, terapeut svoj dashboard i formular na `/account`; lažni URL parametri ne mijenjaju ulogu. Neprijavljen korisnik i pacijent ne mogu čuvati terapeutski profil. Nesačuvana biografija ostaje u formularu pri pozadinskoj provjeri sesije nakon povratka u tab.
- Svih sedam postojećih testova iz `tests/e2e/workflows.spec.ts` prolazi na `/demo/dashboard`, uz zaseban API, izolovanu testnu šemu i frontend na portu 3200. Provjereni su katalog, rezervacija, A → B, prihvatanje/otkazivanje, usluge, dostupnost, kalendar, Excel i mobilni prikaz. Test predloga čeka učitan zahtjev prije čitanja `localStorage`, umjesto da pretpostavlja da je React effect završen pri `goto`.
- Profesionalni podaci i kontakt čuvaju se u transakciji; kvar upisa kontakta povlači izmjenu profila. Drugi terapeut ostaje nepromijenjen, a usluge i verifikacija se čuvaju. Browser provjerava čuvanje, osvježavanje i javni prikaz izmijenjene biografije.
- Desktop i mobilni dashboard/nalog su vizuelno pregledani, bez horizontalnog prelivanja na širini 390px. Screenshotovi su u ignorisanom `.local/screenshots/jwt-*.png`.

JWT ostaje u HttpOnly kolačiću, uz opozivu sesiju u bazi. Prethodne sesije zahtijevaju novu prijavu; nema nove SQL migracije. Rezervacije i administrativne probne uloge ostaju lokalni demo.

## Katalog i fotografije iz baze — 7. oktobar 2026.

- Migracija `004-directory-photos` primijenjena je bez gubitka postojećih profila. Četiri stara probna stručnjaka su uvezena, a novoregistrovani profil ostao je sačuvan; lokalni katalog ima pet profila.
- Postavljene su izričito tražene lokalne terapeutske lozinke `Test123`. Browser provjerava četiri uvezena naloga, a zasebno je provjerena prijava najnovijeg postojećeg naloga i njegove kontrole fotografija.
- `npm.cmd test` uz PostgreSQL testnu šemu: 23 domenske i 13 API provjera prolaze. Novi testovi provjeravaju idempotentan seed, DB čitanje, fotografije, lažne datoteke, tuđe vlasništvo, paralelni limit osam slika i jednu profilnu fotografiju.
- TypeScript i frontend/API build prolaze. Auth browser paket ima osam provjera: prijave, novi profili u javnom katalogu, upload, profilna slika, javna galerija, brisanje i odbijanje drugog terapeuta.
- Svih sedam postojećih browser tokova i dalje prolazi nakon promjene izvora javnih profila. Poslovne provjere lokalnih rezervacija i istorija su sačuvane.

Detalji uvoza, lokalne prijave i čuvanje fotografija su u [directory.md](directory.md). Rezervacije i probna administracija još nijesu serverske; njihove lokalne izmjene ne mijenjaju javni katalog iz baze.

## Posebna registracija terapeuta — 7. oktobar 2026.

- TypeScript i produkcioni frontend/API build prolaze za novu rutu `/register/therapist`.
- `npm.cmd test` uz `AUTH_TEST_DATABASE_URL`: 23 domenske i 11 API provjera prolaze. Dodatno su provjereni profesionalni podaci, decimalna/prazna/nulta cijena, THERAPIST uloga, povezani profil/usluga, privatno vlasništvo i povlačenje cijele transakcije pri kvaru upisa usluge.
- `npm.cmd run test:auth:e2e`: svih 6 browser provjera prolazi. Terapeutski profil ostaje sačuvan nakon refresh-a, odjave i nove prijave; dodatna ADMIN i verifikaciona polja iz browsera se ignorišu. Klijent ne može otvoriti privatni terapeutski prikaz.
- `npm.cmd run format:check` prolazi. Desktop i mobilni formulari su pregledani; screenshotovi su u ignorisanom `.local/screenshots/`.
- Migracija `003-therapist-registration` primijenjena je bez reseta postojeće baze. Nalog, profil i usluga nastaju tek nakon potvrde koda. Email se lokalno čita u Mailpit-u.

Javni katalog, rasporedi i rezervacije još koriste demo podatke. Novi profili iz baze prikazuju se vlasniku na `/account`; profesionalnu verifikaciju i dalje dodjeljuje admin, ne email potvrda.

## Registracija i prijava — 7. oktobar 2026.

Windows, Node.js 22.13.1, PostgreSQL 17, lokalni Mailpit i Edge kroz Playwright.

- `npm.cmd run typecheck`: sva tri workspace-a prolaze.
- `npm.cmd test` uz `AUTH_TEST_DATABASE_URL`: 23 domenske i 8 API provjera prolaze. API provjere koriste zasebnu nasumičnu šemu i uklanjaju je nakon testa.
- `npm.cmd run build`: frontend i NestJS API se uspješno kompajliraju; nove rute su `/register`, `/login` i `/account`.
- `npm.cmd run test:auth:e2e`: 4 browser provjere prolaze sa zasebnim API-jem na 4100 i frontendom na 3200. Obuhvaćeni su SMTP kod, pogrešan i istekao kod, ponovno slanje, nastavak nakon refresh-a, upis naloga u bazu, HttpOnly sesija, odjava, pogrešna lozinka, prijava, istek sesije, odbijanje stranog Origin-a, mobilni prikaz i engleski jezik.
- `npm.cmd run test:e2e`: svih 7 postojećih browser tokova rezervacija i admin demoa prolazi.
- `npm.cmd run format:check`: prolazi. Podešavanje `endOfLine: auto` čuva postojeće CRLF/LF krajeve redova.
- Vizuelno su pregledane registracija na desktopu i telefonu; screenshotovi su u ignorisanom `.local/screenshots/`.
- Migracija `002-auth` primijenjena je na lokalnu bazu bez reseta. Health endpoint potvrđuje vezu sa bazom i uključen auth API; booking API još nije uključen.

Stvarna dostava na spoljne email adrese nije aktivirana: po dogovoru se lokalno koristi Mailpit. Za javnu dostavu potrebno je podesiti SMTP servis prema [auth.md](auth.md). Ove provjere ne potvrđuju javni produkcioni deployment, serverske rezervacije, podsjetnike ili admin/terapeutske dozvole koje još nijesu implementirane.

## Ranija provjera demo verzije

Datum: 6. oktobar 2026. Windows, Node.js 22.19.0.

- TypeScript: sva tri workspace-a prolaze provjeru.
- Produkcioni build: Next.js frontend i NestJS API se uspješno kompajliraju.
- Domenski testovi: 23 provjere dostupnosti, preklapanja, A → B, otkazivanja, ishoda, cijene i vremenske zone.
- Browser: katalog/filteri, MNE/EN, zahtjev iz kalendara, predlog B, prihvatanje, otkazivanje, uređivanje usluga, konflikt dostupnosti, nedjeljna satnica, admin verifikacija i validan Excel fajl.
- Mobilni prikaz: početna, katalog, profil, zakazivanje, dashboard i FAQ na širini 390px bez prelivanja stranice.
- Vizuelni pregled: screenshotovi početne i kalendara na desktopu i telefonu u ignorisanom `.local/screenshots/`.
- PostgreSQL 17: migracija je primijenjena na novoj lokalnoj Docker bazi. `db/checks.sql` prolazi provjere zabrane preklapanja, dozvoljenih susjednih termina, oslobađanja A i očuvanja intervala nakon neuspješnog predloga. Sve testne promjene se povlače sa `ROLLBACK`.
- API health endpoint vraća da API radi, ali da booking API i veza sa bazom nijesu uključeni.

Ove provjere važe za demo i osnovu projekta. Nije potvrđena produkciona autentifikacija, autorizacija, email dostava ili serverska konkurentnost jer ti tokovi još nijesu implementirani. Baza već ima ograničenje protiv preklapanja, ali frontend trenutno čuva zahtjeve u browseru.

## Pregled radi održavanja

Pregledani su aplikacioni kod, zajednička pravila, SQL, konfiguracija i testovi. Dashboard je podijeljen na jasne ekrane, Excel i browser skladište su izdvojeni, a formulari koriste imenovane funkcije. Funkcije imaju komentare; CSS cjeline i infrastruktura imaju objašnjenja. Vodič `docs/maintaining.md` prati tok podataka i objašnjava Next.js i NestJS početniku.

Prikaz cijene čuva decimale. Jezik HTML dokumenta prati sačuvani izbor i nakon ponovnog otvaranja. Oblik demo podataka i ključ skladišta ostali su isti, pa prethodne demo izmjene mogu nastaviti da se koriste.

Pregled izvornog koda potvrđuje komentare uz svih 118 imenovanih funkcija i metoda. Automatski generisani fajlovi, zavisnosti i build rezultati nijesu ručno uređivani.
