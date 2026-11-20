# Privatne bilješke terapeuta

Terapeut otvara **Privatne bilješke** iz svog pregleda, menija „Moj nalog“ ili direktnog linka na kartici klijentovog termina. Stranica je `/dashboard/notes`; opcioni `?client=ID` unaprijed bira klijenta samo ako pripada tom terapeutu.

## Šta korisnik može

1. Izabrati jednog od svojih klijenata koji ima zahtjev ili termin kod njega. Klijenti sa otkazanim terminom ostaju dostupni za vlastite bilješke. Ovo nije globalni imenik svih pacijenata.
2. Dodati više bilješki, sa naslovom do 160 i tekstom do 20000 znakova. Datum nastanka i posljednje izmjene upisuje server.
3. Urediti vlastitu bilješku. Klijent postojeće bilješke se ne mijenja. Izbor klijenta je zaključan dok je otvoren formular, da unos ne ode pogrešnoj osobi.
4. Arhivirati bilješku poslije potvrde. Ona nestaje iz aktivnog pregleda; zapis ostaje u bazi. Arhiviranje nije trajno brisanje.

**Samo autor ima pristup kroz aplikaciju.** Klijent, drugi terapeut istog klijenta i admin uloga ne mogu čitati, mijenjati ili arhivirati tuđu bilješku preko API-ja. Bilješke nijesu domaći zadaci, ne šalju se emailom i ne pojavljuju se u javnom profilu, rezervacijama ili klijentovom pregledu materijala.

## Tok podataka i debugging

- `db/migrations/015-therapist-notes.sql` dodaje `therapist_client_notes`, vezu sa terapeutom i klijentom, tekst, verziju i datume. Postojeće rezervacije i materijali se ne mijenjaju. Primjena: `npm.cmd run db:migrate`; Render start koristi postojeći tok migracije prije API-ja.
- `apps/api/src/notes/therapist-notes.controller.ts` izlaže `GET /therapist-notes/clients`, `GET /therapist-notes?clientId=...`, `POST /therapist-notes`, `POST /therapist-notes/:id/update` i `POST /therapist-notes/:id/archive`, sa zajedničkim prefiksom `/api/v1`. Odgovori su `private, no-store`; promjene prolaze postojeću provjeru Origin/JSON zaglavlja.
- `TherapistNotesService.owner` čita JWT nalog i pronalazi profil preko `linked_user_id`. Nijedna radnja ne prihvata terapeutski ID kao ovlašćenje. `requireClient` dokazuje vezu rezervacijom. Upit za bilješke uvijek sadrži terapeutski ID vlasnika.
- `save` otvara transakciju, zaključava profil pa postojeću bilješku i poredi `version`. Dva taba ne mogu uspješno upisati istu staru verziju. `COMMIT` prethodi potvrdi uspjeha; greška vraća `ROLLBACK`. Naslov/tekst i NUL kontrolni znak provjeravaju se prije SQL upisa. `archive` koristi atomski uslov verzije.
- `apps/api/src/main.ts` zadržava limit 16 KB za ostale JSON formulare, a za bilješke dozvoljava 128 KB da 20000 znakova stane i u UTF-8/JSON zapisu.
- `packages/domain/src/types.ts` dijeli tipove `TherapistClientNote` i `TherapistNoteClient`. `apps/web/src/lib/therapist-notes-client.ts` šalje postojeći HttpOnly JWT; tekst nije u URL-u ili `localStorage`.
- `apps/web/src/features/therapist-notes.tsx` čeka provjeru naloga, učitava listu vlastitih klijenata, a zatim samo bilješke izabranog klijenta. Promjena izbora/odjava prekida staro učitavanje. Bilješke se prikazuju kao običan tekst, bez izvršavanja HTML-a. Nema automatskog prepisivanja otvorenog formulara.
- `handleSave` i `handleArchive` blokiraju dupli klik i čekaju potvrdu API-ja. Potvrda uspjeha nestaje poslije četiri sekunde. Greška čuvanja zadržava naslov i tekst. Kod konflikta sačuvajte svoj unos, zatvorite formular i osvježite bilješke da otvorite noviju verziju. Ručno osvježavanje ne vraća klijenta iz početnog URL-a nakon što je terapeut izabrao drugog.

Za breakpoint počnite od `handleSave`, zatim HTTP kontrolera i `save` neposredno prije provjere vlasništva/verzije i `COMMIT`-a. Ne dodajte sadržaj bilješke u logove. Provjere su u `apps/api/test/therapist-notes.test.ts` i `tests/auth-e2e/therapist-notes.spec.ts`, sa sintetičkim bilješkama i izolovanim testnim šemama.
