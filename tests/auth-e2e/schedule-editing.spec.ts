import { openScheduleSections, chooseTime } from "./dashboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { addDays, dateKey, weekday } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const password = "Moja sigurna test lozinka!";
const therapistEmail = `edit-therapist-${randomUUID()}@example.test`;
const patientEmail = `edit-patient-${randomUUID()}@example.test`;
let therapistId = "";
let sessionId = "";
let windowId = "";
const date = addDays(dateKey(), 2);
const movedDate = addDays(date, 1);

// Samo posebna testna šema dobija ove naloge; ne mijenjamo stvarne profile i rasporede.
test.beforeAll(async () => {
  expect(
    (await database.query("SELECT current_schema() AS name")).rows[0].name,
  ).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
  const passwordHash = await hashPassword(password);
  for (const [email, role] of [
    [therapistEmail, "THERAPIST"],
    [patientEmail, "CLIENT"],
  ]) {
    const user = await database.query(
      "INSERT INTO users (email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,'Uređivanje Test','Uređivanje','Test','1990-01-01',$3,now(),'+38267123456') RETURNING id",
      [email, passwordHash, role],
    );
    if (role === "THERAPIST") {
      therapistId = (
        await database.query(
          "INSERT INTO therapists (linked_user_id,full_name,title_mne,title_en,bio_mne,bio_en,city) VALUES ($1,'Uređivanje Test','Psihoterapeut','Psihoterapeut','Test biografija.','Test biografija.','Podgorica') RETURNING id",
          [user.rows[0].id],
        )
      ).rows[0].id;
      sessionId = (
        await database.query(
          "INSERT INTO services (therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,'Individualna terapija','Individualna terapija',60,40) RETURNING id",
          [therapistId],
        )
      ).rows[0].id;
      windowId = (
        await database.query(
          "INSERT INTO availability_windows (therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,540,720) RETURNING id",
          [therapistId, weekday(date)],
        )
      ).rows[0].id;
    }
  }
});

// Šemu uklanja runner, a ovaj fajl zatvara samo svoje konekcije.
test.afterAll(async () => {
  await database.end();
});

/** Čeka završenu prijavu prije otvaranja sljedećeg formulara. */
async function signIn(page: Page, email: string, therapist: boolean) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(therapist ? /\/dashboard$/ : /\/psychotherapy$/);
}

/** Otvara živi kalendar iste usluge poslije terapeutske izmjene. */
async function openCalendar(page: Page, duration: number, workingDate: string) {
  await page.goto(`/therapist/${therapistId}/book`);
  await page
    .getByRole("button", { name: new RegExp(`${duration} min`) })
    .click();
  await page.getByLabel("Datum seanse", { exact: true }).fill(workingDate);
}

// Prikaz drugog naloga dokazuje da izmjene dolaze iz baze i da stare rezervacije ostaju iste.
test("therapist edits session types, weekly hours and specific working dates", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  const patientContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
  });
  const patient = await patientContext.newPage();
  try {
    await signIn(page, therapistEmail, true);
    await expect(page.locator(".schedule-section[open]")).toHaveCount(0);
    await openScheduleSections(page);
    const editor = page.locator(".schedule-editor");
    const session = editor.locator(`[data-service-id="${sessionId}"]`);
    for (const duration of [30, 50, 40]) {
      await session
        .getByLabel("Naziv seanse", { exact: true })
        .fill("Partnerska terapija");
      await session
        .getByLabel("Trajanje seanse (min)", { exact: true })
        .fill(String(duration));
      await session
        .getByRole("button", { name: "Sačuvaj seansu", exact: true })
        .click();
      await expect(session.getByRole("heading")).toContainText(
        `${duration} min`,
      );
    }
    await page.reload();
    await openScheduleSections(page);
    await expect(
      session.getByLabel("Trajanje seanse (min)", { exact: true }),
    ).toHaveValue("40");
    const weekly = editor.locator(`[data-window-id="${windowId}"]`);
    await weekly
      .getByRole("button", { name: "Uredi period", exact: true })
      .click();
    await chooseTime(weekly, "Radno vrijeme od", "10:07");
    await chooseTime(weekly, "Radno vrijeme do", "13:00");
    await weekly
      .getByRole("button", { name: "Sačuvaj period", exact: true })
      .click();
    await expect(weekly).toContainText("10:07–13:00");
    await expect(editor.locator(".save-feedback-success")).toHaveCount(1);
    await expect(editor.locator(".save-feedback-success")).toHaveText(
      "Raspored je sačuvan.",
    );
    await expect(weekly.locator(".save-feedback-success")).toHaveCount(0);
    const newDate = editor.locator('[data-new-date="true"]');
    await newDate.getByLabel("Datum rada", { exact: true }).fill(date);
    await newDate
      .getByRole("checkbox", { name: "Radim ovog datuma", exact: true })
      .uncheck();
    await newDate
      .getByRole("button", { name: "Sačuvaj datum", exact: true })
      .click();
    const dated = editor.locator("[data-date-id]");
    await expect(dated).toContainText(`${date} · Neradni dan`);
    await signIn(patient, patientEmail, false);
    await openCalendar(patient, 40, date);
    await expect(
      patient.getByText(
        "Terapeut ne radi ovog datuma. Izaberite drugi datum.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(patient.locator(".time-options button")).toHaveCount(0);
    await page.reload();
    await openScheduleSections(page);
    await expect(dated).toContainText(`${date} · Neradni dan`);
    await dated
      .getByRole("button", { name: "Vrati sedmični raspored", exact: true })
      .click();
    const confirmation = dated.getByRole("group", {
      name: "Potvrda vraćanja rasporeda",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await expect(
      patient.getByText(
        "Terapeut ne radi ovog datuma. Izaberite drugi datum.",
        { exact: true },
      ),
    ).toBeVisible();
    await confirmation
      .getByRole("button", { name: "Odustani", exact: true })
      .click();
    await expect(confirmation).toHaveCount(0);
    await expect(dated).toContainText("Neradni dan");
    // Datum ostaje zatvoren poslije odustajanja; tek sačuvana izmjena ponovo otvara termine.
    await dated
      .getByRole("button", { name: "Uredi datum", exact: true })
      .click();
    await dated
      .getByRole("checkbox", { name: "Radim ovog datuma", exact: true })
      .check();
    await chooseTime(dated, "Rad za datum od", "09:00");
    await chooseTime(dated, "Rad za datum do", "12:00");
    await dated
      .getByRole("button", { name: "Sačuvaj datum", exact: true })
      .click();
    await expect(dated).toContainText(`${date} · 09:00–12:00`);
    await patient
      .locator(".time-options button")
      .filter({ hasText: /^09:00/ })
      .click();
    await patient.getByRole("checkbox").check();
    await patient
      .getByRole("button", { name: "Pošalji zahtjev", exact: true })
      .click();
    await expect(
      patient.getByRole("heading", { name: "Zahtjev je poslat.", exact: true }),
    ).toBeVisible();
    await session
      .getByLabel("Naziv seanse", { exact: true })
      .fill("Individualna podrška");
    await session
      .getByLabel("Trajanje seanse (min)", { exact: true })
      .fill("50");
    await session
      .getByRole("button", { name: "Sačuvaj seansu", exact: true })
      .click();
    await expect(session.getByRole("heading")).toContainText("50 min");
    await openCalendar(patient, 50, date);
    await expect(
      patient.locator(".time-options button").filter({ hasText: /^09:00/ }),
    ).toBeDisabled();
    await expect(
      patient.locator(".time-options button").filter({ hasText: /^09:40/ }),
    ).toBeEnabled();
    await dated
      .getByRole("button", { name: "Uredi datum", exact: true })
      .click();
    await chooseTime(dated, "Rad za datum od", "10:00");
    await dated
      .getByRole("button", { name: "Sačuvaj datum", exact: true })
      .click();
    await expect(dated).toContainText("10:00–12:00");
    await expect(
      patient.locator(".time-options button").filter({ hasText: /^10:00/ }),
    ).toBeEnabled();
    await expect(
      patient.locator(".time-options button").filter({ hasText: /^09:00/ }),
    ).toHaveCount(0);
    await dated
      .getByRole("button", { name: "Uredi datum", exact: true })
      .click();
    await dated
      .getByRole("checkbox", { name: "Radim ovog datuma", exact: true })
      .uncheck();
    await dated
      .getByRole("button", { name: "Sačuvaj datum", exact: true })
      .click();
    await expect(dated).toContainText("Neradni dan");
    await expect(patient.locator(".time-options button")).toHaveCount(0);
    await expect(
      patient.getByText(
        "Terapeut ne radi ovog datuma. Izaberite drugi datum.",
        { exact: true },
      ),
    ).toBeVisible();
    await dated
      .getByRole("button", { name: "Uredi datum", exact: true })
      .click();
    await dated.getByLabel("Datum rada", { exact: true }).fill(movedDate);
    await dated
      .getByRole("checkbox", { name: "Radim ovog datuma", exact: true })
      .check();
    await chooseTime(dated, "Rad za datum od", "11:00");
    await chooseTime(dated, "Rad za datum do", "13:00");
    await dated
      .getByRole("button", { name: "Sačuvaj datum", exact: true })
      .click();
    await expect(dated).toContainText(`${movedDate} · 11:00–13:00`);
    await patient.getByLabel("Datum seanse", { exact: true }).fill(movedDate);
    await expect(
      patient.locator(".time-options button").filter({ hasText: /^11:00/ }),
    ).toBeEnabled();
    await page.reload();
    await openScheduleSections(page);
    await expect(dated).toContainText(`${movedDate} · 11:00–13:00`);
    const stored = (
      await database.query(
        "SELECT duration_minutes,service_name_snapshot,client_email_snapshot FROM booking_requests WHERE therapist_id=$1",
        [therapistId],
      )
    ).rows[0];
    expect(stored).toMatchObject({
      duration_minutes: 40,
      service_name_snapshot: "Partnerska terapija",
      client_email_snapshot: patientEmail,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await dated
      .getByRole("button", { name: "Uredi datum", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("edit-schedule-mobile.png"),
      fullPage: true,
    });
    await dated.getByRole("button", { name: "Odustani", exact: true }).click();
    await dated
      .getByRole("button", { name: "Vrati sedmični raspored", exact: true })
      .click();
    await dated
      .getByRole("button", { name: "Potvrdi vraćanje rasporeda", exact: true })
      .click();
    await expect(dated).toHaveCount(0);
    await expect(patient.locator(".time-options button")).toHaveCount(0);
    await page
      .getByRole("link", { name: "Uredi profil terapeuta", exact: true })
      .click();
    await expect(page).toHaveURL(/\/account$/);
    await page
      .getByRole("button", { name: "Uredi profil", exact: true })
      .click();
    await expect(page.getByLabel("Biografija", { exact: true })).toHaveValue(
      "Test biografija.",
    );
    const accountButton = page.getByRole("button", {
      name: "Moj nalog",
      exact: true,
    });
    await accountButton.click();
    await expect(accountButton).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(accountButton).toBeFocused();
    await expect(page.locator(".account-dropdown")).toHaveCount(0);
    await accountButton.click();
    // Lijeva margina je van otvorenog menija; njegov panel namjerno prekriva dio naslova.
    await page.mouse.click(8, 300);
    await expect(page.locator(".account-dropdown")).toHaveCount(0);
    await accountButton.click();
    await page
      .getByRole("link", { name: "Uredi moj profil", exact: true })
      .click();
    await expect(page.locator(".account-dropdown")).toHaveCount(0);
    await accountButton.click();
    await page.route("**/api/v1/auth/logout", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Testna greška odjave." }),
      });
    });
    await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
    await expect(
      page.locator(".account-dropdown").getByRole("alert"),
    ).toBeVisible();
    await expect(accountButton).toBeVisible();
    await page.unroute("**/api/v1/auth/logout");
    await page.screenshot({
      path: testInfo.outputPath("account-menu-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
  } finally {
    await patientContext.close();
  }
});
