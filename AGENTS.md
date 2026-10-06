# Pravila održavanja Terapeut.me

Korisnik traži kod koji može razumjeti i održavati početnik u Next.js i NestJS.

- Prvo pročitaj `docs/maintaining.md` i prihvaćena pravila u `docs/decisions.md`.
- Piši jasne imenovane funkcije i puna imena promjenljivih. Prednost imaju obične petlje i `if` grane.
- Svaka imenovana funkcija i komponenta treba da ima kratak komentar na crnogorskom/srpskom latinicom: šta radi i važno ograničenje, ako ga ima.
- Objasni lifecycle radnje, čuvanje podataka i poslovne korake tamo gdje se izvršavaju.
- Duge akcije ne pisati unutar JSX događaja; izvuci ih iznad prikaza kao `handle...` funkcije.
- Ne uvoditi složene generičke pomoćne funkcije, višeslojne obrasce ili biblioteku bez konkretne potrebe.
- Razdvajaj vidljivo različite odgovornosti: prikaz, računanje termina, čuvanje i izvoz. Ne dijeli svaku malu funkciju u poseban fajl.
- Sačuvaj tipove, provjere preklapanja i istoriju. Nikad ne pojednostavljuj uklanjanjem poslovnih pravila.
- Demo uloge i `localStorage` nijesu produkciona autentifikacija ili pouzdana serverska rezervacija.
- Kada se dodaje produkcioni API, provjera uloge i vlasništva mora biti na serveru.
- Provjere za izmijenjeno ponašanje: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build` i relevantni browser testovi. Pokreni `npm.cmd run format:check`.
- Ažuriraj vodič kada se promijene važni fajlovi ili tok podataka. Ne uređuj generisani kod i sadržaj `node_modules`.
