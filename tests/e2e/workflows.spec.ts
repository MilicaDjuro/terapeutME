// Browser testovi otvaraju stvarne ekrane. Svaki test dobija novo skladište i ne šalje email.
import { test, expect } from "@playwright/test";

// Provjerava katalog, URL filter i pamćenje jezika nakon ponovnog učitavanja.
test("public pages, URL filters and English language switch work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Podrška počinje",
  );
  await page.goto("/psychotherapy?city=Bar");
  await expect(page.locator(".therapist-card")).toHaveCount(1);
  await expect(page.locator(".therapist-card")).toContainText(
    "Jelena Petrović",
  );
  await expect(page.locator(".therapist-card")).toContainText("Neverifikovan");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find someone",
  );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find someone",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});

// Prolazi klijentski formular i provjerava da poslati zahtjev uklanja zauzeti početak.
test("a client selects a service and calendar time and submits a held request", async ({
  page,
}) => {
  await page.goto("/therapist/ana-markovic/book");
  await page.getByRole("button", { name: /Individualna seansa/ }).click();
  await expect(page.locator(".calendar-picker")).toBeVisible();
  await page.locator(".time-options button").first().click();
  await page.getByLabel("Ime i prezime", { exact: true }).fill("Test Klijent");
  await page.getByLabel("Email", { exact: true }).fill("test@example.test");
  await page
    .getByLabel("Broj telefona", { exact: true })
    .fill("+382 67 123 456");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Pošalji zahtjev", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Zahtjev je poslat." }),
  ).toBeVisible();
  const b = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("terapeut-me.demo.v1")!).bookings.find(
      (b: { clientName: string }) => b.clientName === "Test Klijent",
    ),
  );
  expect(b.status).toBe("REQUESTED");
  expect(b.end - b.start).toBe(60);
  await page.reload();
  await page.getByRole("button", { name: /Individualna seansa/ }).click();
  const times = await page.locator(".time-options").innerText();
  expect(times).not.toContain(
    `${Math.floor(b.start / 60)
      .toString()
      .padStart(2, "0")}:${(b.start % 60).toString().padStart(2, "0")}`,
  );
});

// Prolazi cijeli A → B tok, prihvatanje i otkazivanje uz istoriju razloga.
test("therapist proposal holds B immediately, client accepts and cancels it", async ({
  page,
}) => {
  await page.goto("/dashboard?mode=therapist");
  const original = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("terapeut-me.demo.v1")!).bookings.find(
      (b: { id: string }) => b.id === "demo-pending",
    ),
  );
  await page
    .getByRole("button", { name: "Predloži drugi termin", exact: true })
    .click();
  await page
    .locator(".booking-action-panel .time-options button")
    .filter({ hasText: /^18:00/ })
    .click();
  await page
    .getByRole("button", { name: "Pošalji predlog", exact: true })
    .click();
  await expect(page.locator(".status.alternative")).toContainText(
    "Čeka klijenta",
  );
  let b = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("terapeut-me.demo.v1")!).bookings.find(
      (b: { id: string }) => b.id === "demo-pending",
    ),
  );
  expect(b.start).toBe(1080);
  expect(b.status).toBe("ALTERNATIVE_PROPOSED");
  expect(b.events.at(-1).previousStart).toBe(original.start);
  await page.getByRole("button", { name: "Klijent", exact: true }).click();
  await page
    .getByRole("button", { name: "Prihvati termin", exact: true })
    .click();
  await page.getByRole("button", { name: /^Potvrđeni/ }).click();
  const card = page
    .locator(".booking-card")
    .filter({ has: page.getByRole("heading", { name: "Ana Marković" }) });
  await expect(card).toContainText("18:00–19:00");
  await card
    .getByRole("button", { name: "Otkaži termin", exact: true })
    .click();
  await card.getByLabel("Razlog (opcionalno)").fill("Promjena plana");
  await card.getByRole("button", { name: "Potvrdi", exact: true }).click();
  b = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("terapeut-me.demo.v1")!).bookings.find(
      (b: { id: string }) => b.id === "demo-pending",
    ),
  );
  expect(b.status).toBe("CANCELLED");
  expect(b.events.at(-1).from).toBe("CONFIRMED");
  expect(b.events.at(-1).reason).toBe("Promjena plana");
});

// Provjerava odbijanje preklopljene dostupnosti i očuvanje trajanja starih zahtjeva.
test("therapist service edits and availability conflicts are validated", async ({
  page,
}) => {
  await page.goto("/dashboard?mode=therapist");
  await page
    .getByRole("button", { name: "Usluge i dostupnost", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Dodaj dostupnost", exact: true })
    .click();
  await expect(page.locator(".form-error[role=alert]")).toContainText(
    "preklapaju",
  );
  const service = page.locator(".editable-service").first();
  await service.getByRole("button", { name: "Uredi" }).click();
  await service.getByLabel("Trajanje (min)").fill("75");
  await service.getByRole("button", { name: "Sačuvaj", exact: true }).click();
  await expect(service).toContainText("75 min");
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("terapeut-me.demo.v1")!),
  );
  expect(
    state.bookings.find((b: { id: string }) => b.id === "demo-pending")
      .duration,
  ).toBe(60);
});

// Provjerava da rani sati ostaju vidljivi u nedjeljnom kalendaru.
test("weekly calendar includes availability before 08:00", async ({ page }) => {
  await page.goto("/dashboard?mode=therapist");
  await page
    .getByRole("button", { name: "Usluge i dostupnost", exact: true })
    .click();
  const panel = page.locator(".settings-panel").filter({
    has: page.getByRole("heading", { name: "Nedjeljna dostupnost" }),
  });
  await panel
    .getByRole("combobox", { name: "Dan", exact: true })
    .selectOption("0");
  await panel.getByLabel("Od", { exact: true }).fill("07:00");
  await panel.getByLabel("Do", { exact: true }).fill("08:00");
  await panel
    .getByRole("button", { name: "Dodaj dostupnost", exact: true })
    .click();
  await expect(panel.locator(".availability-list")).toContainText(
    "07:00–08:00",
  );
  await page.getByRole("button", { name: "Kalendar", exact: true }).click();
  await expect(page.locator(".week-hours > span").first()).toHaveText("7:00");
  const sunday = page.locator(".week-day").last();
  expect(
    await sunday
      .locator(".availability-shade")
      .evaluate((el) => parseFloat((el as HTMLElement).style.top)),
  ).toBe(0);
});

// Provjerava verifikaciju i otvara preuzeti Excel da potvrdi stvaran sadržaj.
test("admin verification and a real Excel download work", async ({ page }) => {
  await page.goto("/dashboard?mode=admin");
  const row = page.getByRole("row").filter({ hasText: "Jelena Petrović" });
  await row.getByRole("button", { name: "Verifikuj", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Verifikovan · ukloni" }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Preuzmi Excel" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("terapeut-me-demo.xlsx");
  const path = await download.path();
  expect(path).toBeTruthy();
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path!);
  expect(book.worksheets.map((s) => s.name)).toEqual(["Zahtjevi", "Istorija"]);
  expect(book.getWorksheet("Zahtjevi")!.rowCount).toBeGreaterThan(1);
});

// Provjerava više ekrana na širini telefona i otvaranje mobilnog menija.
test("mobile pages remain usable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/",
    "/psychotherapy",
    "/therapist/ana-markovic",
    "/therapist/ana-markovic/book",
    "/dashboard?mode=therapist",
    "/faq",
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (route.endsWith("/book")) {
      await page.getByRole("button", { name: /Individualna seansa/ }).click();
      await expect(page.locator(".calendar-picker")).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      route,
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Otvori navigaciju" }).click();
  await expect(page.locator("#mobile-nav")).toBeVisible();
});
