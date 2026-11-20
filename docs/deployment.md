# Vercel frontend i Render Free API

Frontend (`apps/web`) ide na Vercel. NestJS API ide na Render Free, a PostgreSQL na Neon Free. Izaberite Frankfurt za oba servisa. Sve komande u nastavku su za Render/Vercel Linux okruženje; lokalno na Windowsu koristite `npm.cmd`.

```text
Browser → https://vas-sajt.vercel.app/api/v1/...
        → Vercel rewrite → https://vas-api.onrender.com/api/v1/...
                       → Neon PostgreSQL (TLS veza)
```

Browser koristi relativne `/api/v1` adrese. `API_ORIGIN` je serversko odredište proxy-ja, bez `/api/v1` i završne kose crte. JWT ostaje u HttpOnly kolačiću na frontend domenu. Ne treba `NEXT_PUBLIC_API_URL` niti promjena na `SameSite=None`.

## 1. Priprema

- Sačuvajte i pushujte pripremljene izmjene na Git granu povezanu sa hostingom.
- Izaberite Node.js **22.x** na Vercelu; `render.yaml` takođe koristi granu 22.
- Odredite stabilnu HTTPS adresu frontenda, npr. `https://vas-sajt.vercel.app`.
- Email može ostati isključen dok ne pripremite Resend domen i ključ. Potvrda emaila se ne zaobilazi.
- Ako nadograđujete postojeću bazu, napravite backup prije migracija.

`render.yaml` koristi **Render Free API i zasebnu Neon Free bazu**. Free API se uspavljuje nakon 15 minuta bez dolaznih zahtjeva; prvi naredni zahtjev čeka buđenje. Dok servis spava, obrada email reda, dopuna stalnih termina i ostali timeri čekaju naredno pokretanje. Nema garancije dostave u tačno zakazano vrijeme.

Neon Free nema probni rok od 30 dana, ali ima ograničenja prostora i mjesečne potrošnje. Pratite ih u Neon Console. Blueprint više ne kreira Render bazu: traži direktni Neon URL kao tajnu varijablu. Detaljni koraci su u [neon.md](neon.md).

## 2. Neon baza i Render API

Prvo napravite Neon Free projekat, PostgreSQL 17, AWS Frankfurt. U Connect dijalogu isključite **Connection pooling** i kopirajte direktnu vezu sa TLS parametrima. Unesite je samo u Render `DATABASE_URL`. Naši session lock-ovi zahtijevaju direktnu vezu; host ne smije sadržati `-pooler`. Koraci su u [neon.md](neon.md).

Za API izaberite **New → Web Service**, isti Git repo i sljedeća podešavanja:

| Podešavanje        | Vrijednost                                    |
| ------------------ | --------------------------------------------- |
| Name               | `terapeut-api`                                |
| Runtime            | Node                                          |
| Branch             | Vaša objavljena grana, najčešće `main`        |
| Region             | Frankfurt, isti kao baza                      |
| Root Directory     | Prazno, korijen repozitorijuma                |
| Instance Type      | Free                                          |
| Build Command      | `npm ci --include=dev && npm run build:api`   |
| Pre-Deploy Command | Prazno; ovo polje nije dostupno na Free planu |
| Start Command      | `npm run start:render`                        |
| Health Check Path  | `/api/v1/health`                              |

Obavezne environment varijable:

| Varijabla         | Vrijednost                                 |
| ----------------- | ------------------------------------------ |
| `NODE_VERSION`    | `22`                                       |
| `NODE_ENV`        | `production`                               |
| `API_HOST`        | `0.0.0.0`                                  |
| `DATABASE_URL`    | Direktna Neon veza sa TLS-om               |
| `AUTH_SECRET`     | Nasumični tajni ključ od najmanje 32 znaka |
| `WEB_ORIGINS`     | Tačna HTTPS adresa frontenda               |
| `AUTH_EMAIL_MODE` | `disabled` dok email ne bude spreman       |

Ključ generišite lokalno: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Vrijednost unesite samo u Render Environment. Promjena postojećeg ključa poništava prijave i ranije izdate linkove/kodove.

Druga mogućnost je **New → Blueprint** i izbor `render.yaml`: traži `DATABASE_URL` iz Neon-a i `WEB_ORIGINS`, a generiše `AUTH_SECRET`. Za već kreirane resurse podešavanja promijenite ručno, bez kreiranja duplikata.

`WEB_ORIGINS` nema putanju ni završnu kosu crtu. Više adresa odvaja se zarezom; prva je glavni domen za booking email linkove. Dodajte samo konkretne adrese koje kontrolišete. Zaštita od CSRF-a provjerava ovu listu i pri loginu.

Render automatski zadaje `PORT`; API ga koristi i sluša na `0.0.0.0`. API pristupa Neon-u preko TLS veze; Render podešavanja za internu bazu i `ipAllowList` ovdje se ne koriste. Fotografije, PDF materijali, istorija i outbox su u bazi; persistent disk nije potreban.

## 3. Naknadno uključivanje emaila

Za Amazon SES koristite `AUTH_EMAIL_MODE=ses`, `AWS_REGION`, ograničene IAM ključeve, `SES_FROM` i potvrđeni `SES_FEEDBACK_EMAIL`. Nalog, domen koji može ostati na Base44, IAM politika i sandbox provjera opisani su u [aws-ses.md](aws-ses.md). SES podrška mora prvo biti deploy-ovana. Povratne bounce/complaint poruke se prate u podešenom sandučetu; aplikacija nema automatski SNS webhook.

Free blokira uobičajene SMTP portove. Resend zato koristimo preko **HTTPS API-ja**, bez dodatne biblioteke i bez SMTP podešavanja. Kada verifikujete domen i pripremite ključ, promijenite:

```dotenv
AUTH_EMAIL_MODE=resend
RESEND_API_KEY=vas-Resend-kljuc
RESEND_FROM=Terapeut.me <noreply@vas-verifikovani-domen.me>
```

Ponovo deploy-ujte/restartujte API poslije unosa. Ključ i adresa pošiljaoca pripadaju samo API-ju. Vodič za verifikaciju domena je u [auth.md](auth.md).

Dok je režim `disabled`, katalog i prijava postojećih naloga mogu raditi, ali registracija, ponovno slanje koda i zahtjev za reset lozinke vraćaju jasnu poruku da email još nije uključen. Kodovi i linkovi se ne vraćaju u JSON-u niti upisuju u logove. Nema kreiranja naloga bez potvrde emaila. Booking događaji ostaju u outbox-u bez lažnog `sent_at` i bez trošenja retry pokušaja. Nakon uključivanja Resend-a worker ponovo provjerava aktuelnu verziju i primaoca.

Lokalni `AUTH_EMAIL_MODE=local` i Mailpit ostaju za razvoj i browser testove. Režim `smtp` ostaje podržan za okruženja koja dozvoljavaju SMTP.

## 4. Migracije pri startu

`npm run start:render` izvršava `node apps/api/dist/migrate.js && npm run start:api`. Migraciona greška zaustavlja start; API ne kreće sa neispravnom šemom. Običan lokalni `start:api` ne pokreće migracije.

`migrate.ts` drži jednu PostgreSQL konekciju i session advisory lock za trenutnu šemu, tako da konkurentni startovi sačekaju isti lock. Po zatvaranju konekcije lock se oslobađa i poslije greške. Samo praznoj šemi dodaje `db/schema.sql`, zatim izvršava neevidentirane migracije 002–014. Evidentirane migracije preskače pri narednom restartu. Podaci i istorija se ne brišu.

Deploy **ne pokreće `db:seed`**: ta komanda uvozi izmišljene profile i razvojne naloge. Prazan katalog je očekivan dok se terapeuti ne registruju poslije uključivanja emaila.

Ako migracija ne uspije, provjerite start log i vezu sa bazom. Djelimično pripremljena šema nije prazna i ne resetuje se automatski. Ne brišite bazu ili migracionu evidenciju da biste zaobišli grešku. Health zahtijeva svih 13 dodatnih migracija; `emailDelivery: disabled` jasno pokazuje privremeno isključenu dostavu.

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

Postavite `API_ORIGIN` prije prvog build-a. Rewrite odredište nastaje tokom build-a, pa promjena ove varijable zahtijeva novi deploy. Na Vercelu ne unosite `DATABASE_URL`, `AUTH_SECRET` ili email tajne.

Za Preview koristite zaseban testni API i bazu, uz izričito dozvoljenu stabilnu preview adresu u njihovom `WEB_ORIGINS`. Ne povezujte proizvoljne preview deploy-e sa produkcionim podacima. Nedostajući `API_ORIGIN` na Vercelu namjerno prekida build umjesto pravljenja proxy-ja ka localhostu.

## 6. Provjera poslije deploy-a

1. Otvorite `https://vas-api.onrender.com/api/v1/health`: očekuje se `status: ok`, `database: connected`.
2. Otvorite `https://vas-sajt.vercel.app/api/v1/health`: isti rezultat potvrđuje Vercel rewrite.
3. Registrujte testni nalog preko frontenda i provjerite stvarnu isporuku email koda. Provjerite login, refresh stranice, odjavu i obnovu lozinke.
4. Registrujte terapeuta, unesite raspored i fotografiju. Sa drugim nalogom pošaljite zahtjev, potvrdite ga i provjerite da zauzeti interval više nije dostupan.
5. Provjerite oba primaoca email obavještenja i da linkovi otvaraju glavni frontend domen. Provjerite i upload/preuzimanje PDF materijala kroz frontend proxy.
6. Ponovo deploy-ujte API i provjerite da nalozi, fotografije, rezervacije i istorija ostaju sačuvani.

`403` pri loginu najčešće znači da frontend origin nije u `WEB_ORIGINS`. `502` kroz Vercel upućuje na pogrešan `API_ORIGIN`, nedostupan API ili neuspio Render deploy. HTTP 503 na health provjeri znači da baza ili migracije nijesu spremne. Za Resend grešku provjerite AUTH_EMAIL_MODE, API ključ i verifikovani domen; SMTP portovi nijesu potrebni na Free planu.

Trenutno ograničenje autentifikacije: pokušaji se ograničavaju po socket adresi. Iza proxy-ja više korisnika može dijeliti taj limit; prije većeg javnog opterećenja potrebno je zasebno urediti pouzdano prepoznavanje klijentske IP adrese. Ne uključujte nekritički povjerenje u sva proslijeđena IP zaglavlja.

## Izvori

- [Render web services i vezivanje porta](https://render.com/docs/web-services#port-binding)
- [Render Blueprint konfiguracija](https://render.com/docs/blueprint-spec)
- [Render Free ograničenja](https://render.com/docs/free)
- [Neon povezivanje](https://neon.com/docs/connect/connect-from-any-app)
- [Neon direktne i pooled veze](https://neon.com/docs/connect/connection-pooling)
- [Vercel monorepo podešavanja](https://vercel.com/docs/monorepos/monorepo-faq)
