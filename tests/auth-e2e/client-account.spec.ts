import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { addDays, dateKey, weekday } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const password = "Sigurna lozinka za pregled klijenta!";
const patientEmail = `client-overview-${randomUUID()}@example.test`;
const workingDate = addDays(dateKey(), 2);
const therapists: {
  id: string;
  email: string;
  serviceId: string;
  duration: number;
}[] = [];

// Podaci nastaju samo u izolovanoj šemi runnera; postojeći korisnici ostaju netaknuti.
test.beforeAll(async () => {
  expect(
    (await database.query("SELECT current_schema() AS name")).rows[0].name,
  ).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
  const passwordHash = await hashPassword(password);
  await database.query(
    "INSERT INTO users (email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,'Klijent Pregled','Klijent','Pregled','1990-01-01','CLIENT',now(),'+38267123456')",
    [patientEmail, passwordHash],
  );
  for (let index = 0; index < 2; index += 1) {
    const email = `overview-therapist-${randomUUID()}@example.test`;
    const name = index === 0 ? "Prvi Terapeut" : "Drugi Terapeut";
    const user = await database.query(
      "INSERT INTO users (email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,$3,$4,'Terapeut','1990-01-01','THERAPIST',now(),'+38267123456') RETURNING id",
      [email, passwordHash, name, name.split(" ")[0]],
    );
    const profile = await database.query(
      "INSERT INTO therapists (linked_user_id,full_name,title_mne,title_en,bio_mne,city,address) VALUES ($1,$2,'Psihoterapeut','Psychotherapist','Test biografija.','Podgorica','Ulica podrške 10') RETURNING id",
      [user.rows[0].id, name],
    );
    const duration = index === 0 ? 50 : 40;
    const service = await database.query(
      "INSERT INTO services (therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,'Individualna podrška','Individual support',$2,$3) RETURNING id",
      [profile.rows[0].id, duration, index === 0 ? 45 : null],
    );
    await database.query(
      "INSERT INTO availability_windows (therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,540,1020)",
      [profile.rows[0].id, weekday(workingDate)],
    );
    therapists.push({
      id: profile.rows[0].id,
      email,
      serviceId: service.rows[0].id,
      duration,
    });
  }
});

// Runner uklanja testnu šemu; zatvaramo samo konekcije ovog fajla.
test.afterAll(async () => {
  await database.end();
});

// Dva terapeuta i različiti statusi provjeravaju pregled, odluke klijenta i stvarno čuvanje profila.
test("client reviews therapists, filters sessions, responds to proposals and edits grouped profile", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(patientEmail);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(/\/psychotherapy$/);
  const created: string[] = [];
  for (const [therapistIndex, start] of [
    [0, 540],
    // Poslije seanse 09:00–09:50 korak od 15 minuta počinje od 09:50, pa je 11:05 dozvoljeno.
    [0, 665],
    [1, 600],
  ]) {
    const therapist = therapists[therapistIndex];
    const response = await page.request.post("/api/v1/bookings", {
      headers: { Origin: "http://127.0.0.1:3200" },
      data: {
        therapistId: therapist.id,
        serviceId: therapist.serviceId,
        duration: String(therapist.duration),
        date: workingDate,
        start: String(start),
        phone: "+38267123456",
      },
    });
    const result = await response.json();
    expect(response.ok(), result.message).toBe(true);
    created.push(result.booking.id);
  }
  const therapistContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
  });
  try {
    expect(
      (
        await therapistContext.request.post("/api/v1/auth/login", {
          headers: { Origin: "http://127.0.0.1:3200" },
          data: { email: therapists[0].email, password },
        })
      ).ok(),
    ).toBe(true);
    for (const [bookingId, action] of [
      [created[0], "confirm"],
      [created[1], "propose"],
    ]) {
      expect(
        (
          await therapistContext.request.post(
            `/api/v1/bookings/${bookingId}/respond`,
            {
              headers: { Origin: "http://127.0.0.1:3200" },
              data: { action, date: workingDate, start: "785" },
            },
          )
        ).ok(),
      ).toBe(true);
    }
    await page.goto("/account");
    await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
    await page
      .locator(".account-dropdown")
      .getByRole("link", { name: "Moji termini", exact: true })
      .click();
    await expect(page.locator(".account-dropdown")).toHaveCount(0);
    const list = page.locator(".client-bookings");
    const cards = list.locator(".booking-card");
    await expect(cards).toHaveCount(3);
    // Različiti statusi ne preskaču redosljed: 09:00, 10:00, pa predlog u 13:05.
    for (const [index, bookingId] of [
      created[0],
      created[2],
      created[1],
    ].entries())
      await expect(cards.nth(index)).toHaveAttribute(
        "data-booking-id",
        bookingId,
      );
    await expect(list).toContainText("Prvi Terapeut");
    await expect(list).toContainText("Drugi Terapeut");
    await expect(list).toContainText("Na upit");
    const confirmed = list.locator(`[data-booking-id="${created[0]}"]`);
    await expect(confirmed).toContainText("09:00–09:50");
    await expect(confirmed).toContainText("50 min");
    await expect(confirmed).toContainText("Ulica podrške 10");
    await expect(
      confirmed.getByRole("link", { name: "Profil terapeuta", exact: true }),
    ).toHaveAttribute("href", `/therapist/${therapists[0].id}`);
    const next = page.getByRole("complementary", {
      name: "Sljedeći potvrđeni termin",
      exact: true,
    });
    await expect(next).toContainText("Prvi Terapeut");
    const filters = list.getByRole("group", {
      name: "Prikaz zahtjeva",
      exact: true,
    });
    await filters.getByRole("button", { name: /^Na čekanju/ }).click();
    await expect(cards).toHaveCount(2);
    await next
      .getByRole("link", { name: "Detalji termina", exact: true })
      .click();
    await expect(cards).toHaveCount(3);
    await expect(
      filters.getByRole("button", { name: /^Svi termini/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: testInfo.outputPath("client-account-desktop.png"),
      fullPage: true,
    });
    const proposed = list.locator(`[data-booking-id="${created[1]}"]`);
    await expect(proposed).toContainText("13:05–13:55");
    await proposed
      .getByRole("button", { name: "Odbij termin", exact: true })
      .click();
    await expect(proposed.locator(".status")).toContainText("Odbijeno");
    await filters.getByRole("button", { name: /^Istorija/ }).click();
    await expect(cards).toHaveCount(1);
    await proposed.getByText("Istorija zahtjeva", { exact: true }).click();
    await expect(proposed).toContainText("Novi termin je odbijen");
    await filters.getByRole("button", { name: /^Potvrđeni termini/ }).click();
    await expect(cards).toHaveCount(1);
    await confirmed
      .getByRole("button", { name: "Otkaži termin", exact: true })
      .click();
    await expect(next).toHaveCount(0);
    await filters.getByRole("button", { name: /^Istorija/ }).click();
    await expect(cards).toHaveCount(2);
    await filters.getByRole("button", { name: /^Svi termini/ }).click();
    const profile = page.locator("#my-profile");
    await profile
      .getByRole("button", { name: "Uredi profil", exact: true })
      .click();
    await expect(profile.locator(".profile-summary-grid")).toHaveCount(0);
    await expect(
      profile.getByRole("group", { name: "Lični podaci", exact: true }),
    ).toBeVisible();
    await profile
      .getByLabel("Grad (opcionalno)", { exact: true })
      .fill("Nesačuvano");
    await profile
      .getByRole("button", { name: "Odustani", exact: true })
      .click();
    await expect(profile).not.toContainText("Nesačuvano");
    await profile
      .getByRole("button", { name: "Uredi profil", exact: true })
      .click();
    await expect(
      profile.getByLabel("Grad (opcionalno)", { exact: true }),
    ).toHaveValue("");
    await profile.getByLabel("Grad (opcionalno)", { exact: true }).fill("Bar");
    await profile
      .getByLabel("Adresa (opcionalno)", { exact: true })
      .fill("Nova ulica 15");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await profile.screenshot({
      path: testInfo.outputPath("client-edit-profile-mobile.png"),
    });
    await profile
      .getByRole("button", { name: "Sačuvaj profil", exact: true })
      .click();
    await expect(profile.locator(".save-feedback-success")).toHaveText(
      "Profil je sačuvan.",
    );
    await expect(profile.locator(".profile-summary-grid")).toContainText(
      "Nova ulica 15",
    );
    const account = (await (await page.request.get("/api/v1/auth/me")).json())
      .user;
    expect(account).toMatchObject({
      city: "Bar",
      address: "Nova ulica 15",
      email: patientEmail,
    });
    await page.reload();
    await expect(profile.locator(".profile-summary-grid")).toContainText(
      "Nova ulica 15",
    );
    // Nedostupan javni katalog ne smije sakriti privatne termine i sačuvanu istoriju.
    await page.route("**/api/v1/therapists", async (route) => {
      await route.fulfill({ status: 503 });
    });
    await page.reload();
    await expect(cards).toHaveCount(3);
    await expect(list).toContainText("Drugi Terapeut");
    await expect(list.locator(".client-therapist-placeholder")).toHaveCount(3);
    await page.unroute("**/api/v1/therapists");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: testInfo.outputPath("client-account-mobile.png"),
      fullPage: true,
    });
  } finally {
    await therapistContext.close();
  }
});
