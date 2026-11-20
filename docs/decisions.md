# Terapeut.me — dogovor za početnu verziju

Posljednja izmjena: 20. novembar 2026.

19. novembar 2026: korisnik bira pripremu Amazon SES email dostave i planira Cloudflare R2 za fajlove. SES koristi HTTPS na Render Free; slanje ostaje isključeno dok ne budu spremni AWS nalog, DNS/identitet, ograničeni IAM ključ i povratno sanduče. DNS domena je trenutno povezan sa Base44, pa se dodaju samo novi provjereni zapisi bez promjene web adrese. R2 migracija fajlova je zaseban naredni posao.

## Obim

Katalog, javni profili, usluge, dostupnost, izbor termina, zahtjevi, privatne online seanse i osnovna administracija. Nema klinika, online plaćanja ni pretplata. Javni neverifikovani profili su dozvoljeni. Verifikaciju dodjeljuje isključivo admin.

20. novembar 2026: korisnik bira Daily i naš ekran za online seanse, uz moguć kasniji prelazak na AWS. Terapeut označava **uslugu** kao online pri kreiranju/uređivanju ili registraciji. Rezervacija zadržava tada dogovoreni način rada; stare seanse ostaju uživo. Poziv je za terapeuta i jednog klijenta iz potvrđene rezervacije, od 10 minuta prije početka do 10 minuta nakon završetka. Snimanje i transkripcija nijesu uključeni. Stalni termini kopiraju dogovor, a lista čekanja zahtijeva novu saglasnost pri promjeni načina rada. Daily nalog još nije kreiran: stvarni pozivi ostaju isključeni do serverske konfiguracije i provjere na dva uređaja. Tehnički tok i koraci naloga su u [online-sessions.md](online-sessions.md).

## Kalendar

Terapeut direktno uređuje sačuvani sedmični dan i sate, te radno vrijeme za konkretan datum u narednih 90 dana. Jedan poseban radni period ili neradni dan ima prednost nad sedmičnim rasporedom samo tog datuma. Pomjeranje ili uklanjanje posebnog rasporeda vraća prethodni datum na redovne sedmične sate. Promjene usluge i dostupnosti važe za nova zakazivanja; postojeće rezervacije zadržavaju tadašnje podatke i istoriju. Tip seanse određuje njen naziv; trajanje i opciona cijena uređuju se u istoj usluzi.

Terapeut unosi naziv, trajanje i opcionu cijenu svake vrste seanse. Trajanje je cijeli broj od **5 do 240 minuta**, uključujući 40 i 50 minuta; nije ograničeno na dvije vrijednosti. Klijent bira jednu od aktivnih seansi terapeuta, datum i slobodno vrijeme. Zauzeti početci ostaju vidljivi i onemogućeni za izbor. Radno vrijeme, zahtjevi i istorija čuvaju se u PostgreSQL-u. Poseban unos pauza i odsustava uklonjen je na zahtjev korisnika. Cijena koja nije unesena prikazuje se kao „Na upit“, bez zamjene nulom.

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

Terapeut može od potvrđene buduće seanse konkretnog klijenta napraviti stalni termin na 7 ili 14 dana, u istom lokalnom satu. Serija traje dok je terapeut ne zaustavi; server održava zasebne potvrđene rezervacije za narednih 90 dana. Pojedinačni predlog drugog vremena ili otkazivanje ne pomjera ostale seanse i ne dovodi do ponovnog stvaranja otkazanog termina. Prekid serije otkazuje buduće seanse uz potvrdu u prikazu; prošli ishodi i istorija ostaju. Konflikt početnog skupa vraća cijeli novi upis, dok se kasniji problematični datumi jasno prikazuju za ručnu zamjenu. Tehnički tok je u [recurring-bookings.md](recurring-bookings.md).

## Kontakt i ishodi

Analitika odvojeno prikazuje **trenutno stanje svih rezervacija** (svi zapisi, čekanje sada, potvrđeni i istorija), bez filtera perioda, i **radnje u izabranom periodu**. „Primljeni zahtjevi u periodu“ zadržavaju i obrađene/otkazane zahtjeve; ne predstavljaju broj zahtjeva koji trenutno čekaju odgovor. Potvrde u periodu takođe ostaju u istoriji poslije kasnijeg otkazivanja.

Svaki terapeut ima privatnu analitiku na `/dashboard/analytics` za 7, 30 ili 90 dana. Upiti znače zahtjeve za rezervaciju. Po zahtjevu korisnika broji se svako novo otvaranje/refresh, uključujući ponavljanja. Prikazuju se svi pregledi, različiti i ponovljeni posjetioci, novi/ranije poznati posjetioci, prosjek, maksimum, dnevni pregled i paginirana tabela po posjetiocu bez identiteta. Prijavljeni klijenti, neprijavljeni browseri, drugi nalozi i vlastiti pregledi su odvojeni. Anonimni browser prepoznaje se kolačićem na 30 dana; nije moguće pouzdano povezati istu anonimnu osobu na više browsera ili sa njenim kasnijim nalogom. Konverzija je udio različitih **klijenata** koji nakon pregleda pošalju zahtjev u istom periodu. Potvrde, otkazivanja, predlozi i prihvaćena pomjeranja računaju se iz istorije po datumu radnje; automatske seanse ulaze u prve potvrde, ali ne u nove upite. Stari dnevni minimum ostaje sačuvan, bez izmišljanja ranijih ponavljanja. Tok je u [profile-analytics.md](profile-analytics.md).

Terapeut dodjeljuje privatni domaći zadatak, vježbu, predložak dnevnika ili preporučeni materijal konkretnom klijentu sa potvrđenom/ranije održanom seansom. Podržani su tekst, http/https link, opcioni rok i PDF do 5 MB. Materijal i prilog dostupni su samo primaocu i terapeutu koji ga je dodijelio. Terapeut uređuje ili povlači materijal, uz zaštitu verzije; primalac postojećeg zapisa ostaje isti. Povlačenje zatvara dalji pristup, a arhivirani zapis ostaje u bazi. Tok je u [client-materials.md](client-materials.md).

Lista čekanja prihvata konkretan datum/sat ili izabrane dane i vremenski raspon u narednih 90 dana. Klijent izričito pristaje na jednu automatski potvrđenu seansu uz prikazano trajanje/cijenu. Prvi odgovarajući klijent po serverskom redosljedu prijave dobija oslobođeno vrijeme; obje strane dobijaju email i vide rezervaciju u aplikaciji. Promjena cijene/trajanja traži novu saglasnost. Povlačenje prijave ne otkazuje već dodijeljenu seansu. Tehnički tok je u [waitlist.md](waitlist.md).

Terapeut vidi ime i prezime, email i telefon klijenta. Detalji seanse se dogovaraju mimo platforme. Klijent dobija jasno objašnjenje prije slanja zahtjeva.

Terapeut označava završenu seansu ili nedolazak i može ispraviti oznaku. Posljednja oznaka predstavlja važeći ishod; istorija izmjena se čuva.

Zahtjev bez odgovora do početka seanse označava se „Bez odgovora terapeuta“ i prikazuje žutom bojom. Nije nedolazak klijenta. Prošli termin nije ponovo dostupan.

## Email i arhiva

Novi zahtjev šalje obavještenje terapeutu, a potvrda, odbijanje i predlog drugog vremena obavještenje klijentu. Odgovor klijenta na predlog i otkazivanje obavještavaju drugu stranu. Zahtjev, istorija i outbox događaj čuvaju se u istoj transakciji. Email se obrađuje naknadno uz ponovne pokušaje i provjeru najnovije verzije i primaoca. Raniji zahtjevi ne dobijaju retroaktivne poruke. Aplikacija ostaje izvor stanja; email samo obavještava i vodi u aplikaciju. Lokalni razvoj koristi Mailpit, a stvarna dostava isti Resend HTTPS ili SMTP servis kao registracija. Tok i ograničenja opisani su u [booking-notifications.md](booking-notifications.md).

Planiran je podsjetnik terapeutu u 08:00 na dan termina, po zoni Europe/Podgorica. Slanje mora biti preko trajnog outbox reda sa ključem protiv duplikata i ponovnom provjerom stanja prije slanja.

Pri brisanju naloga planiran je Excel izvoz povezanih podataka, dostavljanje adminu i čuvanje arhive. Demo već podržava lokalno preuzimanje Excel izvještaja; nema stvarnog brisanja naloga, arhiviranja na serveru ni email dostave arhive.

## Pretpostavke samo za demo

- Dostupnost se ponavlja sedmično; kalendar klijentu prikazuje narednih 90 dana.
- Naredna seansa može početi odmah po završetku prethodne.
- Seansa se može označiti završenom/nedolaskom nakon početka; precizno pravilo o vremenu označavanja ostaje za dogovor.
- Predlog B bez prihvatanja do početka dobija zaseban status „Bez odgovora klijenta“. Ovo je implementirana demo pretpostavka, još nije konačna produktna odluka.
- Zahtjevi ističu pri početku. Stvarni API provjerava rok pri čitanju/radnji i svakih 30 sekundi, uz trajnu istoriju. Odvojeni demo računa to u browseru.
- Probne uloge na `/demo/dashboard` su demo pregledi u istom browseru i ne utiču na stvarnu JWT prijavu ili serverske dozvole.

## Preostale odluke

- Podsjetnici za termine prije 08:00 i zahtjeve poslate nakon 08:00.
- Pravila prihvatanja i odbijanja predloga do početka termina.
- Automatsko prepoznavanje praznika i minimalno vrijeme do zakazivanja; ručni raspored po datumu je podržan.
- Arhiviranje profila/brisanje naloga sa budućim terminima.
- Sadržaj, mjesto, rok čuvanja i pristup izvozu pri brisanju naloga.
- Konačni dokumenti privatnosti i uslova korišćenja.

## Korisnički nalozi

Izgled aplikacije prati javni terapeut.me: Inter za tekst, Plus Jakarta Sans za naslove, tirkizna dugmad, svijetla zelenkasta pozadina, bijele kartice i blage animacije. Logo i dekorativna fotografija reference čuvaju se lokalno, kao i fontovi sa licencama. Postojeći tokovi, podaci i pravila ostaju isti. Mobilni prikaz i smanjeno kretanje su podržani; tehnički vodič je [appearance.md](appearance.md).

Klijent na `/account` prvo vidi svoje termine, sa terapeutom, vrstom seanse, punim datumom, vremenom, trajanjem, cijenom i statusom. Filteri odvajaju čekanje, potvrđene termine i istoriju; sljedeći budući potvrđeni termin je izdvojen. Javni profil terapeuta dostupan je iz kartice. Nedostupan javni katalog ne sakriva privatne rezervacije. Istorija dobija čitljive naslove događaja, bez izmjene originalnih zapisa. Uređivanje profila obje uloge razdvaja grupe ličnih i kontakt podataka, dok sve podatke i dalje čuva jednim zahtjevom. Tokom izmjene prikazuje se formular, a poslije uspjeha obnovljeni pregled.

Terapeut poslije prijave na `/dashboard` odmah vidi zahtjeve i termine. Kod obje uloge budući aktivni termini idu po datumu i satu od najbližeg, nezavisno od statusa zahtjeva. Iza njih su prošle seanse bez upisanog ishoda, pa istorija od najnovije. Filteri sa brojevima razdvajaju čekanje, potvrđene termine i istoriju. Datum u istoriji označava se prema radnji: predlog prikazuje „Prethodni termin“, prihvatanje „Prihvaćeni termin“. Usluge, sedmično radno vrijeme i posebni datumi nalaze se u odvojenim padajućim sekcijama. Sat i minut biraju se u 24-časovnom formatu, uz svaki minut dostupan za izbor. „Moj nalog“ u navigaciji otvara meni sa profilom i odjavom; odjava čeka potvrdu servera prije uklanjanja identiteta iz prikaza.

Korisničke mrežne radnje prikazuju spinner i opis čekanja. Tokom jednog upisa povezane kontrole su onemogućene; uspjeh se prikazuje tek nakon API potvrde, a greška ponovo omogućava pokušaj i zadržava unos. Automatsko osvježavanje kalendara ne prekida prikaz periodičnim spinnerom. Animacija poštuje podešavanje smanjenog kretanja u browseru.

Profil ima prepoznatljiv prikaz učitavanja. Potvrda čuvanja je kratka zelena poruka sa ikonom uz odgovarajući formular i automatski nestaje poslije četiri sekunde. Nova izmjena uklanja prethodnu potvrdu. Raspored ima i zajedničku potvrdu vidljivu tokom skrolovanja. Greške ostaju vidljive do ispravke ili nove radnje; čekanje traje do završetka zahtjeva.

Editor seansi i dostupnosti prikazuje samo jednu potvrdu uspjeha iznad svojih formulara: „Seansa je sačuvana.“ za izmjenu usluge, a „Raspored je sačuvan.“ za izmjenu sedmičnih sati ili datuma. Lokalni formulari ne dupliraju tu potvrdu; zadržavaju poruke greške uz unos.

Zaboravljena lozinka obnavlja se email linkom sa JWT-om za posebnu namjenu, rokom od 15 minuta i jednokratnim korišćenjem. Obje uloge unose novu lozinku i potvrdu; server čuva scrypt hash, poništava stare sesije i prijavljuje korisnika novim JWT kolačićem prema postojećoj ulozi. Zahtjev za link ne otkriva postoji li email. Nova lozinka ima isto pravilo dužine kao registracija. Slanje koristi postojeći lokalni Mailpit ili konfigurisan SMTP.

Klijent i terapeut uređuju ime, prezime, datum rođenja, telefon, grad i adresu kroz jedno „Uredi profil“ na `/account`. Klijentov kontakt je opcioni i privatan. Terapeut u istom formularu uređuje zvanje i biografiju; njegov telefon i grad su obavezni, a adresa ordinacije opciona. Sva polja čuvaju se jednom transakcijom; javni profil terapeuta prati nove podatke i nakon ponovne prijave. Ranije rezervacije zadržavaju tada zabilježene podatke i istoriju. Email za prijavu ostaje potvrđena adresa; izmjena emaila i lozinke nije dio ovog formulara.

Javni katalog, usluge/dostupnost i fotografije čitaju se iz PostgreSQL-a. Četiri prethodna izmišljena profila uvoze se sa stabilnim oznakama, a novoregistrovani terapeuti prikazuju se u istom katalogu. Prijava koristi potpisani JWT u HttpOnly kolačiću uz aktivnu sesiju u bazi. Pacijent nakon prijave otvara sve javne terapeute na `/psychotherapy`, a terapeut vlastiti radni prostor na `/dashboard` i uređuje profesionalne podatke/fotografije na `/account`. Profil, raspored, zahtjevi i istorija koriste bazu i serverske provjere vlasništva. Demo dashboard i demo zakazivanje ostaju odvojeni i lokalni na `/demo/...`.

Za lokalne terapeutske naloge korisnik je izričito zatražio testnu lozinku `Test123`, uključujući novoregistrovani profil. To je razvojni uvoz/reset; javna registracija i dalje zahtijeva dugu lozinku. Svaki terapeut može dodati do osam svojih JPEG/PNG/WebP fotografija, izabrati profilnu i obrisati svoje slike. Uloga i vlasništvo provjeravaju se na serveru; slike se normalizuju i čuvaju u bazi.

Registracija traži ime, prezime, email, datum rođenja i lozinku u prvom koraku. Klik na „Dalje” šalje četvorocifreni kod na email. Nalog nastaje tek nakon tačnog koda. Prijava koristi email i lozinku. Podaci naloga i sesije čuvaju se u PostgreSQL-u. Novi terapeut dobija seansu koju unese i sam unosi radno vrijeme. Stare rezervacije zadržavaju kopiju cijene i trajanja. Stvarne rezervacije su odvojene od demo zahtjeva; tehnički tok i debugging su u [scheduling.md](scheduling.md).

Obična registracija dodjeljuje ulogu `CLIENT`. Posebna registracija na `/register/therapist` kreira `THERAPIST` nalog, profesionalni profil i početnu uslugu u jednoj transakciji nakon email potvrde. Terapeut unosi stručno zvanje, biografiju do 400 znakova, grad, telefon, opcionu adresu i naziv/trajanje/opcionu cijenu seanse. Prazna cijena ostaje „Na upit”. Profesionalni profil počinje neverifikovan; verifikaciju dodjeljuje admin. Javna registracija ne omogućava `ADMIN` ulogu. Demo pregled uloga ostaje odvojen od stvarnih naloga.

Implementacioni rokovi su 10 minuta za kod, pet pogrešnih pokušaja, 60 sekundi do ponovnog slanja i sedam dana za sesiju. Ponovno slanje ne resetuje greške. Za lokalno testiranje koristi se Mailpit; stvarna dostava zahtijeva Resend HTTPS ili konfigurisan SMTP i verifikovan domen. Podešavanja su u [auth.md](auth.md).

Korisnik je izabrao Render Free za početno testiranje i naknadno uključivanje Resend-a. Migracije se izvršavaju prije API-ja pri startu, uz zaključavanje i preskakanje evidentiranih koraka. Dok email nije uključen (`AUTH_EMAIL_MODE=disabled`), nova registracija i zahtjev za reset su onemogućeni; potvrda emaila se ne zaobilazi, a booking outbox ostaje sačuvan. Render Free API može spavati, pa pozadinski poslovi čekaju buđenje. Korisnik je zatim prihvatio Neon Free za PostgreSQL: nema Render baze sa rokom od 30 dana, ali važe Neon ograničenja potrošnje. Koristi se direktna TLS veza zbog session lock-ova. Koraci i ograničenja su u [deployment.md](deployment.md).
