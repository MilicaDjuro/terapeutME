# Provjera početne verzije

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
