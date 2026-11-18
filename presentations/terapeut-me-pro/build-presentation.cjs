const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const PptxGenJS = require("../../.local/presentation-tools/node_modules/pptxgenjs");
const { chromium } = require("@playwright/test");
const prettier = require("prettier");

const outputDirectory = __dirname;
const colors = {
  background: "EDF3F0",
  white: "FFFFFF",
  ink: "172B3A",
  muted: "647682",
  teal: "176E72",
  darkTeal: "12585B",
  paleTeal: "E5F1F2",
  border: "D5DDDC",
};

/** Dodaje običan tekst u koordinatama slajda; svi naslovi ostaju izmjenjivi u PowerPoint-u. */
function addText(slide, text, x, y, width, height, size, options = {}) {
  slide.addText(text, {
    x: x / 120,
    y: y / 120,
    w: width / 120,
    h: height / 120,
    fontFace: "Inter",
    fontSize: size * 0.6,
    color: colors.ink,
    margin: 0,
    breakLine: false,
    valign: "top",
    fit: "shrink",
    ...options,
  });
}

/** Crta površinu kartice bez izmjene generisanih slika. */
function addCard(
  presentation,
  slide,
  x,
  y,
  width,
  height,
  fill,
  border = fill,
) {
  slide.addShape(presentation.ShapeType.roundRect, {
    x: x / 120,
    y: y / 120,
    w: width / 120,
    h: height / 120,
    radius: 0.18,
    rectRadius: 0.18,
    fill: { color: fill },
    line: { color: border, width: 0.7 },
  });
}

/** Povezuje zajedničko zaglavlje i podnožje sa brojem slajda. */
function addFrame(presentation, pageNumber) {
  const slide = presentation.addSlide();
  slide.background = { color: colors.background };
  slide.addImage({
    path: path.join(outputDirectory, "brand/logo.png"),
    x: 64 / 120,
    y: 42 / 120,
    w: 230 / 120,
    h: 46 / 120,
  });
  addCard(presentation, slide, 1300, 44, 236, 43, colors.ink);
  addText(slide, "USKORO · PRO", 1325, 55, 190, 23, 17, {
    color: colors.white,
    bold: true,
    charSpacing: 1,
    align: "center",
  });
  slide.addShape(presentation.ShapeType.line, {
    x: 64 / 120,
    y: 851 / 120,
    w: 1472 / 120,
    h: 0,
    line: { color: colors.border, width: 0.6 },
  });
  addText(
    slide,
    "terapeut.me PRO  /  Koncept budućih alata",
    64,
    866,
    850,
    20,
    13,
    {
      color: colors.muted,
    },
  );
  addText(
    slide,
    `${String(pageNumber).padStart(2, "0")} / 09`,
    1418,
    866,
    118,
    20,
    13,
    {
      color: colors.muted,
      align: "right",
    },
  );
  return slide;
}

/** Pravi naslovni slajd u bojama projekta i bez obećanja datuma objave. */
function addCover(presentation) {
  const slide = addFrame(presentation, 1);
  addCard(presentation, slide, 64, 137, 1472, 665, colors.teal);
  slide.addShape(presentation.ShapeType.ellipse, {
    x: 1170 / 120,
    y: 155 / 120,
    w: 310 / 120,
    h: 310 / 120,
    fill: { color: "2C8383", transparency: 30 },
    line: { color: "2C8383", transparency: 100 },
  });
  addText(slide, "ZA STRUČNJAKINJE I STRUČNJAKE", 110, 184, 1100, 30, 18, {
    color: "D8EFEB",
    bold: true,
    charSpacing: 1.3,
  });
  addText(slide, "PRO", 100, 247, 430, 224, 222, {
    color: colors.white,
    bold: true,
  });
  addText(slide, "Više prostora\nza vaš rad.", 553, 259, 880, 210, 76, {
    color: colors.white,
    bold: true,
  });
  slide.addShape(presentation.ShapeType.line, {
    x: 110 / 120,
    y: 511 / 120,
    w: 1380 / 120,
    h: 0,
    line: { color: "74B0AA", width: 0.8 },
  });
  addText(slide, "Alati koji povezuju vašu praksu.", 110, 552, 1250, 60, 39, {
    color: colors.white,
    bold: true,
  });
  addText(
    slide,
    "Ojačajte svoju praksu i prenesite je online\nu mjeri u kojoj vama odgovara.",
    110,
    638,
    1020,
    105,
    29,
    {
      color: "E3F4F0",
    },
  );
  addText(slide, "12 ALATA\nJEDNO MJESTO", 1200, 655, 260, 80, 24, {
    color: colors.white,
    bold: true,
    align: "right",
  });
  slide.addNotes(
    "Najava budućeg PRO paketa prema dostavljenom spisku. Vizuali su koncepti, bez najave cijene ili roka objavljivanja.",
  );
}

/** Prikazuje svih dvanaest izvorno navedenih alata u šest preglednih grupa. */
function addOverview(presentation, groups) {
  const slide = addFrame(presentation, 2);
  addText(slide, "12 alata za vašu praksu.", 64, 133, 1400, 80, 56, {
    bold: true,
  });
  addText(
    slide,
    "Sve što vam treba za rad, na jednom mjestu.",
    66,
    218,
    1400,
    45,
    25,
    { color: colors.muted },
  );
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 64 + column * 752;
    const y = 299 + row * 174;
    addCard(presentation, slide, x, y, 720, 151, colors.white, colors.border);
    addCard(presentation, slide, x + 22, y + 23, 55, 42, colors.paleTeal);
    addText(slide, group.number, x + 33, y + 32, 35, 25, 18, {
      bold: true,
      color: colors.teal,
    });
    addText(slide, group.tools[0].title, x + 98, y + 28, 590, 53, 23, {
      bold: true,
    });
    addText(slide, group.tools[1].title, x + 98, y + 86, 590, 48, 23, {
      color: colors.teal,
    });
  }
}

/** Spaja dva srodna alata sa originalnom generisanom slikom; prikaz nije funkcionalni ekran aplikacije. */
function addFeature(presentation, group, index) {
  const slide = addFrame(presentation, index + 3);
  addText(slide, group.title, 64, 130, 1450, 80, 54, { bold: true });
  addText(slide, group.subtitle, 66, 214, 1430, 45, 24, {
    color: colors.muted,
  });
  for (let toolIndex = 0; toolIndex < group.tools.length; toolIndex += 1) {
    const tool = group.tools[toolIndex];
    const y = 294 + toolIndex * 260;
    addCard(presentation, slide, 64, y, 444, 240, colors.white, colors.border);
    addText(
      slide,
      `${group.number}.${toolIndex + 1}`,
      87,
      y + 23,
      105,
      25,
      16,
      {
        color: colors.teal,
        bold: true,
      },
    );
    addText(slide, tool.title, 87, y + 60, 395, 75, 27, { bold: true });
    addText(slide, tool.description, 87, y + 139, 395, 88, 19, {
      color: colors.muted,
    });
  }
  slide.addImage({
    path: path.join(outputDirectory, "images", group.image),
    x: 545 / 120,
    y: 290 / 120,
    w: 991 / 120,
    h: 558 / 120,
  });
  slide.addNotes(
    `${group.note}\nPredlog funkcije i vizuelnog pravca. Generisano ugrađenim image_gen alatom. Svi prikazani podaci su ilustrativni.`,
  );
}

/** Završava prezentaciju najavom i kontaktom bez izmišljenog datuma ili cijene. */
function addClosing(presentation) {
  const slide = addFrame(presentation, 9);
  addText(slide, "Vaša praksa.\nVaš način rada.", 70, 205, 720, 220, 73, {
    bold: true,
  });
  addText(
    slide,
    "Organizacija, kontinuitet i povezivanje\nu prostoru koji prati vaš rad.",
    74,
    484,
    700,
    110,
    29,
    { color: colors.muted },
  );
  addCard(presentation, slide, 880, 173, 656, 608, colors.teal);
  addText(slide, "PRO", 924, 212, 540, 155, 140, {
    color: colors.white,
    bold: true,
  });
  addText(
    slide,
    "Pratite nas,\ndetalji stižu uskoro.",
    929,
    417,
    540,
    180,
    48,
    { color: colors.white, bold: true },
  );
  addText(slide, "terapeut.me  ·  @terapeut.me", 929, 685, 530, 45, 25, {
    color: "D7EEEA",
  });
  addText(
    slide,
    "Koncept PRO alata. Funkcije i izgled mogu se mijenjati.",
    74,
    727,
    740,
    52,
    18,
    { color: colors.muted },
  );
}

/** Čuva specijalne znakove da tekst prezentacije ostane običan HTML sadržaj. */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Pravi istu sadržajnu prezentaciju za browser, PDF i PNG izvoz koristeći lokalne fontove. */
function createHtml(groups) {
  const header =
    '<header><img src="brand/logo.png" alt="terapeut.me"><span class="badge">USKORO · PRO</span></header>';
  const slides = [];
  slides.push(
    `<section class="slide">${header}<div class="hero"><div class="orb"></div><p class="eyebrow">ZA STRUČNJAKINJE I STRUČNJAKE</p><div class="hero-row"><div class="pro">PRO</div><h1>Više prostora<br>za vaš rad.</h1></div><div class="hero-bottom"><h2>Alati koji povezuju vašu praksu.</h2><p>Ojačajte svoju praksu i prenesite je online<br>u mjeri u kojoj vama odgovara.</p><strong>12 ALATA<br>JEDNO MJESTO</strong></div></div></section>`,
  );
  const cards = groups
    .map(
      (group) =>
        `<article class="overview-card"><span class="number">${group.number}</span><div><h3>${escapeHtml(group.tools[0].title)}</h3><p>${escapeHtml(group.tools[1].title)}</p></div></article>`,
    )
    .join("");
  slides.push(
    `<section class="slide overview">${header}<h1 class="title">12 alata za vašu praksu.</h1><p class="subtitle">Sve što vam treba za rad, na jednom mjestu.</p><div class="overview-grid">${cards}</div></section>`,
  );
  for (const group of groups) {
    const toolCards = group.tools
      .map(
        (tool, index) =>
          `<article class="tool-card"><span>${group.number}.${index + 1}</span><h2>${escapeHtml(tool.title)}</h2><p>${escapeHtml(tool.description)}</p></article>`,
      )
      .join("");
    slides.push(
      `<section class="slide feature">${header}<h1 class="title">${escapeHtml(group.title)}</h1><p class="subtitle">${escapeHtml(group.subtitle)}</p><div class="feature-cards">${toolCards}</div><img class="mockup" src="images/${group.image}" alt="${escapeHtml(group.title)} — koncept PRO alata"></section>`,
    );
  }
  slides.push(
    `<section class="slide closing">${header}<h1>Vaša praksa.<br>Vaš način rada.</h1><p class="closing-copy">Organizacija, kontinuitet i povezivanje<br>u prostoru koji prati vaš rad.</p><p class="concept-note">Koncept PRO alata. Funkcije i izgled mogu se mijenjati.</p><div class="closing-panel"><div>PRO</div><h2>Pratite nas,<br>detalji stižu uskoro.</h2><p>terapeut.me · @terapeut.me</p></div></section>`,
  );
  for (let index = 0; index < slides.length; index += 1) {
    const footer = `<footer><span>terapeut.me PRO / Koncept budućih alata</span><span>${String(index + 1).padStart(2, "0")} / 09</span></footer>`;
    slides[index] = slides[index].replace("</section>", `${footer}</section>`);
  }
  return `<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><title>Terapeut.me PRO — prezentacija</title><link rel="stylesheet" href="presentation.css"></head><body>${slides.join("\n")}</body></html>`;
}

/** Izvozi PowerPoint, PDF i po jednu PNG sliku svakog slajda; aplikacija se ne pokreće i ne mijenja. */
async function buildPresentation() {
  const groups = JSON.parse(
    await fs.readFile(
      path.join(outputDirectory, "presentation-data.json"),
      "utf8",
    ),
  );
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "Terapeut.me";
  presentation.subject = "Koncept budućih PRO alata";
  presentation.title = "Terapeut.me PRO — više prostora za vaš rad";
  presentation.company = "Terapeut.me";
  presentation.lang = "sr-Latn-ME";
  presentation.theme = {
    headFontFace: "Inter",
    bodyFontFace: "Inter",
    lang: "sr-Latn-ME",
  };
  addCover(presentation);
  addOverview(presentation, groups);
  for (let index = 0; index < groups.length; index += 1)
    addFeature(presentation, groups[index], index);
  addClosing(presentation);
  await presentation.writeFile({
    fileName: path.join(outputDirectory, "Terapeut-me-PRO.pptx"),
  });
  const html = await prettier.format(createHtml(groups), { parser: "html" });
  await fs.writeFile(
    path.join(outputDirectory, "presentation.html"),
    html,
    "utf8",
  );
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1.2,
    });
    await page.goto(
      pathToFileURL(path.join(outputDirectory, "presentation.html")).href,
    );
    await page.evaluate(() => document.fonts.ready);
    const failedImages = await page
      .locator("img")
      .evaluateAll((images) =>
        images
          .filter((image) => !image.complete || image.naturalWidth === 0)
          .map((image) => image.src),
      );
    if (failedImages.length)
      throw new Error("Neke slike prezentacije nijesu učitane.");
    const slideElements = page.locator(".slide");
    if ((await slideElements.count()) !== 9)
      throw new Error("Prezentacija mora imati devet slajdova.");
    for (let index = 0; index < 9; index += 1) {
      // Svježa stranica sa jednim slajdom sprečava nestajanje prethodno skrivenih slojeva u Chromium-u.
      await page.goto(
        pathToFileURL(path.join(outputDirectory, "presentation.html")).href,
      );
      await page.evaluate((selectedIndex) => {
        const slides = document.querySelectorAll(".slide");
        for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
          if (slideIndex !== selectedIndex) slides[slideIndex].remove();
        }
        window.scrollTo(0, 0);
      }, index);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: path.join(
          outputDirectory,
          "slides",
          `${String(index + 1).padStart(2, "0")}.png`,
        ),
      });
    }
    // PDF ponovo dobija sve slajdove, svaki na zasebnoj stranici.
    await page.goto(
      pathToFileURL(path.join(outputDirectory, "presentation.html")).href,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: path.join(outputDirectory, "Terapeut-me-PRO.pdf"),
      width: "1600px",
      height: "900px",
      printBackground: true,
      preferCSSPageSize: true,
    });
    console.log(
      "Gotovo: 9 slajdova, PowerPoint, PDF i 6 originalnih generisanih vizuala.",
    );
  } finally {
    await browser.close();
  }
}

buildPresentation().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
