import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword, hashToken } from "../../apps/api/src/auth/auth.crypto";
import { createPasswordResetToken } from "../../apps/api/src/auth/password-reset.jwt";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const origin = "http://127.0.0.1:3200";
const oldPassword = "Moja prethodna lozinka!";
const newPassword = "Moja nova obnovljena lozinka!";
const clientEmail = `recovery-${randomUUID()}@example.test`;
const therapistEmail = `recovery-therapist-${randomUUID()}@example.test`;

// Samo izolovana browser šema dobija testne naloge; nijedan stvarni korisnik se ne mijenja.
test.beforeAll(async () => {
  const schema = (await database.query("SELECT current_schema() AS name"))
    .rows[0].name;
  expect(schema).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
  const passwordHash = await hashPassword(oldPassword);
  for (const [email, role] of [
    [clientEmail, "CLIENT"],
    [therapistEmail, "THERAPIST"],
  ]) {
    const result = await database.query(
      "INSERT INTO users (email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,'Obnova Test','Obnova','Test','1990-01-01',$3,now(),'+38267123456') RETURNING id",
      [email, passwordHash, role],
    );
    if (role === "THERAPIST")
      await database.query(
        "INSERT INTO therapists (linked_user_id,full_name,title_mne,title_en,bio_mne,bio_en,city) VALUES ($1,'Obnova Test','Psiholog','Psiholog','Test biografija.','Test biografija.','Podgorica')",
        [result.rows[0].id],
      );
  }
});

// Runner briše šemu; ovaj fajl zatvara samo svoje DB konekcije.
test.afterAll(async () => {
  await database.end();
});

/** Čita samo poruku za nasumični testni nalog i vraća reset link iz lokalnog Mailpit-a. */
async function receivedResetLink(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let link = "";
  await expect
    .poll(async () => {
      const inbox = await (
        await request.get("http://127.0.0.1:8025/api/v1/messages")
      ).json();
      const message = inbox.messages.find(
        (item: { Subject: string; To: { Address: string }[] }) =>
          item.Subject === "Terapeut.me — obnova lozinke" &&
          item.To.some((recipient) => recipient.Address === email),
      );
      if (!message) return false;
      const content = await (
        await request.get(`http://127.0.0.1:8025/api/v1/message/${message.ID}`)
      ).json();
      link =
        content.Text.match(
          /https?:\/\/[^\s]+\/reset-password#token=[^\s]+/,
        )?.[0] || "";
      return !!link;
    })
    .toBe(true);
  return link;
}

// Email link, potvrda lozinke i JWT prijava rade jednako za obje uloge, uz drugačiji početni ekran.
test("email JWT links reset both roles, revoke old sessions and sign in automatically", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  for (const [email, therapist] of [
    [clientEmail, false],
    [therapistEmail, true],
  ] as const) {
    if (!therapist) await page.setViewportSize({ width: 390, height: 844 });
    const prior = await request.post(`${origin}/api/v1/auth/login`, {
      headers: { Origin: origin },
      data: { email, password: oldPassword },
    });
    expect(prior.status()).toBe(201);
    const priorCookie = (await request.storageState()).cookies.find(
      (cookie) => cookie.name === "terapeut_session",
    )!;
    await page.goto("/login");
    await page
      .getByRole("link", { name: "Zaboravili ste lozinku?", exact: true })
      .click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(
      page.getByRole("heading", {
        name: "Zaboravili ste lozinku?",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
    await page
      .getByRole("button", { name: "Pošalji link", exact: true })
      .click();
    await expect(page.locator(".auth-card").getByRole("status")).toContainText(
      "Ako postoji aktivan nalog",
    );
    const link = await receivedResetLink(request, email);
    expect(new URL(link).origin).toBe(origin);
    expect(new URL(link).search).toBe("");
    await page.goto(link);
    await page.reload();
    await page.getByLabel("Nova lozinka", { exact: true }).fill(newPassword);
    await page
      .getByLabel("Potvrdite novu lozinku", { exact: true })
      .fill("Ovo je druga lozinka!");
    await page
      .getByRole("button", {
        name: "Sačuvaj lozinku i prijavi se",
        exact: true,
      })
      .click();
    await expect(page.locator(".auth-card").getByRole("alert")).toContainText(
      "Lozinke se ne podudaraju",
    );
    await page
      .getByLabel("Potvrdite novu lozinku", { exact: true })
      .fill(newPassword);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", {
        name: "Sačuvaj lozinku i prijavi se",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(
      therapist ? /\/dashboard$/ : /\/psychotherapy$/,
    );
    const me = await page.request.get("/api/v1/auth/me");
    expect((await me.json()).user).toMatchObject({
      email,
      role: therapist ? "THERAPIST" : "CLIENT",
    });
    const cookie = (await page.context().cookies()).find(
      (item) => item.name === "terapeut_session",
    )!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.value.split(".")).toHaveLength(3);
    expect(
      (
        await request.get("http://127.0.0.1:4100/api/v1/auth/me", {
          headers: { Cookie: `terapeut_session=${priorCookie.value}` },
        })
      ).status(),
    ).toBe(401);
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
    const replay = await page.request.post("/api/v1/auth/reset-password", {
      headers: { Origin: origin },
      data: { token, password: newPassword, confirmPassword: newPassword },
    });
    expect(replay.status()).toBe(400);
    await page.goto("/account");
    await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
    await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Lozinka", { exact: true }).fill(oldPassword);
    await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
    await expect(page.locator(".auth-card").getByRole("alert")).toContainText(
      "Email ili lozinka nijesu ispravni",
    );
    await page.getByLabel("Lozinka", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
    await expect(page).toHaveURL(
      therapist ? /\/dashboard$/ : /\/psychotherapy$/,
    );
    await page.goto("/account");
    await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
    await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
  }
});

// Nepoznata adresa dobija isti odgovor; strani Origin, pogrešna potvrda i loš token se odbijaju.
test("recovery rejects invalid and expired links without exposing account existence", async ({
  page,
  request,
}) => {
  const email = `missing-${randomUUID()}@example.test`;
  const unknown = await request.post(`${origin}/api/v1/auth/forgot-password`, {
    headers: { Origin: origin },
    data: { email },
  });
  expect(unknown.status()).toBe(201);
  expect(await unknown.json()).not.toHaveProperty("token");
  const foreign = await request.post(`${origin}/api/v1/auth/forgot-password`, {
    headers: { Origin: "https://foreign.example" },
    data: { email },
  });
  expect(foreign.status()).toBe(403);
  const malformed = await request.post(`${origin}/api/v1/auth/reset-password`, {
    headers: { Origin: origin },
    data: {
      token: "invalid",
      password: newPassword,
      confirmPassword: newPassword,
    },
  });
  expect(malformed.status()).toBe(400);
  const mismatched = await request.post(
    `${origin}/api/v1/auth/reset-password`,
    {
      headers: { Origin: origin },
      data: {
        token: "invalid",
        password: newPassword,
        confirmPassword: "Druga duga lozinka!",
      },
    },
  );
  expect(mismatched.status()).toBe(400);
  expect((await mismatched.json()).message).toContain(
    "Lozinke se ne podudaraju",
  );
  await page.goto("/reset-password");
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText(
    "Nedostaje link",
  );
  const user = (
    await database.query("SELECT id FROM users WHERE email=$1", [clientEmail])
  ).rows[0];
  const expired = createPasswordResetToken(user.id);
  await database.query(
    "INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES ($1,$2,now()-interval '1 second')",
    [hashToken(expired), user.id],
  );
  await page.goto(`/reset-password#token=${expired}`);
  await page.getByLabel("Nova lozinka", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Potvrdite novu lozinku", { exact: true })
    .fill(newPassword);
  await page
    .getByRole("button", { name: "Sačuvaj lozinku i prijavi se", exact: true })
    .click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText(
    "istekao",
  );
  await expect(
    page.getByRole("link", { name: "Zatraži novi link", exact: true }),
  ).toBeVisible();
});
