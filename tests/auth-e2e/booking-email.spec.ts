import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { addDays, dateKey } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";
import { chooseTime } from "./dashboard-helpers";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const patientEmail = `booking-mail-patient-${randomUUID()}@example.test`;
const therapistEmail = `booking-mail-therapist-${randomUUID()}@example.test`;
const password = "Sigurna lozinka za booking email test!";
let therapistId = "";

// Test šalje samo lokalne Mailpit poruke i koristi novu šemu, bez stvarnih korisnika.
test.beforeAll(async () => {
  expect(
    (await database.query("SELECT current_schema() AS name")).rows[0].name,
  ).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
  const passwordHash = await hashPassword(password);
  for (const [email, role] of [
    [patientEmail, "CLIENT"],
    [therapistEmail, "THERAPIST"],
  ]) {
    const user = await database.query(
      "INSERT INTO users (email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,'Email Test','Email','Test','1990-01-01',$3,now(),'+38267123456') RETURNING id",
      [email, passwordHash, role],
    );
    if (role === "THERAPIST") {
      therapistId = (
        await database.query(
          "INSERT INTO therapists (linked_user_id,full_name,title_mne,title_en,bio_mne,city,address) VALUES ($1,'Email Terapeut','Psihoterapeut','Psychotherapist','Test biografija.','Podgorica','Test ulica 1') RETURNING id",
          [user.rows[0].id],
        )
      ).rows[0].id;
      await database.query(
        "INSERT INTO services (therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,'Seansa 50','Session 50',50,45)",
        [therapistId],
      );
      for (let day = 0; day < 7; day += 1)
        await database.query(
          "INSERT INTO availability_windows (therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,540,1020)",
          [therapistId, day],
        );
    }
  }
});

// Runner uklanja testnu šemu; lokalne poruke ostaju dostupne za pregled testa.
test.afterAll(async () => {
  await database.end();
});

/** Prijavljuje nezavisan browser nalog, kao korisnik koji odgovara na primljeni email. */
async function signIn(page: Page, email: string, therapist = false) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(therapist ? /\/dashboard$/ : /\/psychotherapy$/);
}

/** Čeka stvarnu SMTP poruku za jednu testnu adresu, bez fiksnog sleep-a ili čitanja tuđih poruka. */
async function receivedNotification(
  request: APIRequestContext,
  address: string,
  subject: string,
  bookingId: string,
) {
  let text = "";
  await expect
    .poll(
      async () => {
        const inbox = await (
          await request.get("http://127.0.0.1:8025/api/v1/messages?limit=100")
        ).json();
        for (const message of inbox.messages) {
          if (
            !message.Subject.includes(subject) ||
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
          if (details.Text.includes(`#booking-${bookingId}`)) {
            text = details.Text;
            return true;
          }
        }
        return false;
      },
      { timeout: 20000 },
    )
    .toBe(true);
  return text;
}

/** Šalje zahtjev kroz stvarni formular; vraća ID iz privatne liste, ne iz javnog kalendara. */
async function bookSession(page: Page, date: string) {
  await page.goto(`/therapist/${therapistId}/book`);
  await page.getByRole("button", { name: /Seansa 50 · 50 min/ }).click();
  await page.getByLabel("Datum seanse", { exact: true }).fill(date);
  await page
    .locator(".time-options button")
    .filter({ hasText: /^09:00/ })
    .click();
  await page.getByLabel("Broj telefona", { exact: true }).fill("+38267123456");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Pošalji zahtjev", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Zahtjev je poslat.", exact: true }),
  ).toBeVisible();
  const response = await (await page.request.get("/api/v1/bookings")).json();
  return response.bookings.find(
    (booking: { date: string }) => booking.date === date,
  ).id as string;
}

// Aplikacija ostaje izvor stanja: email samo obavještava i vodi na isti zahtjev u aplikaciji.
test("booking requests and therapist replies reach Mailpit and stay visible in both accounts", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(120000);
  const therapistContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
  });
  const therapist = await therapistContext.newPage();
  try {
    await signIn(page, patientEmail);
    await signIn(therapist, therapistEmail, true);
    const created: string[] = [];
    for (const [index, action] of ["confirm", "decline", "propose"].entries()) {
      const date = addDays(dateKey(), index + 2);
      const id = await bookSession(page, date);
      created.push(id);
      const requestText = await receivedNotification(
        request,
        therapistEmail,
        "novi zahtjev",
        id,
      );
      expect(requestText).toContain("09:00–09:50");
      expect(requestText).toContain("Seansa 50");
      expect(requestText).toContain("Email Test");
      expect(requestText).toContain(`/dashboard#booking-${id}`);
      await therapist.goto(`/dashboard#booking-${id}`);
      const card = therapist.locator(`[data-booking-id="${id}"]`);
      await expect(card.locator(".status")).toContainText("Čeka terapeuta");
      if (action === "propose") {
        await card
          .getByRole("button", { name: "Predloži drugi termin", exact: true })
          .click();
        const form = card.locator("form");
        await form
          .getByLabel("Novi datum", { exact: true })
          .fill(addDays(date, 7));
        await chooseTime(form, "Novo vrijeme", "11:00");
        await form
          .getByRole("button", { name: "Pošalji predlog", exact: true })
          .click();
      } else {
        await card
          .getByRole("button", {
            name: action === "confirm" ? "Potvrdi" : "Odbij",
            exact: true,
          })
          .click();
      }
      const subject =
        action === "confirm"
          ? "termin je potvrđen"
          : action === "decline"
            ? "termin je odbijen"
            : "predložen je novi termin";
      const reply = await receivedNotification(
        request,
        patientEmail,
        subject,
        id,
      );
      expect(reply).toContain("Email Terapeut");
      expect(reply).toContain(`/account#booking-${id}`);
      if (action === "propose") {
        expect(reply).toContain("11:00–11:50");
        expect(reply).toContain("još nije potvrđena");
        expect(reply).toContain(`${date} u 09:00`);
      }
      await page.goto(`/account#booking-${id}`);
      const patientCard = page.locator(`[data-booking-id="${id}"]`);
      await expect(patientCard).toContainText("Email Terapeut");
      await expect(patientCard.locator(".status")).toContainText(
        action === "confirm"
          ? "Potvrđeno"
          : action === "decline"
            ? "Odbijeno"
            : "Čeka klijenta",
      );
      if (action === "propose") {
        // Potvrđeni raniji datum ima prednost nad kasnijim predlogom kod obje uloge.
        for (const accountPage of [page, therapist]) {
          const cards = accountPage.locator(".server-bookings .booking-card");
          for (const [position, bookingId] of [
            created[0],
            id,
            created[1],
          ].entries())
            await expect(cards.nth(position)).toHaveAttribute(
              "data-booking-id",
              bookingId,
            );
        }
        const beforeAcceptance = await (
          await page.request.get("/api/v1/bookings")
        ).json();
        const proposalEvents = beforeAcceptance.bookings.find(
          (booking: { id: string }) => booking.id === id,
        ).events;
        await patientCard
          .getByRole("button", { name: "Prihvati termin", exact: true })
          .click();
        await expect(patientCard.locator(".status")).toContainText("Potvrđeno");
        await receivedNotification(
          request,
          therapistEmail,
          "klijent je prihvatio",
          id,
        );

        // Poslije ponovnog čitanja baze istorija razlikuje stari A od prihvaćenog B.
        for (const accountPage of [page, therapist]) {
          await accountPage.reload();
          const acceptedCard = accountPage.locator(`[data-booking-id="${id}"]`);
          await acceptedCard
            .getByText("Istorija zahtjeva", { exact: true })
            .click();
          const history = acceptedCard.locator(".booking-history-list");
          const proposal = history
            .locator("li")
            .filter({ hasText: "Terapeut je predložio novi termin" });
          const acceptance = history
            .locator("li")
            .filter({ hasText: "Novi termin je prihvaćen" });
          await expect(proposal).toContainText("Prethodni termin:");
          await expect(proposal).toContainText("09:00");
          await expect(acceptance).toContainText("Prihvaćeni termin:");
          await expect(acceptance).toContainText("11:00");
          await expect(acceptance).not.toContainText("Prethodni termin:");
          await expect(
            accountPage.locator(".server-bookings .booking-card").first(),
          ).toHaveAttribute("data-booking-id", created[0]);
        }
        const afterAcceptance = await (
          await page.request.get("/api/v1/bookings")
        ).json();
        const acceptedEvents = afterAcceptance.bookings.find(
          (booking: { id: string }) => booking.id === id,
        ).events;
        expect(acceptedEvents.slice(0, proposalEvents.length)).toEqual(
          proposalEvents,
        );
        expect(acceptedEvents.at(-1)).toMatchObject({
          action: "ACCEPT_ALTERNATIVE",
          previousDate: addDays(date, 7),
          previousStart: 660,
        });
      }
    }
    await expect
      .poll(
        async () =>
          (
            await database.query(
              "SELECT count(*) FROM notification_outbox WHERE recipient_user_id IN (SELECT id FROM users WHERE email IN ($1,$2)) AND sent_at IS NOT NULL",
              [patientEmail, therapistEmail],
            )
          ).rows[0].count,
      )
      .toBe("7");
    expect(
      (
        await database.query(
          "SELECT count(*) FROM booking_requests WHERE therapist_id=$1",
          [therapistId],
        )
      ).rows[0].count,
    ).toBe("3");
  } finally {
    await therapistContext.close();
  }
});
