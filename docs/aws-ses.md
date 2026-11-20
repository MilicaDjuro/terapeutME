# Amazon SES za Terapeut.me

SES šalje registracione kodove, reset linkove i booking obavještenja preko HTTPS API-ja. Vercel, Render i Neon ostaju postojeći servisi. R2 je zaseban Cloudflare servis; ovaj vodič ne premješta fajlove u R2.

## Nalog i region

Otvorite [AWS registraciju](https://aws.amazon.com/free/) i završite provjere emaila, identiteta i načina plaćanja. Ako se nudi podrška, dovoljna je besplatna Basic podrška. Free account plan završava se poslije šest mjeseci ili potrošnje kredita; za trajni rad kasnije pređite na Paid account plan sa naplatom po potrošnji. AWS account plan i SES Essentials/à la carte cijene nijesu ista stvar. Provjerite prikazanu ponudu prije potvrde.

Uključite MFA za administratorski pristup. Za aplikaciju napravite poseban IAM korisnik; root pristupni ključevi nijesu potrebni. U Billing podesite obavještenje o trošku, npr. na 5 USD mjesečno. Budžetsko obavještenje samo po sebi ne zaustavlja naplatu.

Izaberite **Europe (Frankfurt), eu-central-1**, pa otvorite **Amazon Simple Email Service**. Identiteti, sandbox i kvote pripadaju regionu; naredne korake radite u istom regionu.

## Domen može ostati na Base44

SES potvrđuje domen dodavanjem zasebnih DNS zapisa. Postojeći Base44 A/CNAME zapisi za web i MX zapisi za sanduče ostaju važeći. Ne mijenjaju se nameserveri. Prije dodavanja provjerite nazive zapisa da ne prepišu postojeći servis.

Primjer je slobodan poddomen `mail.terapeut.me` i pošiljalac `obavjestenja@mail.terapeut.me`. Možete koristiti drugi svoj domen; on će biti vidljiv u adresi pošiljaoca.

U **Configuration → Identities → Create identity** izaberite **Domain**, unesite domen/poddomen, uključite **Easy DKIM**, **2048-bit** i potpisivanje. Sačuvajte identitet i kopirajte tačno dobijene CNAME zapise kod DNS provajdera. Na Cloudflare DNS-u DKIM CNAME zapisi treba da budu **DNS only**, bez proxy-ja. Sačekajte **Verified/Successful**; AWS navodi do 72 sata za DNS potvrdu.

Ne dodajte drugi SPF TXT na istom nazivu i ne mijenjajte root MX. Za eventualni **Custom MAIL FROM** izaberite zaseban slobodan poddomen, npr. `bounce.mail.terapeut.me`, i stavite na njega tačno MX/TXT zapise koje SES prikaže. DMARC uskladite sa postojećim pravilima.

## Povratno sanduče i sandbox

U **Identities → Create identity → Email address** dodajte adresu koju stvarno čitate i kliknite link potvrde. Ona služi kao `SES_FEEDBACK_EMAIL`. Noreply adresa bez sandučeta nije odgovarajuća. Povratno sanduče i pošiljalac moraju biti verifikovani SES identiteti u istom regionu.

Sandbox prihvata samo potvrđene primaoce ili SES mailbox simulator, najviše 200 poruka u 24 sata i jednu u sekundi. Dodajte i svoju testnu adresu kao email identitet. DEMO adrese `@example.test` nijesu stvarna sandučad.

Na identitetu ostavite uključeno prosljeđivanje povratnih obavještenja. U **Suppression list** provjerite **BOUNCE** i **COMPLAINT** zabrane. Pratite povratno sanduče i SES reputaciju. API prosljeđuje `FeedbackForwardingEmailAddress`, ali nema automatski SNS webhook koji upisuje događaje u korisničke naloge. AWS zahtjev treba da opiše stvarno podešeno praćenje, bez tvrdnje da webhook postoji.

## IAM ključ samo za slanje

U **IAM → Policies → Create policy → JSON** prilagodite primjer: `AWS_ACCOUNT_ID` je vaš 12-cifreni broj, a domen i adresa moraju odgovarati SES identitetu i `SES_FROM`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:eu-central-1:AWS_ACCOUNT_ID:identity/mail.terapeut.me",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": "obavjestenja@mail.terapeut.me"
        }
      }
    }
  ]
}
```

Sačuvajte kao `TerapeutSesSendOnly`. Napravite IAM korisnika `terapeut-render-email` bez konzolskog pristupa i dodijelite samo ovu politiku. U **Security credentials → Create access key** izaberite aplikaciju van AWS-a ako se izbor prikazuje. Access key i secret unesite direktno u Render Environment. Ne dodjeljujte administratorski ili puni SES pristup. R2 koristi druge Cloudflare ključeve. Tajne ne idu u chat, Git ili `NEXT_PUBLIC_*`.

## Render i test

Prvo pushujte i deploy-ujte kod sa SES podrškom. Provjerite da Render prati baš taj repo i commit; kopirani repo bez izmjena nije dovoljan. U **Environment** unesite:

```dotenv
AUTH_EMAIL_MODE=ses
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=ovdje-unesite-access-key
AWS_SECRET_ACCESS_KEY=ovdje-unesite-secret-key
SES_FROM=Terapeut.me <obavjestenja@mail.terapeut.me>
SES_FEEDBACK_EMAIL=vase-stvarno-nadgledano-sanduce@example.com
```

Zamijenite domen i sanduče stvarnim vrijednostima. `AWS_SESSION_TOKEN` je opcioni dodatak za privremene kredencijale. `SES_CONFIGURATION_SET` ostavite nepodešen dok ne napravite odgovarajući configuration set i IAM dozvole. Postojeći `DATABASE_URL`, `AUTH_SECRET`, `WEB_ORIGINS` i `NODE_ENV` ostaju. SMTP portovi i Resend ključ nijesu potrebni za SES. Dok nalog/domen nijesu spremni, zadržite `AUTH_EMAIL_MODE=disabled`.

Poslije restarta `/api/v1/health` pokazuje `emailDelivery: ses`. Health ne šalje email i ne dokazuje ispravnost AWS ključeva. Registracijom na svoju potvrđenu adresu provjerite prijem koda, pa reset link i booking između svojih testnih naloga.

## Produkcioni pristup i ograničenja

Poslije sandbox testa otvorite **SES → Account dashboard → Request production access**. Izaberite **Transactional**, unesite javni URL aplikacije i objasnite kodove, reset i obavještenja o rezervacijama koje pokreću korisnici. Navedite stvarno praćenje povratnih poruka, suppression list, reakciju na spam prijave i očekivani obim. AWS navodi početni odgovor u roku od 96 sati; odobrenje nije garantovano. Poslije odobrenja provjerite dodijeljene kvote.

`EmailService` koristi `@aws-sdk/client-sesv2`, UTF-8 tekst, rok od 15 sekundi i jedan SDK pokušaj. Outbox upravlja retry-jem. Uspjeh zahtijeva `MessageId`. U log/outbox ide samo `SES_SEND_FAILED`, bez kodova, JWT-a, kontakata, ključeva ili sirovog AWS odgovora.

`MessageId` potvrđuje prihvatanje kod AWS-a, ne dostavu u inbox. `EmailTags.outbox_id` povezuje poruku sa redom, ali nije ključ protiv duplikata. Ako AWS prihvati poruku, a odgovor se izgubi ili proces stane prije `sent_at`, retry može poslati duplikat. Provjere verzije i primaoca i istorija ostaju. Render Free uspavljivanje i dalje odlaže pozadinske poslove.

Izvori: [AWS planovi](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html), [SES regioni](https://docs.aws.amazon.com/ses/latest/dg/regions.html), [identiteti i DNS](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html), [IAM pristup](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html), [povratne poruke](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications-email.html), [produkcioni pristup](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).
