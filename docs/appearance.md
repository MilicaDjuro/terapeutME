# Izgled po uzoru na terapeut.me

Referenca je javni [terapeut.me](https://terapeut.me/), pregledan 17. oktobra 2026. Izmjena je vizuelna: API, JWT sesije, slanje emaila, čuvanje profila, dostupnost i istorija rezervacija koriste postojeći kod.

## Gdje se uređuje izgled

| Fajl                                   | Namjena                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/web/src/app/globals.css`         | Osnovne boje u `:root`, raspored stranica i postojećih formulara                            |
| `apps/web/src/app/brand.css`           | Izgled brenda: zaglavlje, centrirani uvod, kartice, prijava, blaži prelazi i mobilni prikaz |
| `apps/web/src/app/brand-fonts.css`     | Lokalni Inter i Plus Jakarta Sans, uključujući naša latinična slova                         |
| `apps/web/src/app/layout.tsx`          | Učitava CSS i ikonu taba za sve stranice                                                    |
| `apps/web/src/components/shell.tsx`    | `Brand` prikazuje logo i mobilni simbol, uz iste navigacione linkove                        |
| `apps/web/src/app/page.tsx`            | Sadržaj početne i dekorativna fotografija; postojeći `handleSearch` vodi u katalog          |
| `apps/web/src/features/auth-pages.tsx` | Zajednički okvir prijave/registracije sa dekorativnom slikom                                |
| `apps/web/public/brand/`               | Lokalni logo, simbol, fotografija, fontovi i licence fontova                                |

`layout.tsx` prvo učitava `globals.css`, pa `brand.css`. Zato vizuelne dopune imaju prednost nad osnovnim pravilima iste specifičnosti. U DevTools → Styles pogledajte koje pravilo je aktivno prije dodavanja novog. Prvo mijenjajte odgovarajuću cjelinu u `brand.css`, umjesto dodavanja novih stilskih slojeva. Pravila dostupnosti i računanje vremena nijesu u CSS-u.

## Boje i fontovi

- Primarna tirkizna: `#176e72`; hover dugmeta: `#12585b`.
- Pozadina: `#edf3f0`; kartice: bijele.
- Glavni tekst: `#172b3a`; sporedni tekst: `#647682`.
- Obrub: `#d5dddc`; blago naglašena površina: `#e5f1f2`.
- Inter služi za tekst i kontrole. Plus Jakarta Sans služi za naslove.

Fontovi imaju težine 400–800. Svaki ima osnovnu latinicu i `latin-ext` za č, ć, š, đ i ž. Browser bira odgovarajući fajl preko `unicode-range`. `font-display: swap` prikazuje sistemski font dok lokalni ne bude spreman. Browser ne šalje zahtjeve Google Fonts-u niti referentnom sajtu.

Potvrde uspjeha i greške zadržavaju svoje semantičke boje. Zauzeti termini ostaju onemogućeni; CSS ne mijenja njihove statuse. Postojeće fotografije terapeuta i podaci iz baze ostaju povezani sa svojim profilima.

## Materijali i izvori

Materijali su kopirani iz javnih vizuelnih resursa reference, bez njenog programskog koda:

- [Logo](https://media.base44.com/images/public/6aa6965f38be907419285107/ed30f8002_stream-1543372836_461155401084337.png) → `public/brand/logo.png`.
- [Simbol](https://media.base44.com/images/public/6aa6965f38be907419285107/8006505c1_stream1611134662_461244435503574.png) → `public/brand/symbol.png` i ikona taba.
- [Fotografija prirode](https://media.base44.com/images/public/6aa6965f38be907419285107/cee6c2ab4_generated_image.png/v1/fill/w_1024,h_1024,al_c,q_90,usm_0.66_1.00_0.01,enc_webp,quality_auto/cee6c2ab4_generated_image.webp) → `public/brand/nature.webp`.
- Fontovi su preuzeti kroz [Google Fonts CSS](https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=Plus+Jakarta+Sans:wght@400..800&display=swap). OFL licence su uz fajlove u `public/brand/fonts/`.

Fotografija je dekoracija i ima prazan `alt`; ne predstavlja terapeuta ili stvarnu ordinaciju. `next/image` prilagođava lokalne slike veličini prikaza. Logo i fotografija na prijavi koriste `loading="eager"` jer se mogu vidjeti odmah pri otvaranju; uvodna fotografija na početnoj ima `preload`. Logo u zaglavlju na telefonu postaje simbol, dok link i pristupačan naziv ostaju isti.

## Animacije i debugging

`brand-enter` kratko prikazuje uvod i padajući meni. Hover blago podiže dugme ili karticu. Nema biblioteke, dodatnog timera niti skrivanja sadržaja do JavaScript događaja. `prefers-reduced-motion: reduce` uklanja animacije i pomjeranje pri hover-u. Spinneri i potvrde čuvanja i dalje prate postojeće mrežne radnje.

Ako font ne radi, u Network tabu provjerite `/brand/fonts/*.woff2` i `brand-fonts.css`. Ako slika ne radi, provjerite lokalnu putanju i `/_next/image` odgovor. Kod prelivanja na telefonu prvo provjerite `min-width`, širinu kontrole i mobilna pravila u `brand.css`.

Provjere su `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, relevantni browser scenariji i `npm.cmd run format:check`. Posebno pregledajte početnu, katalog, profil, kalendar, prijavu i oba korisnička pregleda na desktopu i telefonu.
