import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const origin = "http://127.0.0.1:3200";
const password = "Sigurna testna lozinka za ocjene!";
test.use({ actionTimeout: 15000 });
test.beforeAll(async () => {
  expect(
    (await database.query("SELECT current_schema() AS name")).rows[0].name,
  ).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
});
test.afterAll(async () => {
  await database.end();
});

/** Priprema sintetičke naloge i različite ishode bez izmjene stvarnih klijenata. */
async function fixture() {
  const hash = await hashPassword(password);
  const users: string[] = [];
  const emails: string[] = [];
  for (const role of ["THERAPIST", "CLIENT", "CLIENT"]) {
    const email = `rating-${randomUUID()}@example.test`;
    emails.push(email);
    users.push(
      (
        await database.query(
          "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES($1,$2,'Ocjena Test','Ocjena','Test','1990-01-01',$3,now(),'+38267123456') RETURNING id",
          [email, hash, role],
        )
      ).rows[0].id,
    );
  }
  const therapistId = (
    await database.query(
      "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city) VALUES($1,'Aaa Terapeut Ocjene','Psihoterapeut','Psychotherapist','Podgorica') RETURNING id",
      [users[0]],
    )
  ).rows[0].id;
  const serviceId = (
    await database.query(
      "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes) VALUES($1,'Seansa','Session',50) RETURNING id",
      [therapistId],
    )
  ).rows[0].id;
  const bookings: string[] = [];
  for (const [index, status] of [
    "CONFIRMED",
    "COMPLETED",
    "COMPLETED",
  ].entries()) {
    const clientIndex = index === 1 ? 2 : 1;
    bookings.push(
      (
        await database.query(
          `INSERT INTO booking_requests(client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status)
      VALUES($1,$2,$3,'Seansa',50,'Ocjena Test',$4,'+38267123456',now()+$5*interval '1 day',now()+$5*interval '1 day'+interval '50 minutes',$6) RETURNING id`,
          [
            users[clientIndex],
            therapistId,
            serviceId,
            emails[clientIndex],
            index === 2 ? 2 : -(index + 1),
            status,
          ],
        )
      ).rows[0].id,
    );
  }
  return { users, emails, therapistId, bookings };
}

/** Prijavljuje pravi nalog; autorizaciju dalje radi JWT kolačić browser konteksta. */
async function signIn(context: BrowserContext, email: string) {
  expect(
    (
      await context.request.post("/api/v1/auth/login", {
        headers: { Origin: origin },
        data: { email, password },
      })
    ).ok(),
  ).toBe(true);
}

// Proteklo vrijeme potvrđene seanse otvara ocjenu bez ručne oznake terapeuta.
test("clients rate finished sessions once and the public profile shows a numeric sum", async ({
  page,
  context,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(150000);
  const data = await fixture();
  const [firstBooking, secondBooking, futureBooking] = data.bookings;
  const path = `/api/v1/bookings/${firstBooking}/rating`;
  expect(
    (
      await request.post(path, {
        headers: { Origin: origin },
        data: { score: 5 },
      })
    ).status(),
  ).toBe(401);
  await signIn(context, data.emails[1]);
  await page.goto("/account");
  const card = page.locator(`#booking-${firstBooking}`);
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("group", { name: "Koliko ste zadovoljni ovom seansom?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Za ocjenjivanje/ }).click();
  await expect(page.locator(".client-booking-card")).toHaveCount(1);
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: /Svi termini/ }).click();
  expect(
    (
      await context.request.post(`/api/v1/bookings/${futureBooking}/rating`, {
        headers: { Origin: origin },
        data: { score: 5 },
      })
    ).status(),
  ).toBe(409);
  const therapistContext = await browser.newContext({ baseURL: origin });
  const otherClientContext = await browser.newContext({ baseURL: origin });
  try {
    await signIn(therapistContext, data.emails[0]);
    await signIn(otherClientContext, data.emails[2]);
    expect(
      (
        await therapistContext.request.post(path, {
          headers: { Origin: origin },
          data: { score: 5 },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await otherClientContext.request.post(path, {
          headers: { Origin: origin },
          data: { score: 5 },
        })
      ).status(),
    ).toBe(404);
    const rating = card.getByRole("region", { name: "Ocjena seanse" });
    await expect(rating).toBeVisible();
    await expect(
      rating.getByRole("button", { name: "Pošalji ocjenu", exact: true }),
    ).toBeDisabled();
    await rating.getByRole("radio", { name: "5", exact: true }).check();
    // Prva mrežna greška mora zadržati izbor i omogućiti ponovni pokušaj.
    await page.route(
      `**/api/v1/bookings/${firstBooking}/rating`,
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Testna greška čuvanja ocjene." }),
        });
      },
      { times: 1 },
    );
    await rating
      .getByRole("button", { name: "Pošalji ocjenu", exact: true })
      .click();
    await expect(rating.getByRole("alert")).toContainText("Testna greška");
    await expect(
      rating.getByRole("radio", { name: "5", exact: true }),
    ).toBeChecked();
    await page.route(
      `**/api/v1/bookings/${firstBooking}/rating`,
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.continue();
      },
    );
    await rating
      .getByRole("button", { name: "Pošalji ocjenu", exact: true })
      .click();
    await expect(rating.locator('form[aria-busy="true"]')).toBeVisible();
    await expect(
      rating.getByRole("radio", { name: "4", exact: true }),
    ).toBeDisabled();
    await expect(
      rating.getByText("Vaša ocjena: 5/5", { exact: true }),
    ).toBeVisible();
    await expect(
      rating.getByText("Ocjena je sačuvana.", { exact: true }),
    ).toBeVisible();
    await expect(
      rating.getByText("Ocjena je sačuvana.", { exact: true }),
    ).toBeHidden({ timeout: 6500 });
    await page.reload();
    await expect(
      card.getByText("Vaša ocjena: 5/5", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await database.query(
          "SELECT status FROM booking_requests WHERE id=$1",
          [firstBooking],
        )
      ).rows[0].status,
    ).toBe("CONFIRMED");
    expect(
      (
        await context.request.post(path, {
          headers: { Origin: origin },
          data: { score: 1 },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await context.request.post(path, {
          headers: { Origin: "https://other.example.test" },
          data: { score: 5 },
        })
      ).status(),
    ).toBe(403);
    const secondResponse = await otherClientContext.request.post(
      `/api/v1/bookings/${secondBooking}/rating`,
      { headers: { Origin: origin }, data: { score: 3 } },
    );
    expect(secondResponse.ok()).toBe(true);
    expect(secondResponse.headers()["cache-control"]).toContain("no-store");
    const profileResponse = await request.get(
      `/api/v1/therapists/${data.therapistId}`,
    );
    const profile = (await profileResponse.json()).therapist;
    expect(profile.ratingTotal).toBe(8);
    expect(profile.ratingCount).toBe(2);
    expect(JSON.stringify(profile)).not.toContain(data.emails[1]);
    expect(JSON.stringify(profile)).not.toContain(firstBooking);
    // Ista kartica mora prikazati stvarni zbir na početnoj i u katalogu, prije otvaranja profila.
    for (const listingPath of ["/", "/psychotherapy"]) {
      await page.goto(listingPath);
      const therapistCard = page.locator(".therapist-card").filter({
        has: page.locator(`a.card-name[href="/therapist/${data.therapistId}"]`),
      });
      await expect(
        therapistCard.locator(".card-rating-points strong"),
      ).toHaveText("8");
      await expect(
        therapistCard.getByRole("group", {
          name: "Ocjene klijenata",
          exact: true,
        }),
      ).toContainText("Ocijenjene seanse: 2");
      await expect(
        page
          .locator(".card-rating")
          .filter({ hasText: "Još nema ocjena" })
          .first(),
      ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(therapistCard.locator(".card-rating")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await therapistCard.screenshot({
        path: testInfo.outputPath(
          listingPath === "/"
            ? "rating-home-card-mobile.png"
            : "rating-directory-card-mobile.png",
        ),
      });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await page.goto(`/therapist/${data.therapistId}`);
    await expect(
      page.getByRole("heading", { name: "Ocjene klijenata", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".profile-rating > strong")).toHaveText("8");
    await expect(page.locator(".profile-rating")).toContainText(
      "Broj ocijenjenih seansi: 2",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".profile-rating")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("session-rating-profile-mobile.png"),
      fullPage: true,
    });
    await page.goto("/account");
    await expect(
      card.getByText("Vaša ocjena: 5/5", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    // Ispravka ishoda uklanja samo ovih pet bodova; povratak ne pravi novu ocjenu.
    expect(
      (
        await therapistContext.request.post(
          `/api/v1/bookings/${firstBooking}/respond`,
          { headers: { Origin: origin }, data: { action: "no-show" } },
        )
      ).ok(),
    ).toBe(true);
    expect(
      (
        await (
          await request.get(`/api/v1/therapists/${data.therapistId}`)
        ).json()
      ).therapist.ratingTotal,
    ).toBe(3);
    await page.reload();
    await expect(
      card.getByRole("region", { name: "Ocjena seanse" }),
    ).toHaveCount(0);
    expect(
      (
        await therapistContext.request.post(
          `/api/v1/bookings/${firstBooking}/respond`,
          { headers: { Origin: origin }, data: { action: "complete" } },
        )
      ).ok(),
    ).toBe(true);
    expect(
      (
        await (
          await request.get(`/api/v1/therapists/${data.therapistId}`)
        ).json()
      ).therapist.ratingTotal,
    ).toBe(8);
    expect(
      (
        await database.query(
          "SELECT count(*)::int AS count FROM session_ratings WHERE booking_id=$1",
          [firstBooking],
        )
      ).rows[0].count,
    ).toBe(1);
    // Prelazak vremena seanse mora otvoriti formular kroz postojeće osvježavanje, bez reload-a.
    await database.query(
      "UPDATE booking_requests SET status='CONFIRMED',start_at=now()-interval '60 minutes',end_at=now()-interval '10 minutes' WHERE id=$1",
      [futureBooking],
    );
    const automaticallyAvailable = page.locator(`#booking-${futureBooking}`);
    await expect(
      automaticallyAvailable.getByRole("region", {
        name: "Ocjena seanse",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Za ocjenjivanje/ }),
    ).toContainText("1");
    await automaticallyAvailable.screenshot({
      path: testInfo.outputPath("automatic-rating-options-mobile.png"),
    });
  } finally {
    await therapistContext.close();
    await otherClientContext.close();
  }
});
