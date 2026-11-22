import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { addDays, dateKey, weekday } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";
import { openScheduleSections } from "./dashboard-helpers";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const password = "Testna sigurna lozinka za video!";
let passwordHash = "";
// Vještački uređaji pripadaju samo browser testu; nijedan test ne uključuje stvarnu kameru računara.
test.use({
  actionTimeout: 15000,
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["camera", "microphone"],
});
test.beforeAll(async () => {
  expect(
    (await database.query("SELECT current_schema() AS name")).rows[0].name,
  ).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
  passwordHash = await hashPassword(password);
});
test.afterAll(async () => {
  await database.end();
});

test(
  "waiting room stays outside Daily until both are ready and the therapist starts",
  { skip: process.env.AUTH_E2E_LOBBY !== "1" },
  async ({ page, browser }, testInfo) => {
    test.setTimeout(120000);
    const data = await fixture();
    const clientContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3200",
      permissions: ["camera", "microphone"],
    });
    const client = await clientContext.newPage();
    let dailyRequests = 0;
    let joinRequests = 0;
    let clientPresence = "";
    for (const participant of [page, client]) {
      participant.on("request", (request) => {
        if (new URL(request.url()).hostname.endsWith(".daily.co"))
          dailyRequests += 1;
        if (participant === client && request.url().endsWith("/lobby/ready"))
          clientPresence = request.postDataJSON().presenceId;
      });
      // Video poziv ovdje namjerno ne pokrećemo: provjeravamo trenutak kad UI prvi put zatraži pristup.
      await participant.route(
        `**/api/v1/bookings/${data.bookingId}/online-session/join`,
        async (route) => {
          joinRequests += 1;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              message: "Test povezivanja je zaustavljen prije video servisa.",
            }),
          });
        },
      );
    }
    try {
      await signIn(page, data.emails[0], true);
      await signIn(client, data.emails[1]);
      await page.goto(`/session/${data.bookingId}`);
      await client.goto(`/session/${data.bookingId}`);
      await client
        .getByRole("button", {
          name: "Provjeri kameru i mikrofon",
          exact: true,
        })
        .click();
      await expect(client.locator(".session-video-tile video")).toBeVisible();
      await page
        .getByRole("button", { name: "Spreman/na sam", exact: true })
        .click();
      const start = page.getByRole("button", {
        name: "Pokreni razgovor",
        exact: true,
      });
      await expect(start).toBeDisabled();
      await client
        .getByRole("button", { name: "Spreman/na sam", exact: true })
        .click();
      await expect(start).toBeEnabled();
      await expect(
        client.getByRole("button", { name: "Pokreni razgovor", exact: true }),
      ).toHaveCount(0);
      await expect(client.locator(".session-connection-status")).toHaveText(
        "U čekaonici",
      );
      const before = (
        await database.query(
          "SELECT client_ready_at FROM online_session_lobbies WHERE booking_id=$1",
          [data.bookingId],
        )
      ).rows[0].client_ready_at.getTime();
      await expect
        .poll(async () =>
          (
            await database.query(
              "SELECT client_ready_at FROM online_session_lobbies WHERE booking_id=$1",
              [data.bookingId],
            )
          ).rows[0].client_ready_at.getTime(),
        )
        .toBeGreaterThan(before);
      expect(dailyRequests).toBe(0);
      expect(joinRequests).toBe(0);
      expect(
        (
          await database.query(
            "SELECT count(*)::int AS count FROM online_session_rooms WHERE booking_id=$1",
            [data.bookingId],
          )
        ).rows[0].count,
      ).toBe(0);
      const info = await (
        await client.request.get(
          `/api/v1/bookings/${data.bookingId}/online-session`,
        )
      ).json();
      expect(info.canWait).toBe(true);
      expect(info.canJoin).toBe(false);
      expect(
        (
          await client.request.post(
            `/api/v1/bookings/${data.bookingId}/online-session/lobby/start`,
            {
              headers: { Origin: "http://127.0.0.1:3200" },
              data: { presenceId: clientPresence },
            },
          )
        ).status(),
      ).toBe(403);
      // Direknim API zahtjevom potvrđujemo da sakriveno dugme nije jedina zaštita.
      const direct = await client.request.post(
        `http://127.0.0.1:4100/api/v1/bookings/${data.bookingId}/online-session/join`,
        {
          headers: { Origin: "http://127.0.0.1:3200" },
          data: { presenceId: clientPresence, lobbyId: info.lobby.id },
        },
      );
      expect(direct.status()).toBe(409);
      await page.screenshot({
        path: testInfo.outputPath("waiting-room-desktop.png"),
        fullPage: true,
      });
      await client.setViewportSize({ width: 390, height: 844 });
      expect(
        await client.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await client.screenshot({
        path: testInfo.outputPath("waiting-room-mobile.png"),
        fullPage: true,
      });
      await start.click();
      await expect.poll(() => joinRequests).toBe(2);
      expect(dailyRequests).toBe(0);
      await expect(client.locator(".form-error[role=alert]")).toContainText(
        "Test povezivanja je zaustavljen",
      );
      await client
        .getByRole("button", { name: "Napusti čekaonicu", exact: true })
        .click();
      await expect(start).toBeDisabled();
      await expect(
        client.getByRole("button", { name: "Spreman/na sam", exact: true }),
      ).toBeVisible();
      expect(
        (
          await database.query(
            "SELECT count(*)::int AS count FROM online_session_rooms WHERE booking_id=$1",
            [data.bookingId],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await clientContext.close();
    }
  },
);

/** Pravi izolovane učesnike, online rezervaciju i slobodno radno vrijeme za test izbora usluge. */
async function fixture() {
  const userIds: string[] = [];
  const emails: string[] = [];
  for (const role of ["THERAPIST", "CLIENT", "CLIENT"]) {
    const email = `video-${randomUUID()}@example.test`;
    const user = await database.query(
      "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES($1,$2,'Video Test','Video','Test','1990-01-01',$3,now(),'+38267123456') RETURNING id",
      [email, passwordHash, role],
    );
    emails.push(email);
    userIds.push(user.rows[0].id);
  }
  const therapistId = (
    await database.query(
      "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city,address) VALUES($1,'Video Terapeut','Psihoterapeut','Psychotherapist','Podgorica','Adresa za uživo') RETURNING id",
      [userIds[0]],
    )
  ).rows[0].id;
  const serviceId = (
    await database.query(
      "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes,price_eur,online) VALUES($1,'Privatna online seansa','Private online session',50,35,true) RETURNING id",
      [therapistId],
    )
  ).rows[0].id;
  const bookingId = (
    await database.query(
      `INSERT INTO booking_requests(client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,price_eur_snapshot,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status,online)
   VALUES($1,$2,$3,'Privatna online seansa',50,35,'Video Test',$4,'+38267123456',now()+interval '5 minutes',now()+interval '55 minutes','CONFIRMED',true) RETURNING id`,
      [userIds[1], therapistId, serviceId, emails[1]],
    )
  ).rows[0].id;
  const date = addDays(dateKey(), 2);
  await database.query(
    "INSERT INTO availability_windows(therapist_id,weekday,start_minute,end_minute) VALUES($1,$2,540,720)",
    [therapistId, weekday(date)],
  );
  return { emails, userIds, therapistId, serviceId, bookingId, date };
}

/** Koristi stvarnu prijavu i HttpOnly kolačić; frontend nema demo video identitet. */
async function signIn(page: Page, email: string, therapist = false) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(therapist ? /\/dashboard$/ : /\/psychotherapy$/);
}

test("online service selection persists while existing booking keeps its modality and participants stay private", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(120000);
  const data = await fixture();
  expect(
    (
      await request.get(`/api/v1/bookings/${data.bookingId}/online-session`)
    ).status(),
  ).toBe(401);
  const clientContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
  });
  const otherContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
  });
  try {
    const client = await clientContext.newPage();
    const other = await otherContext.newPage();
    await signIn(page, data.emails[0], true);
    await openScheduleSections(page);
    const editor = page.locator(`[data-service-id="${data.serviceId}"]`);
    await expect(
      editor.getByRole("checkbox", {
        name: "Online seansa — video poziv",
        exact: true,
      }),
    ).toBeChecked();
    await editor
      .getByRole("checkbox", {
        name: "Online seansa — video poziv",
        exact: true,
      })
      .uncheck();
    await editor
      .getByRole("button", { name: "Sačuvaj seansu", exact: true })
      .click();
    await expect(
      page.getByText("Seansa je sačuvana.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await openScheduleSections(page);
    await expect(
      editor.getByRole("checkbox", {
        name: "Online seansa — video poziv",
        exact: true,
      }),
    ).not.toBeChecked();
    expect(
      (
        await database.query(
          "SELECT online FROM booking_requests WHERE id=$1",
          [data.bookingId],
        )
      ).rows[0].online,
    ).toBe(true);
    await editor
      .getByRole("checkbox", {
        name: "Online seansa — video poziv",
        exact: true,
      })
      .check();
    await editor
      .getByRole("button", { name: "Sačuvaj seansu", exact: true })
      .click();
    await expect(
      page.getByText("Seansa je sačuvana.", { exact: true }),
    ).toBeVisible();
    await signIn(client, data.emails[1]);
    await client.goto(`/therapist/${data.therapistId}/book`);
    await expect(client.locator(".service-option")).toContainText(
      "Online · video poziv",
    );
    const created = await client.request.post("/api/v1/bookings", {
      headers: { Origin: "http://127.0.0.1:3200" },
      data: {
        therapistId: data.therapistId,
        serviceId: data.serviceId,
        date: data.date,
        start: "540",
        phone: "+38267123456",
        online: "true",
      },
    });
    expect(created.ok()).toBe(true);
    expect((await created.json()).booking.online).toBe(true);
    await client.goto("/account");
    const card = client.locator(`[data-booking-id="${data.bookingId}"]`);
    await expect(card).toContainText("Online · video poziv u aplikaciji");
    await expect(card).not.toContainText("Adresa za uživo");
    await card
      .getByRole("link", { name: "Otvori online seansu", exact: true })
      .click();
    await expect(
      client.getByRole("heading", {
        name: "Privatna online seansa",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      client.getByRole("button", { name: "Spreman/na sam", exact: true }),
    ).toBeDisabled();
    await expect(
      client.getByText(
        "Online pozivi još nijesu uključeni. Kontaktirajte terapeuta.",
        { exact: true },
      ),
    ).toBeVisible();
    const ownInfo = await client.request.get(
      `/api/v1/bookings/${data.bookingId}/online-session`,
    );
    expect(ownInfo.headers()["cache-control"]).toContain("no-store");
    expect(await ownInfo.json()).not.toHaveProperty("token");
    const csrf = await page.request.post(
      `/api/v1/bookings/${data.bookingId}/online-session/join`,
      { headers: { Origin: "https://foreign.example" }, data: {} },
    );
    expect(csrf.status()).toBe(403);
    await signIn(other, data.emails[2]);
    expect(
      (
        await other.request.get(
          `/api/v1/bookings/${data.bookingId}/online-session`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await other.request.post(
          `/api/v1/bookings/${data.bookingId}/online-session/join`,
          { headers: { Origin: "http://127.0.0.1:3200" }, data: {} },
        )
      ).status(),
    ).toBe(404);
    await other.goto(`/session/${data.bookingId}`);
    await expect(other.locator(".form-error[role=alert]")).toHaveText(
      "Seansa nije pronađena.",
    );
    await expect(
      other.getByRole("button", {
        name: "Provjeri kameru i mikrofon",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await clientContext.close();
    await otherContext.close();
  }
});

test("local preview handles controls, mobile layout and stops tracks when leaving", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const data = await fixture();
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    const original = media.getUserMedia.bind(media);
    const state = window as typeof window & {
      previewTracks: MediaStreamTrack[];
    };
    state.previewTracks = [];
    // Prati stvarne vještačke browser trake, bez izmjene produkcionog koda.
    media.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      state.previewTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await signIn(page, data.emails[1]);
  await page.goto(`/session/${data.bookingId}`);
  await page
    .getByRole("button", { name: "Provjeri kameru i mikrofon", exact: true })
    .click();
  await expect(page.locator(".session-video-tile video")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".session-video-tile video")
        .evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Kamera", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Kamera", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Mikrofon", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mikrofon", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Kamera", exact: true }).click();
  await page.getByRole("button", { name: "Mikrofon", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("online-session-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("online-session-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Moji termini", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & { previewTracks: MediaStreamTrack[] }
      ).previewTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
});

test("blocked media and failed join show honest errors without claiming a connected call", async ({
  page,
}) => {
  test.setTimeout(90000);
  const data = await fixture();
  await page.addInitScript(() => {
    if (navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("Test permission denied", "NotAllowedError");
      };
  });
  await signIn(page, data.emails[1]);
  // Uključujemo samo frontend dugme; stvarni API ostaje isključen i mora odbiti ulazak.
  await page.route(
    `**/api/v1/bookings/${data.bookingId}/online-session`,
    async (route) => {
      const response = await route.fetch();
      const info = await response.json();
      await route.fulfill({
        response,
        json: {
          ...info,
          configured: true,
          canWait: true,
          canJoin: false,
          reason: "",
        },
      });
    },
  );
  await page.goto(`/session/${data.bookingId}`);
  await page
    .getByRole("button", { name: "Provjeri kameru i mikrofon", exact: true })
    .click();
  await expect(page.locator(".form-error[role=alert]")).toContainText(
    "Kamera ili mikrofon nijesu dostupni.",
  );
  await page
    .getByRole("button", { name: "Spreman/na sam", exact: true })
    .click();
  await expect(
    page.getByText(
      "Online pozivi još nijesu uključeni. Kontaktirajte terapeuta.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator(".session-connection-status")).toHaveText(
    "Priprema za razgovor",
  );
  await expect(
    page.getByRole("button", { name: "Izađi", exact: true }),
  ).toHaveCount(0);
});
