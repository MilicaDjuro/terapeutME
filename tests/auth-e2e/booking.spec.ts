import { openScheduleSections, chooseTime } from "./dashboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { addDays, dateKey, weekday } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";
const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const suffix = randomUUID();
const firstEmail = `first-${suffix}@example.test`;
const secondEmail = `second-${suffix}@example.test`;
const password = "Pravilna test lozinka!";

// Testni runner već pravi zasebnu šemu; ove pacijente nikad ne upisujemo u stvarnu bazu.
test.beforeAll(async () => {
  const schema = (await database.query("SELECT current_schema() AS name"))
    .rows[0].name;
  if (!/^auth_e2e_[a-f0-9]{32}$/.test(schema))
    throw new Error("Expected isolated browser test schema.");
  const passwordHash = await hashPassword(password);
  for (const [email, firstName] of [
    [firstEmail, "Prvi"],
    [secondEmail, "Drugi"],
  ])
    await database.query(
      "INSERT INTO users (email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at) VALUES ($1,$2,$3,$4,'Pacijent','1990-01-01','CLIENT',now())",
      [email, passwordHash, `${firstName} Pacijent`, firstName],
    );
});
// Runner uklanja šemu; ovaj fajl zatvara samo svoje konekcije.
test.afterAll(async () => {
  await database.end();
});

/** Prijavljuje jedan nezavisan browser nalog kroz stvarni formular i JWT kolačić. */
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(
    email === "ana.markovic@example.test" ? /\/dashboard$/ : /\/psychotherapy$/,
  );
}
/** Bira trajanje i datum, pa čeka stvarni odgovor kalendara iz baze. */
async function openCalendar(page: Page, duration: number, date: string) {
  await page.goto("/therapist/ana-markovic/book");
  await page
    .getByRole("button", { name: new RegExp(`${duration} min`) })
    .click();
  await page.getByLabel("Datum seanse", { exact: true }).fill(date);
  await expect(
    page.locator(".time-options button").filter({ hasText: /^09:00/ }),
  ).toBeVisible();
}
/** Šalje zahtjev za već izabran termin bez unošenja proizvoljnog identiteta klijenta. */
async function submitSelectedTime(page: Page) {
  await page.getByLabel("Broj telefona", { exact: true }).fill("+38267123456");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Pošalji zahtjev", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Zahtjev je poslat.", exact: true }),
  ).toBeVisible();
}

// Tri nezavisna naloga potvrđuju da zauzetost nije lokalna i da oba trajanja koriste isti raspored.
test("therapist hours and two independent patients share live database occupancy", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  let date = addDays(dateKey(), 1);
  while (weekday(date) === 0 || weekday(date) === 6) date = addDays(date, 1);
  const therapistContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
  });
  const secondContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
  });
  const therapistPage = await therapistContext.newPage();
  const secondPage = await secondContext.newPage();
  try {
    await signIn(therapistPage, "ana.markovic@example.test", "Test123");
    await openScheduleSections(therapistPage);
    const editor = therapistPage.locator(".schedule-editor");
    await editor
      .getByLabel("Dan", { exact: true })
      .selectOption(String(weekday(date)));
    await chooseTime(editor, "Radno vrijeme od", "09:00");
    await chooseTime(editor, "Radno vrijeme do", "12:00");
    await editor
      .getByRole("button", { name: "Dodaj radno vrijeme", exact: true })
      .click();
    await expect(
      editor.locator(".schedule-feedback").getByRole("status"),
    ).toContainText("Raspored je sačuvan.");
    await editor
      .getByRole("button", { name: "Dodaj radno vrijeme", exact: true })
      .click();
    await expect(
      editor.locator(".schedule-feedback").getByRole("status"),
    ).toContainText("Radno vrijeme je već sačuvano.");
    await expect(editor.getByRole("alert")).toHaveCount(0);
    await expect(
      editor
        .locator(".availability-list")
        .first()
        .getByText(/09:00–12:00/),
    ).toHaveCount(1);
    await chooseTime(editor, "Radno vrijeme do", "12:30");
    await editor
      .getByRole("button", { name: "Dodaj radno vrijeme", exact: true })
      .click();
    await expect(
      editor.locator(".schedule-feedback").getByRole("alert"),
    ).toContainText("Radno vrijeme se preklapa sa već sačuvanim periodom");
    await expect(
      editor.getByRole("heading", { name: "Pauze i odsustva" }),
    ).toHaveCount(0);
    await expect(editor.getByLabel("Datum pauze", { exact: true })).toHaveCount(
      0,
    );
    const removedBreak = await therapistPage.request.post("/api/v1/schedule", {
      headers: { Origin: "http://127.0.0.1:3200" },
      data: { action: "block", date, start: "600", end: "630" },
    });
    expect(removedBreak.status()).toBe(400);
    await therapistPage.reload();
    await openScheduleSections(therapistPage);
    await expect(editor.locator(".availability-list").first()).toContainText(
      "09:00–12:00",
    );
    const newSession = editor.locator('[data-new-session="true"]');
    for (const duration of [40, 50]) {
      await newSession
        .getByLabel("Naziv seanse", { exact: true })
        .fill(`Razgovor ${duration}`);
      await newSession
        .getByLabel("Trajanje seanse (min)", { exact: true })
        .fill(String(duration));
      await newSession
        .getByLabel("Cijena (€), opciono", { exact: true })
        .fill(String(duration));
      await newSession
        .getByRole("button", { name: "Dodaj seansu", exact: true })
        .click();
      await expect(
        editor
          .locator(".session-editor[data-service-id]")
          .filter({ hasText: `Razgovor ${duration}` }),
      ).toBeVisible();
    }
    await therapistPage.reload();
    await openScheduleSections(therapistPage);
    await expect(
      editor.locator(".session-editor").filter({ hasText: "Razgovor 40" }),
    ).toBeVisible();
    await signIn(page, firstEmail, password);
    await signIn(secondPage, secondEmail, password);
    await openCalendar(page, 40, date);
    await openCalendar(secondPage, 50, date);
    const firstNine = page
      .locator(".time-options button")
      .filter({ hasText: /^09:00/ });
    const secondNine = secondPage
      .locator(".time-options button")
      .filter({ hasText: /^09:00/ });
    await expect(firstNine).toBeEnabled();
    await expect(secondNine).toBeEnabled();
    await expect(
      page.locator(".time-options button").filter({ hasText: /^10:00/ }),
    ).toBeEnabled();
    await firstNine.click();
    await submitSelectedTime(page);
    // Drugi browser ostaje otvoren; polling treba sam da prikaže zauzetost bez refresh-a.
    await expect(secondNine).toBeDisabled();
    await expect(secondNine).toContainText("Zauzet");
    await expect(
      secondPage.locator(".time-options button").filter({ hasText: /^09:30/ }),
    ).toBeDisabled();
    await secondPage
      .locator(".time-options button")
      .filter({ hasText: /^09:40/ })
      .click();
    await submitSelectedTime(secondPage);
    await page
      .getByRole("link", { name: "Pogledaj moje zahtjeve", exact: true })
      .click();
    await expect(page.locator(".server-bookings .booking-card")).toHaveCount(1);
    await page.reload();
    await expect(page.locator(".server-bookings .booking-card")).toContainText(
      "09:00–09:40",
    );
    const firstRequest = therapistPage
      .locator(".server-bookings .booking-card")
      .filter({ hasText: "Prvi Pacijent" });
    await expect(firstRequest).toBeVisible();
    // Novi raspored stranice stavlja zahtjeve prije podešavanja i čuva sve postojeće akcije.
    expect(
      await therapistPage
        .locator(".server-bookings")
        .evaluate((element) =>
          Boolean(
            element.compareDocumentPosition(
              document.querySelector(".schedule-editor")!,
            ) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        ),
    ).toBe(true);
    const filters = therapistPage.getByRole("group", {
      name: "Prikaz zahtjeva",
      exact: true,
    });
    await filters.getByRole("button", { name: /^Na čekanju/ }).click();
    await expect(firstRequest).toBeVisible();
    await filters.getByRole("button", { name: /^Potvrđeni termini/ }).click();
    await expect(firstRequest).toHaveCount(0);
    await filters.getByRole("button", { name: /^Svi zahtjevi/ }).click();
    for (const section of await therapistPage
      .locator(".schedule-section")
      .all())
      await section.locator("summary").click();
    await therapistPage.evaluate(() =>
      window.scrollTo({ top: 0, behavior: "instant" }),
    );
    await therapistPage.screenshot({
      path: testInfo.outputPath("therapist-dashboard-desktop.png"),
      fullPage: true,
    });
    await therapistPage.setViewportSize({ width: 390, height: 844 });
    await therapistPage.evaluate(() =>
      window.scrollTo({ top: 0, behavior: "instant" }),
    );
    await therapistPage.screenshot({
      path: testInfo.outputPath("therapist-dashboard-mobile.png"),
      fullPage: true,
    });
    expect(
      await therapistPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await firstRequest
      .getByRole("button", { name: "Potvrdi", exact: true })
      .click();
    await expect(
      page.locator(".server-bookings .booking-card .status"),
    ).toContainText("Potvrđen");
    await page
      .locator(".server-bookings .booking-card")
      .getByRole("button", { name: "Otkaži termin", exact: true })
      .click();
    await expect(
      page.locator(".server-bookings .booking-card .status"),
    ).toContainText("Otkazan");
    await openCalendar(secondPage, 40, date);
    await expect(
      secondPage.locator(".time-options button").filter({ hasText: /^09:00/ }),
    ).toBeEnabled();
    const stored = await database.query(
      "SELECT duration_minutes,status,client_email_snapshot FROM booking_requests WHERE client_email_snapshot IN ($1,$2) ORDER BY duration_minutes",
      [firstEmail, secondEmail],
    );
    expect(stored.rows).toMatchObject([
      {
        duration_minutes: 40,
        status: "CANCELLED",
        client_email_snapshot: firstEmail,
      },
      {
        duration_minutes: 50,
        status: "REQUESTED",
        client_email_snapshot: secondEmail,
      },
    ]);
    await secondPage.setViewportSize({ width: 390, height: 844 });
    expect(
      await secondPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await secondPage.screenshot({
      path: testInfo.outputPath("booking-mobile.png"),
      fullPage: true,
    });
  } finally {
    await therapistContext.close();
    await secondContext.close();
  }
});
