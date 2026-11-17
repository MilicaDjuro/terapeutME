import { openScheduleSections } from "./dashboard-helpers";
import {
  test,
  expect,
  type Page,
  type Route,
  type Locator,
} from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { addDays, dateKey, weekday } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const password = "Sigurna lozinka za spinner test!";
const patientEmail = `spinner-patient-${randomUUID()}@example.test`;
const therapistEmail = `spinner-therapist-${randomUUID()}@example.test`;
const workingDate = addDays(dateKey(), 2);
let therapistId = "";
let serviceId = "";

// Nalozi i raspored nastaju isključivo u izolovanoj šemi browser runnera.
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
      "INSERT INTO users (email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,'Spinner Test','Spinner','Test','1990-01-01',$3,now(),'+38267123456') RETURNING id",
      [email, passwordHash, role],
    );
    if (role === "THERAPIST") {
      therapistId = (
        await database.query(
          "INSERT INTO therapists (linked_user_id,full_name,title_mne,title_en,bio_mne,city) VALUES ($1,'Spinner Test','Psihoterapeut','Psychotherapist','Test biografija.','Podgorica') RETURNING id",
          [user.rows[0].id],
        )
      ).rows[0].id;
      serviceId = (
        await database.query(
          "INSERT INTO services (therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,'Test seansa','Test session',60,40) RETURNING id",
          [therapistId],
        )
      ).rows[0].id;
      await database.query(
        "INSERT INTO availability_windows (therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,540,720)",
        [therapistId, weekday(workingDate)],
      );
    }
  }
});

// Runner uklanja testnu šemu; zatvaramo samo konekcije ovog fajla.
test.afterAll(async () => {
  await database.end();
});

/** Zadržava jedan tip zahtjeva dok test ne pregleda čekanje; aplikacija nema vještačku pauzu. */
async function holdRequest(
  page: Page,
  path: string,
  fail = false,
  method = "POST",
) {
  let release = () => {};
  let notifyStarted = () => {};
  let count = 0;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  /** Propušta ostale metode, da polling ne zaustavi test čuvanja ili učitavanja. */
  async function handleRoute(route: Route) {
    if (route.request().method() !== method) {
      await route.continue();
      return;
    }
    count += 1;
    notifyStarted();
    await waiting;
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Testna greška. Pokušajte ponovo." }),
      });
    else await route.continue();
  }
  await page.route(path, handleRoute);
  /** Oslobađa čekanje i uklanja presretanje čak i kada provjera ne uspije. */
  async function dispose() {
    release();
    await page.unroute(path, handleRoute);
  }
  return { started, release, dispose, requestCount: () => count };
}

/** Dok je odgovor zadržan, dugme mora vidljivo čekati i odbiti ponovljeni klik. */
async function expectWaitingButton(button: Locator) {
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button.locator(".spinner")).toBeVisible();
  await button.evaluate((element) => (element as HTMLButtonElement).click());
}

/** Prijavljuje testni nalog i čeka promjenu stranice prije rada sa njenim poljima. */
async function signIn(page: Page, email: string, therapist = false) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(therapist ? /\/dashboard$/ : /\/psychotherapy$/);
}

// Spori odgovori i greška dokazuju da indikator prati mrežni zahtjev i da nema duplog upisa.
test("patient and therapist see pending actions, cannot send duplicates and can retry failures", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  const therapistContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
  });
  const therapist = await therapistContext.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(patientEmail);
    await page.getByLabel("Lozinka", { exact: true }).fill(password);
    const login = await holdRequest(page, "**/api/v1/auth/login");
    try {
      await page
        .getByRole("button", { name: "Prijavi se", exact: true })
        .click();
      await login.started;
      await expectWaitingButton(page.locator("button.auth-submit"));
      expect(login.requestCount()).toBe(1);
      login.release();
      await expect(page).toHaveURL(/\/psychotherapy$/);
    } finally {
      await login.dispose();
    }

    const accountLoad = await holdRequest(
      page,
      "**/api/v1/auth/me",
      false,
      "GET",
    );
    try {
      await page.goto("/account");
      await accountLoad.started;
      await expect(page.locator(".profile-loading")).toContainText(
        "Učitavanje profila",
      );
      await expect(page.locator(".profile-loading .spinner")).toBeVisible();
      accountLoad.release();
      await expect(
        page.getByRole("button", { name: "Uredi profil", exact: true }),
      ).toBeVisible();
    } finally {
      await accountLoad.dispose();
    }
    await page
      .getByRole("button", { name: "Uredi profil", exact: true })
      .click();
    const profile = page.locator(".account-profile-editor");
    await profile.getByLabel("Prezime", { exact: true }).fill("Spinner");
    const failedSave = await holdRequest(page, "**/api/v1/auth/profile", true);
    try {
      await profile
        .getByRole("button", { name: "Sačuvaj profil", exact: true })
        .click();
      await failedSave.started;
      await expectWaitingButton(profile.locator('button[type="submit"]'));
      await expect(profile.locator(".save-feedback-pending")).toBeVisible();
      await expect(profile.locator(".save-feedback-success")).toHaveCount(0);
      failedSave.release();
      await expect(profile.getByRole("alert")).toContainText("Testna greška");
      await expect(profile.locator(".save-feedback-success")).toHaveCount(0);
      await expect(profile.getByLabel("Prezime", { exact: true })).toHaveValue(
        "Spinner",
      );
      await expect(
        profile.getByRole("button", { name: "Sačuvaj profil", exact: true }),
      ).toBeEnabled();
      expect(failedSave.requestCount()).toBe(1);
    } finally {
      await failedSave.dispose();
    }
    await profile
      .getByRole("button", { name: "Sačuvaj profil", exact: true })
      .click();
    await expect(
      profile.getByText("Profil je sačuvan.", { exact: true }),
    ).toBeVisible();

    // Potvrda sama nestaje, a isti tekst mora ponovo da se pojavi pri sljedećem čuvanju.
    await expect(profile.locator(".save-feedback-success")).toHaveCount(0, {
      timeout: 7000,
    });
    await profile
      .getByRole("button", { name: "Uredi profil", exact: true })
      .click();
    await profile
      .getByRole("button", { name: "Sačuvaj profil", exact: true })
      .click();
    await expect(profile.locator(".save-feedback-success")).toHaveText(
      "Profil je sačuvan.",
    );
    await expect(profile.locator(".save-feedback-success")).toHaveCount(0, {
      timeout: 7000,
    });

    await page.goto(`/therapist/${therapistId}/book`);
    await page.getByRole("button", { name: /Test seansa · 60 min/ }).click();
    await page.getByLabel("Datum seanse", { exact: true }).fill(workingDate);
    await page
      .locator(".time-options button")
      .filter({ hasText: /^09:00/ })
      .click();
    await page.getByRole("checkbox").check();
    const booking = await holdRequest(page, "**/api/v1/bookings");
    try {
      await page
        .getByRole("button", { name: "Pošalji zahtjev", exact: true })
        .click();
      await booking.started;
      await expectWaitingButton(
        page.locator(".contact-section form button.button-primary"),
      );
      expect(booking.requestCount()).toBe(1);
      booking.release();
      await expect(
        page.getByRole("heading", { name: "Zahtjev je poslat.", exact: true }),
      ).toBeVisible();
    } finally {
      await booking.dispose();
    }

    await signIn(therapist, therapistEmail, true);
    const card = therapist
      .locator(".booking-card")
      .filter({ hasText: patientEmail });
    const confirmation = await holdRequest(
      therapist,
      "**/api/v1/bookings/*/respond",
    );
    try {
      await card.getByRole("button", { name: "Potvrdi", exact: true }).click();
      await confirmation.started;
      await expectWaitingButton(
        card.getByRole("button", { name: "Potvrdi", exact: true }),
      );
      await expect(
        card.getByRole("button", { name: "Odbij", exact: true }),
      ).toBeDisabled();
      await expect(card.locator("button .spinner")).toHaveCount(1);
      expect(confirmation.requestCount()).toBe(1);
      confirmation.release();
      await expect(card.locator(".status")).toHaveText("Potvrđeno");
    } finally {
      await confirmation.dispose();
    }

    await openScheduleSections(therapist);
    const schedule = therapist.locator(".schedule-editor");
    const scheduleConfirmation = schedule.locator(".save-feedback-success");
    const session = schedule.locator(`[data-service-id="${serviceId}"]`);
    await session
      .getByLabel("Trajanje seanse (min)", { exact: true })
      .fill("40");
    const sessionSave = await holdRequest(therapist, "**/api/v1/schedule");
    try {
      await session
        .getByRole("button", { name: "Sačuvaj seansu", exact: true })
        .click();
      await sessionSave.started;
      await expectWaitingButton(session.locator("button.button-primary"));
      await expect(scheduleConfirmation).toHaveCount(0);
      await expect(
        schedule.getByRole("button", { name: "Dodaj seansu", exact: true }),
      ).toBeDisabled();
      expect(sessionSave.requestCount()).toBe(1);
      sessionSave.release();
      await expect(session.getByRole("heading")).toContainText("40 min");
      // Cijeli editor prikazuje tačno jednu potvrdu i ona opisuje seansu, ne raspored.
      await expect(scheduleConfirmation).toHaveCount(1);
      await expect(scheduleConfirmation).toHaveText("Seansa je sačuvana.");
      await expect(session.locator(".save-feedback-success")).toHaveCount(0);
    } finally {
      await sessionSave.dispose();
    }

    // Nova izmjena uklanja staru potvrdu; neuspješan zahtjev nikad ne prikazuje zelenu poruku.
    await session
      .getByLabel("Trajanje seanse (min)", { exact: true })
      .fill("45");
    await expect(session.locator(".save-feedback-success")).toHaveCount(0);
    await expect(scheduleConfirmation).toHaveCount(0);
    const failedSession = await holdRequest(
      therapist,
      "**/api/v1/schedule",
      true,
    );
    try {
      await session
        .getByRole("button", { name: "Sačuvaj seansu", exact: true })
        .click();
      await failedSession.started;
      failedSession.release();
      await expect(session.getByRole("alert")).toContainText("Testna greška");
      await expect(session.locator(".save-feedback-success")).toHaveCount(0);
      await expect(
        session.getByLabel("Trajanje seanse (min)", { exact: true }),
      ).toHaveValue("45");
    } finally {
      await failedSession.dispose();
    }

    const newDate = schedule.locator('[data-new-date="true"]');
    await newDate
      .getByLabel("Datum rada", { exact: true })
      .fill(addDays(workingDate, 1));
    await newDate.getByRole("checkbox").uncheck();
    await therapist.setViewportSize({ width: 390, height: 844 });
    await therapist.emulateMedia({ reducedMotion: "reduce" });
    const dateSave = await holdRequest(therapist, "**/api/v1/schedule");
    try {
      await newDate
        .getByRole("button", { name: "Sačuvaj datum", exact: true })
        .click();
      await dateSave.started;
      await expectWaitingButton(newDate.locator("button.button-primary"));
      await expect(newDate.locator(".spinner")).toHaveCSS(
        "animation-name",
        "none",
      );
      expect(
        await therapist.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await newDate.screenshot({
        path: testInfo.outputPath("pending-date-mobile.png"),
      });
      dateSave.release();
      await expect(schedule.locator("[data-date-id]")).toContainText(
        "Neradni dan",
      );
      await expect(scheduleConfirmation).toHaveCount(1);
      await expect(scheduleConfirmation).toHaveText("Raspored je sačuvan.");
      await expect(newDate.locator(".save-feedback-success")).toHaveCount(0);
      await expect(
        schedule.locator(".schedule-feedback .save-feedback-success"),
      ).toBeInViewport();
      await therapist.screenshot({
        path: testInfo.outputPath("saved-schedule-mobile.png"),
        fullPage: true,
      });
      await expect(scheduleConfirmation).toHaveCount(0, {
        timeout: 7000,
      });
      await expect(
        schedule.locator(".schedule-feedback .save-feedback-success"),
      ).toHaveCount(0);
      // Greška prethodnog unosa ostaje i nakon isteka uspješne potvrde za drugi formular.
      await expect(session.getByRole("alert")).toContainText("Testna greška");
    } finally {
      await dateSave.dispose();
    }

    const therapistLoad = await holdRequest(
      therapist,
      "**/api/v1/auth/therapist-profile",
      false,
      "GET",
    );
    try {
      await therapist.goto("/account");
      await therapistLoad.started;
      await expect(
        therapist.locator(".therapist-account-profile .profile-loading"),
      ).toBeVisible();
      therapistLoad.release();
      await expect(therapist.locator(".photos-editor")).toBeVisible();
    } finally {
      await therapistLoad.dispose();
    }
    // I terapeut mijenja kontakt i dobija potvrdu koja nastaje tek nakon odgovora API-ja.
    await therapist
      .getByRole("button", { name: "Uredi profil", exact: true })
      .click();
    const therapistProfile = therapist.locator(".account-profile-editor");
    await therapistProfile.getByLabel("Grad", { exact: true }).fill("Bar");
    const therapistSave = await holdRequest(
      therapist,
      "**/api/v1/auth/profile",
    );
    try {
      await therapistProfile
        .getByRole("button", { name: "Sačuvaj profil", exact: true })
        .click();
      await therapistSave.started;
      await expect(
        therapistProfile.locator(".save-feedback-pending"),
      ).toBeVisible();
      await expect(
        therapistProfile.locator(".save-feedback-success"),
      ).toHaveCount(0);
      therapistSave.release();
      await expect(
        therapistProfile.locator(".save-feedback-success"),
      ).toContainText("Profil je sačuvan.");
      await therapistProfile.screenshot({
        path: testInfo.outputPath("saved-profile-mobile.png"),
      });
    } finally {
      await therapistSave.dispose();
    }
    const photos = therapist.locator(".photos-editor");
    const image = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#386857" },
    })
      .png()
      .toBuffer();
    await photos.locator('input[type="file"]').setInputFiles({
      name: "spinner.png",
      mimeType: "image/png",
      buffer: image,
    });
    const upload = await holdRequest(
      therapist,
      "**/api/v1/auth/therapist-profile/photos",
    );
    try {
      await photos
        .getByRole("button", { name: "Sačuvaj fotografiju", exact: true })
        .click();
      await upload.started;
      await expectWaitingButton(photos.locator("form button"));
      expect(upload.requestCount()).toBe(1);
      upload.release();
      await expect(photos.locator(".own-photo")).toHaveCount(1);
      await expect(photos.locator(".save-feedback-success")).toHaveText(
        "Fotografija je sačuvana.",
      );
      await expect(photos.locator(".save-feedback-success")).toHaveCount(0, {
        timeout: 7000,
      });
    } finally {
      await upload.dispose();
    }

    const stored = (
      await database.query(
        "SELECT status,duration_minutes FROM booking_requests WHERE therapist_id=$1",
        [therapistId],
      )
    ).rows;
    expect(stored).toHaveLength(1);
    expect(
      (
        await database.query("SELECT city FROM therapists WHERE id=$1", [
          therapistId,
        ])
      ).rows[0].city,
    ).toBe("Bar");
    expect(stored[0]).toMatchObject({
      status: "CONFIRMED",
      duration_minutes: 60,
    });
    expect(
      (
        await database.query(
          "SELECT duration_minutes FROM services WHERE id=$1",
          [serviceId],
        )
      ).rows[0].duration_minutes,
    ).toBe(40);
  } finally {
    await therapistContext.close();
  }
});
