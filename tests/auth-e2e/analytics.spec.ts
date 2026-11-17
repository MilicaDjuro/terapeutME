import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { addDays, dateKey, weekday } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const origin = "http://127.0.0.1:3200";
const password = "Sigurna lozinka za analitiku profila!";
test.use({ actionTimeout: 15000 });
// Samo testni nalozi u šemi koju runner uklanja nakon završetka.
test.beforeAll(async () => {
  expect(
    (await database.query("SELECT current_schema() AS name")).rows[0].name,
  ).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
});
test.afterAll(async () => {
  await database.end();
});

/** Kreira terapeuta, drugog vlasnika i klijenta sa stvarnim hashom lozinke. */
async function fixture() {
  const passwordHash = await hashPassword(password);
  const emails: string[] = [];
  const ids: string[] = [];
  for (const role of ["THERAPIST", "THERAPIST", "CLIENT"]) {
    const email = `analytics-${randomUUID()}@example.test`;
    const id = (
      await database.query(
        "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,'Analitika Test','Analitika','Test','1990-01-01',$3,now(),'+38267123456') RETURNING id",
        [email, passwordHash, role],
      )
    ).rows[0].id;
    emails.push(email);
    ids.push(id);
  }
  const therapistIds: string[] = [];
  for (const id of ids.slice(0, 2)) {
    therapistIds.push(
      (
        await database.query(
          "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city) VALUES ($1,'Terapeut Analitika','Psihoterapeut','Psychotherapist','Podgorica') RETURNING id",
          [id],
        )
      ).rows[0].id,
    );
  }
  const serviceId = (
    await database.query(
      "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes) VALUES ($1,'Seansa','Session',50) RETURNING id",
      [therapistIds[0]],
    )
  ).rows[0].id;
  const date = addDays(dateKey(), 2);
  await database.query(
    "INSERT INTO availability_windows(therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,540,1020)",
    [therapistIds[0], weekday(date)],
  );
  return { emails, ids, therapistIds, serviceId, date };
}

/** Prijavljuje nalog kroz postojeći API; browser šalje pravi HttpOnly JWT. */
async function signIn(context: BrowserContext, email: string) {
  const response = await context.request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { email, password },
  });
  expect(response.ok()).toBe(true);
}

/** Broji upise baze bez podataka o identitetu posjetioca u browser prikazu. */
async function viewCount(therapistId: string) {
  return Number(
    (
      await database.query(
        "SELECT count(*) FROM profile_view_events WHERE therapist_id=$1",
        [therapistId],
      )
    ).rows[0].count,
  );
}

/** Provjerava kartice prema očekivanim poslovnim radnjama, a ne internom React stanju. */
async function expectMetric(page: Page, key: string, value: string) {
  await expect(page.getByTestId(`analytics-${key}`)).toHaveText(value);
}

// Svako otvaranje se broji; anonimni i prijavljeni posjetioci ostaju odvojeni od kataloga i duplog upisa.
test("therapist sees only own profile analytics after client views and booking changes", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.setTimeout(150000);
  const data = await fixture();
  const therapist = data.therapistIds[0];
  await page.goto(`/therapist/${therapist}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Terapeut Analitika" }),
  ).toBeVisible();
  await expect.poll(() => viewCount(therapist)).toBe(1);
  const analyticsCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "terapeut_analytics",
  );
  expect(analyticsCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  expect((await page.request.get("/api/v1/analytics")).status()).toBe(401);
  await signIn(context, data.emails[2]);
  await page.goto("/psychotherapy");
  await expect(
    page.getByRole("link", { name: /Terapeut Analitika/ }).first(),
  ).toBeVisible();
  expect(await viewCount(therapist)).toBe(1);
  await page.goto(`/therapist/${therapist}`);
  await expect.poll(() => viewCount(therapist)).toBe(2);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Terapeut Analitika" }),
  ).toBeVisible();
  await expect.poll(() => viewCount(therapist)).toBe(3);
  const viewId = randomUUID();
  const repeated = await page.request.post(
    `/api/v1/analytics/profiles/${therapist}/view`,
    { headers: { Origin: origin }, data: { viewId } },
  );
  expect(repeated.ok()).toBe(true);
  await page.request.post(`/api/v1/analytics/profiles/${therapist}/view`, {
    headers: { Origin: origin },
    data: { viewId },
  });
  expect(await viewCount(therapist)).toBe(4);
  expect((await page.request.get("/api/v1/analytics")).status()).toBe(403);
  const created = await page.request.post("/api/v1/bookings", {
    headers: { Origin: origin },
    data: {
      therapistId: therapist,
      serviceId: data.serviceId,
      date: data.date,
      start: "540",
      duration: "50",
      phone: "+38267123456",
    },
  });
  expect(created.ok()).toBe(true);
  const bookingId = (await created.json()).booking.id;
  const therapistContext = await browser.newContext({ baseURL: origin });
  const otherContext = await browser.newContext({ baseURL: origin });
  try {
    await signIn(therapistContext, data.emails[0]);
    const therapistPage = await therapistContext.newPage();
    await therapistPage.goto("/dashboard");
    await therapistPage
      .getByRole("link", { name: "Analitika profila", exact: true })
      .click();
    await expect(therapistPage).toHaveURL(/\/dashboard\/analytics$/);
    await expectMetric(therapistPage, "views", "4");
    await expect(therapistPage.getByTestId("visitors-unique")).toHaveText("2");
    await expect(therapistPage.getByTestId("visitors-repeat")).toHaveText("2");
    await expect(
      therapistPage.getByTestId("audience-ANONYMOUS-views"),
    ).toHaveText("1");
    await expect(therapistPage.getByTestId("audience-CLIENT-views")).toHaveText(
      "3",
    );
    await expectMetric(therapistPage, "requests", "1");
    await expect(
      therapistPage.getByRole("heading", {
        name: "Primljeni zahtjevi u periodu",
        exact: true,
      }),
    ).toBeVisible();
    await expect(therapistPage.getByTestId("current-waiting")).toHaveText("1");
    await expect(therapistPage.getByTestId("current-total")).toHaveText("1");
    await expectMetric(therapistPage, "conversion", "100%");
    await therapistPage.screenshot({
      path: testInfo.outputPath("analytics-desktop.png"),
      fullPage: true,
    });
    expect(
      (
        await therapistContext.request.post(
          `/api/v1/analytics/profiles/${therapist}/view`,
          { headers: { Origin: origin }, data: { viewId: randomUUID() } },
        )
      ).status(),
    ).toBe(201);
    const confirmed = await therapistContext.request.post(
      `/api/v1/bookings/${bookingId}/respond`,
      { headers: { Origin: origin }, data: { action: "confirm" } },
    );
    expect(confirmed.ok()).toBe(true);
    await therapistPage
      .getByRole("button", { name: "Osvježi analitiku", exact: true })
      .click();
    await expectMetric(therapistPage, "confirmed", "1");
    await expect(therapistPage.getByTestId("current-waiting")).toHaveText("0");
    await expect(therapistPage.getByTestId("current-confirmed")).toHaveText(
      "1",
    );
    const cancelled = await page.request.post(
      `/api/v1/bookings/${bookingId}/respond`,
      { headers: { Origin: origin }, data: { action: "cancel" } },
    );
    expect(cancelled.ok()).toBe(true);
    await therapistPage
      .getByRole("button", { name: "Osvježi analitiku", exact: true })
      .click();
    await expectMetric(therapistPage, "cancelled", "1");
    await expect(therapistPage.getByTestId("current-waiting")).toHaveText("0");
    await expect(therapistPage.getByTestId("current-confirmed")).toHaveText(
      "0",
    );
    await expect(therapistPage.getByTestId("current-history")).toHaveText("1");
    await expectMetric(therapistPage, "requests", "1");
    await expectMetric(therapistPage, "confirmed", "1");
    await therapistPage
      .getByRole("combobox", { name: "Period", exact: true })
      .selectOption("7");
    await expectMetric(therapistPage, "requests", "1");
    await therapistPage
      .getByText("Pogledaj dnevne podatke", { exact: true })
      .click();
    await expect(
      therapistPage
        .getByRole("table", { name: "Radnje u izabranom periodu" })
        .getByRole("row"),
    ).toHaveCount(8);
    await therapistPage
      .getByRole("button", { name: "Moj nalog", exact: true })
      .click();
    await expect(
      therapistPage
        .locator("#account-dropdown")
        .getByRole("link", { name: "Analitika profila", exact: true }),
    ).toBeVisible();
    await therapistPage
      .getByRole("button", { name: "Moj nalog", exact: true })
      .click();
    await therapistPage.setViewportSize({ width: 390, height: 844 });
    expect(
      await therapistPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await therapistPage.screenshot({
      path: testInfo.outputPath("analytics-mobile.png"),
      fullPage: true,
    });
    await signIn(otherContext, data.emails[1]);
    const otherPage = await otherContext.newPage();
    await otherPage.goto("/dashboard/analytics");
    await expectMetric(otherPage, "requests", "0");
    await expectMetric(otherPage, "views", "0");
    await expectMetric(otherPage, "conversion", "—");
    // Ni dodatni URL parametar ne daje pravo izbora tuđeg profila.
    const ownOnly = await otherContext.request.get(
      `/api/v1/analytics?days=30&therapistId=${therapist}`,
    );
    expect((await ownOnly.json()).totals.requests).toBe(0);
    const crossOrigin = await page.request.post(
      `/api/v1/analytics/profiles/${therapist}/view`,
      { headers: { Origin: "https://untrusted.example" }, data: {} },
    );
    expect(crossOrigin.status()).toBe(403);
  } finally {
    await therapistContext.close();
    await otherContext.close();
  }
});

// Greška ne smije izgledati kao nula; novi period i ponovni pokušaj imaju jasno čekanje.
test("analytics shows loading and a retry after a failed request", async ({
  page,
  context,
}) => {
  const data = await fixture();
  await signIn(context, data.emails[0]);
  await page.route("**/api/v1/analytics?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Test: analitika trenutno nije dostupna.",
      }),
    });
  });
  await page.goto("/dashboard/analytics");
  await expect(
    page.getByRole("status").filter({ hasText: "Učitavanje analitike" }),
  ).toBeVisible();
  await expect(
    page.locator(".analytics-page").getByRole("alert"),
  ).toContainText("Test: analitika trenutno nije dostupna.");
  await expect(page.getByTestId("analytics-views")).toHaveCount(0);
  await page.unroute("**/api/v1/analytics?*");
  await page
    .getByRole("button", { name: "Osvježi analitiku", exact: true })
    .click();
  await expectMetric(page, "views", "0");
  await expect(page.locator(".analytics-page").getByRole("alert")).toHaveCount(
    0,
  );
  await page
    .getByRole("combobox", { name: "Period", exact: true })
    .selectOption("90");
  await expectMetric(page, "requests", "0");
  await page.getByText("Pogledaj dnevne podatke", { exact: true }).click();
  await expect(
    page
      .getByRole("table", { name: "Radnje u izabranom periodu" })
      .getByRole("row"),
  ).toHaveCount(91);
});
