# Vercel frontend i Render API

Frontend (`apps/web`) ide na Vercel. NestJS API i PostgreSQL idu na Render, u isti region. Sve komande u nastavku su za Render/Vercel Linux okruženje; lokalno na Windowsu koristite `npm.cmd`.

```text
Browser → https://vas-sajt.vercel.app/api/v1/...
        → Vercel rewrite → https://vas-api.onrender.com/api/v1/...
                       → Render PostgreSQL (interna veza)
```

Browser koristi relativne `/api/v1` adrese. `API_ORIGIN` je serversko odredište proxy-ja, bez `/api/v1` i završne kose crte. JWT ostaje u HttpOnly kolačiću na frontend domenu. Ne treba `NEXT_PUBLIC_API_URL` niti promjena na `SameSite=None`.

## 1. Priprema

- Sačuvajte izmjene u Git repozitorijum koji mogu čitati oba servisa.
- Izaberite Node.js **22.x** na Vercelu; `render.yaml` takođe koristi granu 22.
- Odredite stabilnu adresu frontenda, npr. dodijeljeni `https://vas-sajt.vercel.app`. Kasnije možete dodati vlastiti domen.
- Pripremite SMTP servis i verifikovan domen pošiljaoca. Postojeći kod podržava SMTP; primjer za Resend je u [auth.md](auth.md).
- Ako nadograđujete postojeću produkcionu bazu, napravite backup prije migracija.

Predloženi `render.yaml` koristi **plaćeni API `starter` i bazu `basic-256mb`**. Provjerite cijene i planove u Renderu prije primjene. Free API blokira SMTP portove 465/587 i uspavljuje se; to prekida postojeću dostavu emaila i odlaže pozadinsku obradu. Free PostgreSQL ističe nakon 30 dana. Za izabrani SMTP tok ovaj Blueprint zato koristi plaćene instance. Sam fajl ne kreira resurse.

## 2. Render: novi projekat

U Renderu otvorite **New → Blueprint**, povežite repo i izaberite `render.yaml`. Provjerite predložene resurse prije kreiranja.

Blueprint povezuje bazu sa API-jem preko interne `DATABASE_URL`, generiše `AUTH_SECRET` i traži vrijednosti označene sa `sync: false`:

| Varijabla     | Vrijednost                                                       |
| ------------- | ---------------------------------------------------------------- |
| `WEB_ORIGINS` | Tačna HTTPS adresa frontenda, npr. `https://vas-sajt.vercel.app` |
| `SMTP_HOST`   | Host vašeg SMTP servisa, npr. `smtp.resend.com`                  |
| `SMTP_FROM`   | Npr. `Terapeut.me <noreply@vas-verifikovani-domen.me>`           |
| `SMTP_USER`   | SMTP korisnik; za Resend `resend`                                |
| `SMTP_PASS`   | SMTP lozinka/API ključ, samo u Render Environment podešavanjima  |

Podrazumijevani SMTP je port **465**, `SMTP_SECURE=true`. Ako provajder traži STARTTLS na 587, postavite `SMTP_PORT=587` i `SMTP_SECURE=false`. `AUTH_EMAIL_MODE=smtp` ostaje uključen.

`WEB_ORIGINS` nema putanju ni završnu kosu crtu. Više adresa odvaja se zarezom; prva je glavni domen za linkove u booking emailovima. Dodajte samo konkretne adrese koje kontrolišete. Zaštita od CSRF-a provjerava ovu listu za svaki upis, uključujući login.

Render automatski zadaje `PORT`; API ga koristi i sluša na `0.0.0.0`. Nije potrebno ručno postaviti `API_PORT`. Baza ima `ipAllowList: []`, pa joj API pristupa internom mrežom. Fotografije, PDF materijali, istorija i outbox čuvaju se u bazi; aplikaciji nije potreban persistent disk.

## 3. Render: postojeći servis

Za postojeći API i bazu podesite servis ručno umjesto kreiranja duplikata iz Blueprint-a:

| Podešavanje        | Vrijednost                                                          |
| ------------------ | ------------------------------------------------------------------- |
| Runtime            | Node                                                                |
| Root Directory     | Prazno, korijen repozitorijuma                                      |
| Build Command      | `npm ci --include=dev && npm run build:api`                         |
| Pre-Deploy Command | `node apps/api/dist/migrate.js`                                     |
| Start Command      | `npm run start:api`                                                 |
| Health Check Path  | `/api/v1/health`                                                    |
| `NODE_VERSION`     | `22`                                                                |
| `NODE_ENV`         | `production`                                                        |
| `API_HOST`         | `0.0.0.0`                                                           |
| `DATABASE_URL`     | Interna adresa postojeće Render baze u istom regionu                |
| `AUTH_SECRET`      | Postojeći tajni ključ ili novi nasumični ključ od najmanje 32 znaka |

Dodajte i sve email/frontend varijable iz prethodnog odjeljka. Promjena postojećeg `AUTH_SECRET` poništava prijave i ranije izdate linkove/kodove.

## 4. Migracije

`preDeployCommand` se izvršava poslije build-a, prije pokretanja nove verzije. Zahtijeva plaćeni web servis. Migracije se ne izvršavaju pri svakom običnom restartu API-ja niti u Vercel build-u.

`migrate.ts` prvo provjerava ima li tabela u trenutnoj šemi. Samo praznoj šemi dodaje `db/schema.sql`, zatim izvršava neevidentirane migracije 002–014. Postojeću bazu nadograđuje bez reseta; već evidentirane korake preskače. Djelimično pripremljena šema nije prazna i traži provjeru uzroka greške, bez automatskog brisanja tabela. Ne pokrećite dvije migracione komande istovremeno.

Produkcioni deploy **ne pokreće `db:seed`**. Ta komanda uvozi izmišljene profile i razvojne naloge; nije korak pripreme javne baze. Prazan katalog poslije prvog deploy-a je očekivan dok se ne registruju terapeuti.

Ako migracija ne uspije, provjerite pre-deploy log i vezu sa bazom. Ne brišite bazu ili migracionu evidenciju da biste zaobišli grešku. Health provjera zahtijeva svih 13 dodatnih migracija i vraća 503 ako baza nije spremna.

## 5. Vercel

Uvezite isti Git repozitorijum i podesite:

| Podešavanje                                                          | Vrijednost                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Framework Preset                                                     | Next.js                                                                       |
| Root Directory                                                       | `apps/web`                                                                    |
| Include source files outside of the Root Directory in the Build Step | Uključeno, zbog `packages/domain` i root lock fajla                           |
| Node.js Version                                                      | `22.x`                                                                        |
| Output Directory                                                     | Podrazumijevana Next.js vrijednost; bez ručnog override-a                     |
| `API_ORIGIN`                                                         | Stvarna javna HTTPS adresa Render API-ja, npr. `https://vas-api.onrender.com` |

`apps/web/vercel.json` već zadaje instalaciju `cd ../.. && npm ci --include=dev` i build `cd ../.. && npm run build:web`. Tako se prvo gradi zajednički paket, pa samo frontend. Vercel ne pokreće NestJS ni migracije. Uklonite stare komandne override vrijednosti ako su drugačije.

Postavite `API_ORIGIN` prije prvog build-a. Rewrite odredište nastaje tokom build-a, pa promjena ove varijable zahtijeva novi deploy. Na Vercelu ne unosite `DATABASE_URL`, `AUTH_SECRET` ili SMTP tajne.

Za Preview koristite zaseban testni API i bazu, uz izričito dozvoljenu stabilnu preview adresu u njihovom `WEB_ORIGINS`. Ne povezujte proizvoljne preview deploy-e sa produkcionim podacima. Nedostajući `API_ORIGIN` na Vercelu namjerno prekida build umjesto pravljenja proxy-ja ka localhostu.

## 6. Provjera poslije deploy-a

1. Otvorite `https://vas-api.onrender.com/api/v1/health`: očekuje se `status: ok`, `database: connected`.
2. Otvorite `https://vas-sajt.vercel.app/api/v1/health`: isti rezultat potvrđuje Vercel rewrite.
3. Registrujte testni nalog preko frontenda i provjerite stvarnu isporuku email koda. Provjerite login, refresh stranice, odjavu i obnovu lozinke.
4. Registrujte terapeuta, unesite raspored i fotografiju. Sa drugim nalogom pošaljite zahtjev, potvrdite ga i provjerite da zauzeti interval više nije dostupan.
5. Provjerite oba primaoca email obavještenja i da linkovi otvaraju glavni frontend domen. Provjerite i upload/preuzimanje PDF materijala kroz frontend proxy.
6. Ponovo deploy-ujte API i provjerite da nalozi, fotografije, rezervacije i istorija ostaju sačuvani.

`403` pri loginu najčešće znači da frontend origin nije u `WEB_ORIGINS`. `502` kroz Vercel upućuje na pogrešan `API_ORIGIN`, nedostupan API ili neuspio Render deploy. HTTP 503 na health provjeri znači da baza ili migracije nijesu spremne. Za SMTP grešku provjerite plan, port, kredencijale i verifikovani domen.

Trenutno ograničenje autentifikacije: pokušaji se ograničavaju po socket adresi. Iza proxy-ja više korisnika može dijeliti taj limit; prije većeg javnog opterećenja potrebno je zasebno urediti pouzdano prepoznavanje klijentske IP adrese. Ne uključujte nekritički povjerenje u sva proslijeđena IP zaglavlja.

## Izvori

- [Render web services i vezivanje porta](https://render.com/docs/web-services#port-binding)
- [Render Blueprint konfiguracija](https://render.com/docs/blueprint-spec)
- [Render Free ograničenja](https://render.com/docs/free)
- [Render PostgreSQL povezivanje](https://render.com/docs/postgresql-creating-connecting)
- [Vercel monorepo podešavanja](https://vercel.com/docs/monorepos/monorepo-faq)
