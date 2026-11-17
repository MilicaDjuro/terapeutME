import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { addDays, dateKey } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";
import { chooseTime } from "./dashboard-helpers";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const password = "Sigurna lozinka za stalne termine!";
const origin = "http://127.0.0.1:3200";
let passwordHash = "";

// Podaci nastaju samo u izolovanoj šemi; ne koriste se korisnikovi klijenti ili rezervacije.
test.beforeAll(async () => {
  expect(
    (await database.query("SELECT current_schema() AS name")).rows[0].name,
  ).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
  passwordHash = await hashPassword(password);
});
// Runner uklanja šemu; ovaj fajl zatvara svoje konekcije.
test.afterAll(async () => {
  await database.end();
});

/** Priprema terapeuta, pacijenta i radno vrijeme svakog dana za jedan nezavisan scenario. */
async function fixture() {
  const emails = [
    `series-therapist-${randomUUID()}@example.test`,
    `series-client-${randomUUID()}@example.test`,
  ];
  const userIds: string[] = [];
  for (const [index, role] of ["THERAPIST", "CLIENT"].entries()) {
    const result = await database.query(
      "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,'Stalni Test','Stalni','Test','1990-01-01',$3,now(),'+38267123456') RETURNING id",
      [emails[index], passwordHash, role],
    );
    userIds.push(result.rows[0].id);
  }
  const therapistId = (
    await database.query(
      "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city) VALUES ($1,'Terapeut Serija','Psihoterapeut','Psychotherapist','Podgorica') RETURNING id",
      [userIds[0]],
    )
  ).rows[0].id;
  const serviceId = (
    await database.query(
      "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,'Podrška 50','Support 50',50,45) RETURNING id",
      [therapistId],
    )
  ).rows[0].id;
  for (let day = 0; day < 7; day++)
    await database.query(
      "INSERT INTO availability_windows(therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,540,1020)",
      [therapistId, day],
    );
  return { emails, userIds, therapistId, serviceId };
}

/** Prijavljuje stvarni nalog kroz formular i čeka odredište prema ulozi. */
async function signIn(page: Page, email: string, therapist: boolean) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(therapist ? /\/dashboard$/ : /\/psychotherapy$/);
}

for (const interval of [7, 14]) {
  // Pravi seriju kroz checkbox i potvrđuje da pojedinačna promjena/otkazivanje ne pomjera ritam.
  test(`recurring ${interval}-day series stays visible, permits one-session changes and stops safely`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120000);
    const data = await fixture();
    const therapistContext = await browser.newContext({ baseURL: origin });
    const therapist = await therapistContext.newPage();
    try {
      await signIn(page, data.emails[1], false);
      await signIn(therapist, data.emails[0], true);
      const firstDate = addDays(dateKey(), 2);
      const created = await page.request.post("/api/v1/bookings", {
        headers: { Origin: origin },
        data: {
          therapistId: data.therapistId,
          serviceId: data.serviceId,
          date: firstDate,
          start: "540",
          phone: "+38267123456",
        },
      });
      expect(created.ok()).toBe(true);
      const anchorId = (await created.json()).booking.id;
      expect(
        (
          await therapist.request.post(`/api/v1/bookings/${anchorId}/respond`, {
            headers: { Origin: origin },
            data: { action: "confirm" },
          })
        ).ok(),
      ).toBe(true);
      await therapist.goto("/dashboard");
      const anchor = therapist.locator(`[data-booking-id="${anchorId}"]`);
      await anchor
        .getByRole("checkbox", {
          name: "Stalni termin za ovog klijenta",
          exact: true,
        })
        .check();
      await anchor
        .getByRole("combobox", { name: "Ponavljanje", exact: true })
        .selectOption(String(interval));
      await anchor
        .getByRole("button", { name: "Sačuvaj stalni termin", exact: true })
        .click();
      const expectedCount = Math.floor(88 / interval) + 1;
      await expect(therapist.locator(".server-booking-card")).toHaveCount(
        expectedCount,
      );
      await expect(anchor).toContainText(
        interval === 7
          ? "Stalni termin — svake sedmice"
          : "Stalni termin — svake druge sedmice",
      );
      await page.goto("/account");
      await expect(page.locator(".server-booking-card")).toHaveCount(
        expectedCount,
      );
      const before = (await (await page.request.get("/api/v1/bookings")).json())
        .bookings;
      const chosen = before[1];
      const cancelled = before[2];
      const chosenCard = therapist.locator(`[data-booking-id="${chosen.id}"]`);
      await chosenCard
        .getByRole("button", { name: "Predloži drugi termin", exact: true })
        .click();
      await chosenCard
        .getByLabel("Novi datum", { exact: true })
        .fill(addDays(chosen.date, 1));
      await chooseTime(
        chosenCard.locator(".booking-action-panel"),
        "Novo vrijeme",
        "10:00",
      );
      await chosenCard
        .getByRole("button", { name: "Pošalji predlog", exact: true })
        .click();
      await expect(chosenCard.locator(".status")).toContainText(
        "Čeka klijenta",
      );
      const clientCard = page.locator(`[data-booking-id="${chosen.id}"]`);
      await clientCard
        .getByRole("button", { name: "Prihvati termin", exact: true })
        .click();
      await expect(clientCard.locator(".status")).toContainText("Potvrđeno");
      await expect(clientCard).toContainText("Izmijenjena je samo ova seansa");
      const cancelCard = page.locator(`[data-booking-id="${cancelled.id}"]`);
      await cancelCard
        .getByRole("button", { name: "Otkaži termin", exact: true })
        .click();
      await expect(cancelCard.locator(".status")).toContainText("Otkazano");
      const after = (await (await page.request.get("/api/v1/bookings")).json())
        .bookings;
      expect(after).toHaveLength(expectedCount);
      for (const booking of before.filter(
        (booking: { id: string }) =>
          ![chosen.id, cancelled.id].includes(booking.id),
      )) {
        expect(
          after.find((updated: { id: string }) => updated.id === booking.id),
        ).toMatchObject({
          date: booking.date,
          start: booking.start,
          status: booking.status,
        });
      }
      const busy = await (
        await page.request.get(
          `/api/v1/therapists/${data.therapistId}/slots?duration=50&date=${before[3].date}`,
        )
      ).json();
      expect(
        busy.slots.find((slot: { start: number }) => slot.start === 540)
          .available,
      ).toBe(false);
      await therapist.reload();
      const overview = therapist.locator(".recurring-overview");
      await overview.locator(":scope > summary").click();
      await therapist.setViewportSize({ width: 390, height: 844 });
      expect(
        await therapist.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      await overview.screenshot({
        path: testInfo.outputPath(`recurring-${interval}-mobile.png`),
      });
      await overview
        .getByRole("button", { name: "Zaustavi seriju", exact: true })
        .click();
      await overview
        .getByRole("button", {
          name: "Potvrdi zaustavljanje serije",
          exact: true,
        })
        .click();
      await expect(overview).toContainText("Zaustavljena serija");
      await page.reload();
      const stopped = await (await page.request.get("/api/v1/bookings")).json();
      expect(
        stopped.bookings.every(
          (booking: { status: string }) => booking.status === "CANCELLED",
        ),
      ).toBe(true);
      expect(stopped.series[0].active).toBe(false);
      await therapist.reload();
      expect(
        (await (await therapist.request.get("/api/v1/bookings")).json())
          .bookings,
      ).toHaveLength(expectedCount);
    } finally {
      await therapistContext.close();
    }
  });
}

// Server poslije restarta označava neradni datum, a terapeut u browseru zakazuje samo njegovu zamjenu.
test("therapist resolves a closed recurring date without moving the other sessions", async ({
  page,
}) => {
  test.setTimeout(90000);
  const data = await fixture();
  const anchorId = randomUUID();
  const seriesId = randomUUID();
  const firstDate = addDays(dateKey(), -13);
  const closedDate = addDays(dateKey(), 1);
  const setup = await database.connect();
  try {
    await setup.query("BEGIN");
    await setup.query(
      `INSERT INTO booking_requests(id,client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,price_eur_snapshot,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status)
    VALUES ($1,$2,$3,$4,'Podrška 50',50,45,'Stalni Test',$5,'+38267123456',($6::date+interval '9 hours') AT TIME ZONE 'Europe/Podgorica',($6::date+interval '9 hours 50 minutes') AT TIME ZONE 'Europe/Podgorica','COMPLETED')`,
      [
        anchorId,
        data.userIds[1],
        data.therapistId,
        data.serviceId,
        data.emails[1],
        firstDate,
      ],
    );
    await setup.query(
      "INSERT INTO booking_series(id,therapist_id,client_user_id,anchor_booking_id,interval_days,first_date,start_minute,next_date) VALUES ($1,$2,$3,$4,14,$5,540,$6)",
      [
        seriesId,
        data.therapistId,
        data.userIds[1],
        anchorId,
        firstDate,
        closedDate,
      ],
    );
    await setup.query(
      "UPDATE booking_requests SET series_id=$2,occurrence_date=$3 WHERE id=$1",
      [anchorId, seriesId, firstDate],
    );
    await setup.query(
      "INSERT INTO availability_dates(therapist_id,work_date,is_working) VALUES ($1,$2,false)",
      [data.therapistId, closedDate],
    );
    await setup.query("COMMIT");
  } catch (failure) {
    await setup.query("ROLLBACK");
    throw failure;
  } finally {
    setup.release();
  }
  await signIn(page, data.emails[0], true);
  const overview = page.locator(".recurring-overview");
  await expect(overview).toContainText("Potrebna provjera datuma");
  await overview.locator(":scope > summary").click();
  await expect(overview.locator(".recurring-issue")).toHaveCount(1);
  const before = await (await page.request.get("/api/v1/bookings")).json();
  await overview.getByText("Izaberi zamjenski termin", { exact: true }).click();
  await overview
    .getByLabel("Zamjenski datum", { exact: true })
    .fill(addDays(closedDate, 1));
  await chooseTime(overview, "Zamjensko vrijeme", "10:00");
  await overview
    .getByRole("button", { name: "Sačuvaj zamjenski termin", exact: true })
    .click();
  await expect(overview.locator(".recurring-issue")).toHaveCount(0);
  const after = await (await page.request.get("/api/v1/bookings")).json();
  expect(after.bookings).toHaveLength(before.bookings.length + 1);
  expect(
    after.bookings.find(
      (booking: { date: string }) => booking.date === addDays(closedDate, 1),
    ),
  ).toMatchObject({ start: 600, series: { originalDate: closedDate } });
});
