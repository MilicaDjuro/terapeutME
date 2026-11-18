# Terapeut.me PRO — prezentacija

Prezentacija sadrži devet slajdova u formatu 16:9 i svih 12 alata sa dostavljene najave. Ovo je vizuelni koncept budućeg PRO paketa, bez potvrđenog datuma, cijene ili tvrdnje da su sve funkcije već dostupne.

- `Terapeut-me-PRO.pptx`: PowerPoint sa izmjenjivim naslovima i opisima; za izvorni izgled potreban je font Inter.
- `Terapeut-me-PRO.pdf`: prezentacija sa ugrađenim fontovima za dijeljenje i pregled.
- `slides/`: devet kompletnih slajdova kao PNG slike.
- `images/`: šest originalnih generisanih slika interfejsa, bez naknadnog uređivanja.
- `presentation.html` i `presentation.css`: lokalni prikaz prezentacije; otvorite HTML u browseru.
- `presentation-data.json`: svi naslovi i opisi funkcija.
- `prompts.json`: puni prompt za svaku sliku; korišćen je ugrađeni `image_gen` alat, bez zasebnog API/CLI poziva.

Boje, logo i fontovi preuzeti su iz postojećeg projekta. Kopije fontova zadržavaju OFL licence u `brand/fonts`. Fotografije osoba, klijenti, statistike i događaji u generisanim slikama su ilustrativni. PRO oznaka je odvojena od verifikacije stručnjaka.

## Ponovni izvoz

Pokrenite `node presentations/terapeut-me-pro/build-presentation.cjs` iz korijena repozitorijuma. Skripta koristi postojeći Playwright i instalirani Edge, te lokalni alat `pptxgenjs` u ignorisanom `.local/presentation-tools` folderu. Taj alat nije dodat zavisnostima aplikacije. Ako folder nedostaje, instalirajte ga komandom `npm.cmd install --prefix .local/presentation-tools pptxgenjs --no-save --package-lock=false`.

Ova skripta ne generiše nove AI slike i ne poziva produkcionu aplikaciju. Ponovo slaže postojeće slike i tekst u prezentaciju.
