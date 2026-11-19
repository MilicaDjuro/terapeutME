# Neon Free baza i Render Free API

Neon čuva PostgreSQL podatke, Render pokreće NestJS API, a Vercel frontend. Postojeći `pg` paket već podržava Neon vezu; ne instaliramo novi driver i ne premještamo kod autentifikacije u Neon.

## 1. Kreiranje baze

1. Otvorite [Neon Console](https://console.neon.tech) i napravite nalog.
2. Kreirajte novi projekat: ime `terapeut-me`, plan **Free**, cloud **AWS**, region **Frankfurt / eu-central-1** zbog Render API-ja u Frankfurtu.
3. Ako se traži PostgreSQL verzija, izaberite **17**, koja je provjerena i u našim lokalnim testovima. Podrazumijevani naziv baze, npr. `neondb`, može ostati.
4. Za sada koristite podrazumijevanu granu i vlasničku ulogu koju Neon napravi, kako bi migracije mogle kreirati tabele i ekstenzije. Naša aplikacija već ima JWT prijavu; Neon Auth nije potreban za ovaj korak.

## 2. Direktna veza

U projektu otvorite **Connect**, izaberite bazu i ulogu, pa **isključite Connection pooling**. Kopirajte običan PostgreSQL connection string, bez komande `psql` i bez navodnika. Primjer oblika, bez stvarnih pristupnih podataka:

```text
postgresql://USER:PASSWORD@ep-example.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

Zadržite sve TLS parametre koje Neon prikaže, uključujući `sslmode=require` i eventualni `channel_binding=require`. Host direktne veze nema `-pooler` u nazivu. Nemojte ručno prepravljati ili dekodirati lozinku iz dobijenog URL-a.

**Zašto direktna veza?** Migracije i email worker koriste session advisory lock. Neon pooler radi u transaction režimu i ne podržava session-level advisory lock, pa isti lock ne bi pouzdano ostao na našoj konekciji. Direktna veza i dalje koristi naš mali `pg.Pool`; ne isključujemo aplikacioni pool.

## 3. Povezivanje sa Renderom

U Render API servisu otvorite **Environment** i dodajte:

| Ključ             | Vrijednost                                    |
| ----------------- | --------------------------------------------- |
| `DATABASE_URL`    | Cijeli direktni Neon URL iz prethodnog koraka |
| `AUTH_EMAIL_MODE` | `disabled` dok se ne uključi Resend           |

`DATABASE_URL` je tajna i ide samo u Render API, ne u Vercel, javni kod ili `NEXT_PUBLIC_...` varijable. Ne šaljite je u chat ili screenshotu. Ostale obavezne vrijednosti (`AUTH_SECRET`, `WEB_ORIGINS`, `NODE_ENV`, `NODE_VERSION`) ostaju opisane u [deployment.md](deployment.md).

Podešavanja API-ja:

```text
Root Directory: prazno
Build Command: npm ci --include=dev && npm run build:api
Pre-Deploy Command: prazno
Start Command: npm run start:render
Health Check Path: /api/v1/health
Instance Type: Free
```

Prije deploy-a pushujte pripremljene izmjene. Ako koristite Blueprint, `render.yaml` sada traži Neon `DATABASE_URL` kao ručni unos; više ne kreira Render bazu.

## 4. Prvi start i provjera

Pri startu migrator automatski dodaje početnu šemu i migracije 002–014 u praznu bazu. Neon podržava naše `pgcrypto` i `btree_gist` ekstenzije. Ne morate ručno kopirati SQL u Neon editor. Migraciona greška prekida start API-ja i vidi se u Render logu.

Otvorite `https://VAS-API.onrender.com/api/v1/health`. Očekuje se `status: ok`, `database: connected` i privremeno `emailDelivery: disabled`. Prazan katalog je očekivan: deploy ne pokreće demo seed, a registracija čeka podešavanje Resend-a.

Ovo priprema novu praznu bazu. Ako već imate podatke u drugoj bazi, promjena URL-a ih ne kopira; potreban je zaseban backup/restore postupak.

## 5. Ograničenja besplatnog testiranja

Neon Free trenutno ima 1 GB prostora i 100 CU-hours po projektu mjesečno, bez probnog roka od 30 dana. Pratite potrošnju u Neon Console. Naš API periodično čita bazu zbog poslovnih pravila i pozadinskih poslova, pa Neon može ostati aktivan dok je API budan. Render Free se uspavljuje poslije 15 minuta bez dolaznih zahtjeva; tada naši timeri staju, a naredni zahtjev čeka buđenje. Ne očekujte podsjetnike ili drugu pozadinsku obradu u tačno vrijeme na ovom testnom hostingu.

Izvori: [Neon povezivanje](https://neon.com/docs/connect/connect-from-any-app), [direktne i pooled veze](https://neon.com/docs/connect/connection-pooling), [podržane ekstenzije](https://neon.com/docs/extensions/pg-extensions), [Free plan](https://neon.com/pricing).
