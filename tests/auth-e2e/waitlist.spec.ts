import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { addDays, dateKey } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";
import { chooseTime } from "./dashboard-helpers";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const origin = "http://127.0.0.1:3200";
const password = "Sigurna lozinka za listu cekanja!";
let passwordHash = "";

// Testovi koriste izolovanu šemu i samo lokalni SMTP, bez stvarnih korisnika i emailova.
test.beforeAll(async () => {
  expect(
    (await database.query("SELECT current_schema() AS name")).rows[0].name,
  ).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
  passwordHash = await hashPassword(password);
});
// Testni runner uklanja šemu, a test zatvara samo svoje konekcije.
test.afterAll(async () => {
  await database.end();
});

/** Pravi terapeuta, tri klijenta i jedan zauzet termin u nezavisnom testnom kalendaru. */
async function fixture() {
  const userIds: string[] = [];
  const emails: string[] = [];
  for (const [index, role] of [
    "THERAPIST",
    "CLIENT",
    "CLIENT",
    "CLIENT",
  ].entries()) {
    const email = `waitlist-${randomUUID()}@example.test`;
    const user = (
      await database.query(
        "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,$3,'Lista','Test','1990-01-01',$4,now(),'+38267123456') RETURNING id",
        [email, passwordHash, `Lista Test ${index}`, role],
      )
    ).rows[0];
    emails.push(email);
    userIds.push(user.id);
  }
  const therapistId = (
    await database.query(
      "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city) VALUES ($1,'Terapeut Lista','Psihoterapeut','Psychotherapist','Podgorica') RETURNING id",
      [userIds[0]],
    )
  ).rows[0].id;
  const serviceId = (
    await database.query(
      "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,'Seansa 50','Session 50',50,45) RETURNING id",
      [therapistId],
    )
  ).rows[0].id;
  for (let day = 0; day < 7; day++)
    await database.query(
      "INSERT INTO availability_windows(therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,540,1020)",
      [therapistId, day],
    );
  const date = addDays(dateKey(), 2);
  const originalId = randomUUID();
  await database.query(
    `INSERT INTO booking_requests(id,client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,price_eur_snapshot,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status,confirmed_at)
   VALUES ($1,$2,$3,$4,'Seansa 50',50,45,'Zauzet Test',$5,'+38267123456',($6::date+interval '9 hours') AT TIME ZONE 'Europe/Podgorica',($6::date+interval '9 hours 50 minutes') AT TIME ZONE 'Europe/Podgorica','CONFIRMED',now())`,
    [originalId, userIds[1], therapistId, serviceId, emails[1], date],
  );
  return { emails, userIds, therapistId, serviceId, date, originalId };
}

/** Prijavljuje stvarni nalog kroz postojeći JWT formular. */
async function signIn(page: Page, email: string, therapist = false) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(therapist ? /\/dashboard$/ : /\/psychotherapy$/);
}

/** Iz zauzetog dugmeta otvara tačan izbor i čuva prijavu uz izričitu saglasnost. */
async function joinExact(
  page: Page,
  data: Awaited<ReturnType<typeof fixture>>,
) {
  await page.goto(`/therapist/${data.therapistId}/book`);
  await page.getByRole("button", { name: /Seansa 50 · 50 min/ }).click();
  await page.getByLabel("Datum seanse", { exact: true }).fill(data.date);
  await expect(
    page.locator(".time-options button").filter({ hasText: /^09:00/ }),
  ).toBeDisabled();
  await page.locator(".waitlist-busy-times > summary").click();
  await page
    .getByRole("button", { name: "Čekaj 09:00–09:50", exact: true })
    .click();
  const form = page.locator(".waitlist-form");
  await expect(form.getByLabel("Željeni datum", { exact: true })).toHaveValue(
    data.date,
  );
  await form
    .getByLabel("Telefon za listu čekanja", { exact: true })
    .fill("+38267123456");
  await form.getByRole("checkbox").check();
  await form
    .getByRole("button", { name: "Pridruži se listi čekanja", exact: true })
    .click();
  await expect(
    form.getByRole("heading", { name: "Na listi ste čekanja.", exact: true }),
  ).toBeVisible();
}

/** Čeka SMTP poruku samo za testnu adresu i dodijeljenu rezervaciju. */
async function expectEmail(
  request: APIRequestContext,
  address: string,
  bookingId: string,
  accountPath: string,
) {
  await expect
    .poll(
      async () => {
        const inbox = await (
          await request.get("http://127.0.0.1:8025/api/v1/messages?limit=100")
        ).json();
        for (const message of inbox.messages) {
          if (
            !message.Subject.includes("liste čekanja") ||
            !message.To.some(
              (recipient: { Address: string }) => recipient.Address === address,
            )
          )
            continue;
          const details = await (
            await request.get(
              `http://127.0.0.1:8025/api/v1/message/${message.ID}`,
            )
          ).json();
          if (
            details.Text.includes(`${accountPath}#booking-${bookingId}`) &&
            details.Text.includes("Seansa je potvrđena") &&
            details.Text.includes("09:00–09:50")
          )
            return true;
        }
        return false;
      },
      { timeout: 20000 },
    )
    .toBe(true);
}

// Dvije stvarne sesije čekaju isti termin; otkazivanje ga u istoj transakciji dodjeljuje prvom klijentu.
test("first waitlisted client gets a confirmed session and both parties receive email", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120000);
  const data = await fixture();
  const secondContext = await browser.newContext({ baseURL: origin });
  const ownerContext = await browser.newContext({ baseURL: origin });
  const second = await secondContext.newPage();
  const owner = await ownerContext.newPage();
  try {
    await signIn(page, data.emails[2]);
    await signIn(second, data.emails[3]);
    await signIn(owner, data.emails[0], true);
    await joinExact(page, data);
    await joinExact(second, data);
    await page.goto("/account");
    const overview = page.locator(".waitlist-overview");
    await overview.locator(":scope > summary").click();
    await expect(overview).toContainText("Čeka oslobađanje termina");
    const initial = await (await page.request.get("/api/v1/bookings")).json();
    const entryId = initial.waitlist[0].id;
    expect(
      (
        await second.request.post(`/api/v1/waitlist/${entryId}/cancel`, {
          headers: { Origin: origin },
          data: {},
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await owner.request.post("/api/v1/waitlist", {
          headers: { Origin: origin },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await overview.screenshot({
      path: testInfo.outputPath("waitlist-mobile.png"),
    });
    expect(
      (
        await owner.request.post(
          `/api/v1/bookings/${data.originalId}/respond`,
          { headers: { Origin: origin }, data: { action: "cancel" } },
        )
      ).ok(),
    ).toBe(true);
    await expect(overview).toContainText("Termin je dodijeljen");
    const updated = await (await page.request.get("/api/v1/bookings")).json();
    const bookingId = updated.waitlist[0].bookingId;
    expect(
      updated.bookings.find(
        (booking: { id: string }) => booking.id === bookingId,
      ).status,
    ).toBe("CONFIRMED");
    await expect(
      page.locator(`[data-booking-id="${bookingId}"] .status`),
    ).toContainText("Potvrđeno");
    const secondState = await (
      await second.request.get("/api/v1/bookings")
    ).json();
    expect(secondState.waitlist[0].status).toBe("WAITING");
    expect(secondState.bookings).toHaveLength(0);
    await expectEmail(request, data.emails[2], bookingId, "/account");
    await expectEmail(request, data.emails[0], bookingId, "/dashboard");
    await owner.reload();
    await expect(
      owner.locator(`[data-booking-id="${bookingId}"] .status`),
    ).toContainText("Potvrđeno");
    await second.goto("/account");
    const secondOverview = second.locator(".waitlist-overview");
    await secondOverview.locator(":scope > summary").click();
    await secondOverview
      .getByRole("button", { name: "Napusti listu čekanja", exact: true })
      .click();
    await expect(secondOverview).toContainText("Prijava je povučena");
  } finally {
    await secondContext.close();
    await ownerContext.close();
  }
});

// Fleksibilni izbor obuhvata dane i cijelo trajanje seanse; slobodan izbor se odmah potvrđuje.
test("client chooses preferred weekdays and a time range for one automatic session", async ({
  page,
}) => {
  test.setTimeout(90000);
  const data = await fixture();
  await signIn(page, data.emails[2]);
  await page.goto(`/therapist/${data.therapistId}/book`);
  await page.getByRole("button", { name: /Seansa 50 · 50 min/ }).click();
  await page.getByLabel("Datum seanse", { exact: true }).fill(data.date);
  const form = page.locator(".waitlist-form");
  await form.locator(":scope > summary").click();
  await form
    .getByRole("combobox", { name: "Želim da čekam", exact: true })
    .selectOption("flexible");
  await form.getByLabel("Do datuma", { exact: true }).fill(data.date);
  // Poslije zauzetog 09:00–09:50 ponuđeni počeci idu od 09:50 u koracima od 15 minuta.
  await chooseTime(form, "Najraniji početak", "10:05");
  await chooseTime(form, "Najkasniji završetak", "10:55");
  await form
    .getByLabel("Telefon za listu čekanja", { exact: true })
    .fill("+38267123456");
  await form.locator('input[name="consent"]').check();
  await form
    .getByRole("button", { name: "Pridruži se listi čekanja", exact: true })
    .click();
  await expect(
    form.getByRole("heading", {
      name: "Termin vam je dodijeljen i potvrđen.",
      exact: true,
    }),
  ).toBeVisible();
  const response = await (await page.request.get("/api/v1/bookings")).json();
  expect(response.bookings).toHaveLength(1);
  expect(response.bookings[0]).toMatchObject({
    date: data.date,
    start: 605,
    end: 655,
    status: "CONFIRMED",
  });
});
