import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const origin = "http://127.0.0.1:3200";
const password = "Moja sigurna test lozinka!";

/** Priprema podatke samo testnog naloga u izolovanoj šemi. */
function testEmail() {
  return `browser-${randomUUID()}@example.test`;
}

/** Unosi prvi korak registracije kroz stvarni browser. */
async function registerInBrowser(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Ime", { exact: true }).fill("Milica");
  await page.getByLabel("Prezime", { exact: true }).fill("Testović");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Datum rođenja", { exact: true }).fill("1992-05-14");
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Dalje", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Potvrdite email." }),
  ).toBeVisible();
}

/** Unosi terapeutski nalog i profil kroz poseban formular; cijena može ostati prazna. */
async function registerTherapistInBrowser(
  page: Page,
  email: string,
  price: string,
) {
  await page.goto("/register/therapist");
  await expect(
    page.getByRole("heading", { name: "Registracija terapeuta." }),
  ).toBeVisible();
  await page.getByLabel("Ime", { exact: true }).fill("Milica");
  await page.getByLabel("Prezime", { exact: true }).fill("Testović");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Datum rođenja", { exact: true }).fill("1992-05-14");
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page
    .getByLabel("Stručno zvanje", { exact: true })
    .fill("Psihoterapeut");
  await page
    .getByLabel("Biografija", { exact: true })
    .fill("Radim sa odraslima kroz individualne susrete.");
  await page.getByLabel("Grad", { exact: true }).fill("Podgorica");
  await page.getByLabel("Telefon", { exact: true }).fill("+382 67 123 456");
  await page
    .getByLabel("Adresa ordinacije (opcionalno)", { exact: true })
    .fill("Test ulica 12");
  await page
    .getByLabel("Naziv usluge", { exact: true })
    .fill("Individualna psihoterapija");
  await page.getByLabel("Trajanje seanse (min)", { exact: true }).fill("60");
  await page
    .getByLabel("Cijena seanse (€), opciono", { exact: true })
    .fill(price);
  await page.getByRole("button", { name: "Dalje", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Potvrdite email." }),
  ).toBeVisible();
}

/** Čita poruku namijenjenu samo testnom emailu iz lokalnog Mailpit sandučeta. */
async function receivedCode(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let code = "";
  await expect
    .poll(async () => {
      const inbox = await (
        await request.get("http://127.0.0.1:8025/api/v1/messages")
      ).json();
      const message = inbox.messages.find(
        (item: { To: { Address: string }[] }) =>
          item.To.some((recipient) => recipient.Address === email),
      );
      if (!message) return false;
      const content = await (
        await request.get(`http://127.0.0.1:8025/api/v1/message/${message.ID}`)
      ).json();
      const match = content.Text.match(/je: (\d{4})/);
      code = match?.[1] || "";
      return !!code;
    })
    .toBe(true);
  return code;
}

/** Provjerava početni ekran po ulozi, pa otvara nalog radi narednih provjera podataka. */
async function verifyInBrowser(page: Page, code: string, therapist = false) {
  await page.getByLabel("Kod iz emaila").fill(code);
  await page.getByRole("button", { name: "Potvrdi i kreiraj nalog" }).click();
  await expect(page).toHaveURL(therapist ? /\/dashboard$/ : /\/psychotherapy$/);
  if (therapist)
    await expect(
      page.getByRole("heading", { name: /^Dobar dan,/ }),
    ).toBeVisible();
  else await expect(page.locator(".therapist-card")).toHaveCount(4);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Dobro došli, Milica." }),
  ).toBeVisible();
}

// Zatvara samo konekcije testa; runner uklanja njegovu izolovanu šemu.
test.afterAll(async () => {
  await database.end();
});

// Neprijavljen korisnik ne dobija radni prostor ni mogućnost upisa profesionalnih podataka.
test("dashboard and profile updates require a signed-in account", async ({
  page,
}) => {
  await page.goto("/dashboard?mode=therapist");
  await expect(page).toHaveURL(/\/login$/);
  const response = await page.request.post("/api/v1/auth/therapist-profile", {
    headers: { Origin: origin },
    data: {
      title: "Psihoterapeut",
      biography: "Test",
      city: "Bar",
      phone: "+38267123456",
      address: "",
    },
  });
  expect(response.status()).toBe(401);
  const personal = await page.request.post("/api/v1/auth/profile", {
    headers: { Origin: origin },
    data: { firstName: "Test", lastName: "Test", dateOfBirth: "1990-01-01" },
  });
  expect(personal.status()).toBe(401);
});

// Povratak u tab provjerava JWT u pozadini i ne briše još nesačuvan unos profila.
test("checking the session after returning to the tab preserves profile edits", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("ana.markovic@example.test");
  await page.getByLabel("Lozinka", { exact: true }).fill("Test123");
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page
    .getByRole("link", { name: "Uredi profil terapeuta", exact: true })
    .click();
  await page.getByRole("button", { name: "Uredi profil", exact: true }).click();
  await page
    .getByLabel("Biografija", { exact: true })
    .fill("Nesačuvana izmjena biografije.");
  const accountResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/me"),
  );
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  expect((await accountResponse).status()).toBe(200);
  await expect(page.getByLabel("Biografija", { exact: true })).toHaveValue(
    "Nesačuvana izmjena biografije.",
  );
});

// Prolazi SMTP poruku, pogrešan kod, refresh, sesiju, odjavu i ponovnu prijavu.
test("registration, email verification and persistent login use PostgreSQL", async ({
  page,
  request,
}) => {
  const email = testEmail();
  await registerInBrowser(page, email);
  expect(
    (
      await database.query("SELECT count(*) FROM users WHERE email = $1", [
        email,
      ])
    ).rows[0].count,
  ).toBe("0");
  const code = await receivedCode(request, email);
  const wrong = ((Number(code) + 1) % 10000).toString().padStart(4, "0");
  await page.getByLabel("Kod iz emaila").fill(wrong);
  await page.getByRole("button", { name: "Potvrdi i kreiraj nalog" }).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText(
    "Kod nije tačan",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Potvrdite email." }),
  ).toBeVisible();
  await verifyInBrowser(page, code);
  await expect(page.locator(".profile-summary-grid")).toContainText(email);
  const row = (
    await database.query(
      "SELECT first_name,last_name,date_of_birth::text,password_hash,role,verified_at FROM users WHERE email = $1",
      [email],
    )
  ).rows[0];
  expect(row).toMatchObject({
    first_name: "Milica",
    last_name: "Testović",
    date_of_birth: "1992-05-14",
    role: "CLIENT",
  });
  expect(row.password_hash).toMatch(/^scrypt\$/);
  expect(row.password_hash).not.toContain(password);
  expect(row.verified_at).not.toBeNull();
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "terapeut_session",
  )!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  expect(cookie.value.split(".")).toHaveLength(3);
  const claims = JSON.parse(
    Buffer.from(cookie.value.split(".")[1], "base64url").toString(),
  );
  expect(claims.role).toBe("CLIENT");
  expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "terapeut_session",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Dobro došli, Milica." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
  await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const replay = await request.get("http://127.0.0.1:4100/api/v1/auth/me", {
    headers: { Cookie: `terapeut_session=${cookie.value}` },
  });
  expect(replay.status()).toBe(401);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Lozinka", { exact: true })
    .fill("Ovo nije prava lozinka!");
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText(
    "Email ili lozinka nijesu ispravni",
  );
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(/\/psychotherapy$/);
  await expect(page.locator(".therapist-card")).toHaveCount(4);
  await page.goto("/dashboard?mode=therapist&therapist=ana-markovic");
  await expect(page).toHaveURL(/\/psychotherapy$/);
  const unauthorizedUpdate = await page.request.post(
    "/api/v1/auth/therapist-profile",
    {
      headers: { Origin: origin },
      data: {
        title: "Psihoterapeut",
        biography: "Test",
        city: "Bar",
        phone: "+38267123456",
        address: "",
        role: "THERAPIST",
      },
    },
  );
  expect(unauthorizedUpdate.status()).toBe(403);
  const me = await page.request.get(
    "/api/v1/auth/me?role=ADMIN&userId=someone-else",
  );
  expect((await me.json()).user).toMatchObject({ email, role: "CLIENT" });
  expect(
    (await page.request.get("/api/v1/auth/therapist-profile")).status(),
  ).toBe(403);
  await database.query(
    "UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email = $1)",
    [email],
  );
  await page.goto("/account");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Prijavite se za pregled naloga." }),
  ).toBeVisible();
});

// Istek ne kreira nalog; ponovni kod radi, a duplikat emaila se odbija.
test("expired code, resend and duplicate email are handled by the API", async ({
  page,
  request,
}) => {
  const email = testEmail();
  await registerInBrowser(page, email);
  const initial = await receivedCode(request, email);
  await database.query(
    "UPDATE registration_challenges SET expires_at = now() - interval '1 second', next_send_at = now() - interval '1 second' WHERE email = $1",
    [email],
  );
  await page.getByLabel("Kod iz emaila").fill(initial);
  await page.getByRole("button", { name: "Potvrdi i kreiraj nalog" }).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText(
    "Kod je istekao",
  );
  await page.evaluate(() => {
    const key = "terapeut-me.pending-registration.v1";
    const value = JSON.parse(sessionStorage.getItem(key)!);
    value.resendAt = Date.now() - 1000;
    sessionStorage.setItem(key, JSON.stringify(value));
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Pošalji novi kod", exact: true })
    .click();
  await expect(page.locator(".auth-card").getByRole("status")).toContainText(
    "Novi kod je poslat",
  );
  const newest = await receivedCode(request, email);
  expect(newest).not.toBe(initial);
  await verifyInBrowser(page, newest);
  const duplicate = await request.post(
    "http://127.0.0.1:4100/api/v1/auth/register",
    {
      headers: { Origin: origin },
      data: {
        firstName: "Milica",
        lastName: "Test",
        email,
        dateOfBirth: "1992-05-14",
        password,
        role: "ADMIN",
      },
    },
  );
  expect(duplicate.status()).toBe(409);
});

// Strane web forme i proizvoljan sesijski token ne mogu pristupiti nalogu.
test("cross-site requests and invalid sessions are rejected", async ({
  request,
}) => {
  const data = { email: testEmail(), password };
  const foreign = await request.post(
    "http://127.0.0.1:4100/api/v1/auth/login",
    { headers: { Origin: "https://foreign.example" }, data },
  );
  expect(foreign.status()).toBe(403);
  const noOrigin = await request.post(
    "http://127.0.0.1:4100/api/v1/auth/login",
    { data },
  );
  expect(noOrigin.status()).toBe(403);
  const invalid = await request.get("http://127.0.0.1:4100/api/v1/auth/me", {
    headers: { Cookie: `terapeut_session=${"a".repeat(64)}` },
  });
  expect(invalid.status()).toBe(401);
  const foreignProfile = await request.post(
    "http://127.0.0.1:4100/api/v1/auth/profile",
    {
      headers: { Origin: "https://foreign.example" },
      data: { firstName: "Test", lastName: "Test", dateOfBirth: "1990-01-01" },
    },
  );
  expect(foreignProfile.status()).toBe(403);
});

// Obje uloge uređuju vlastite podatke; odustajanje ne čuva unos, a prijava čita sačuvane vrijednosti.
test("client and therapist can edit personal profiles and persist changes", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  for (const therapist of [false, true]) {
    const email = testEmail();
    if (therapist) await registerTherapistInBrowser(page, email, "40");
    else await registerInBrowser(page, email);
    await page
      .getByLabel("Kod iz emaila")
      .fill(await receivedCode(request, email));
    await page.getByRole("button", { name: "Potvrdi i kreiraj nalog" }).click();
    await expect(page).toHaveURL(
      therapist ? /\/dashboard$/ : /\/psychotherapy$/,
    );
    await page.goto("/account");
    await page
      .getByRole("button", { name: "Uredi profil", exact: true })
      .click();
    const form = page.getByRole("form", {
      name: "Podaci profila",
      exact: true,
    });
    await form.getByLabel("Ime", { exact: true }).fill("Nesačuvano");
    await form.getByRole("button", { name: "Odustani", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Dobro došli, Milica." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Uredi profil", exact: true })
      .click();
    await expect(form.getByLabel("Ime", { exact: true })).toHaveValue("Milica");
    await form.getByLabel("Ime", { exact: true }).fill("Jelena");
    await form.getByLabel("Prezime", { exact: true }).fill("Promijenjeno");
    await form.getByLabel("Datum rođenja", { exact: true }).fill("1991-06-15");
    await form
      .getByLabel(therapist ? "Telefon" : "Kontakt telefon (opcionalno)", {
        exact: true,
      })
      .fill("+382 67 987 654");
    await form
      .getByLabel(therapist ? "Grad" : "Grad (opcionalno)", { exact: true })
      .fill("Cetinje");
    await form
      .getByLabel(
        therapist ? "Adresa ordinacije (opcionalno)" : "Adresa (opcionalno)",
        { exact: true },
      )
      .fill("Nova ulica 25");
    if (!therapist) {
      await page.setViewportSize({ width: 390, height: 844 });
      await form
        .getByLabel("Kontakt telefon (opcionalno)", { exact: true })
        .fill("pogrešan broj");
      await form
        .getByRole("button", { name: "Sačuvaj profil", exact: true })
        .click();
      await expect(form.getByRole("alert")).toContainText(
        "Unesite važeći broj telefona.",
      );
      await expect(
        page.getByRole("heading", { name: "Dobro došli, Milica." }),
      ).toBeVisible();
      await form
        .getByLabel("Kontakt telefon (opcionalno)", { exact: true })
        .fill("+382 67 987 654");
    }
    const refresh = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/auth/me"),
    );
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect((await refresh).status()).toBe(200);
    await expect(form.getByLabel("Ime", { exact: true })).toHaveValue("Jelena");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await form
      .getByRole("button", { name: "Sačuvaj profil", exact: true })
      .click();
    await expect(
      page.locator(".account-profile-editor").getByRole("status"),
    ).toContainText("Profil je sačuvan.");
    await expect(
      page.getByRole("heading", { name: "Dobro došli, Jelena." }),
    ).toBeVisible();
    const user = (await (await page.request.get("/api/v1/auth/me")).json())
      .user;
    const stored = (
      await database.query(
        "SELECT first_name,last_name,full_name,date_of_birth::text,phone,role,email FROM users WHERE id=$1",
        [user.id],
      )
    ).rows[0];
    expect(stored).toMatchObject({
      first_name: "Jelena",
      last_name: "Promijenjeno",
      full_name: "Jelena Promijenjeno",
      date_of_birth: "1991-06-15",
      email,
      role: therapist ? "THERAPIST" : "CLIENT",
    });
    if (!therapist) {
      expect(stored.phone).toBe("+382 67 987 654");
      const contact = (
        await database.query("SELECT city,address FROM users WHERE id=$1", [
          user.id,
        ])
      ).rows[0];
      expect(contact).toEqual({ city: "Cetinje", address: "Nova ulica 25" });
      await page.goto("/therapist/ana-markovic/book");
      await page.locator(".service-option").first().click();
      await page.locator(".time-options button:enabled").first().click();
      await expect(
        page.getByLabel("Broj telefona", { exact: true }),
      ).toHaveValue("+382 67 987 654");
      await expect(
        page.getByLabel("Ime i prezime", { exact: true }),
      ).toHaveValue("Jelena Promijenjeno");
      await page.goto("/account");
    }
    if (therapist) {
      const professional = (
        await (await page.request.get("/api/v1/auth/therapist-profile")).json()
      ).therapistProfile;
      expect(professional).toMatchObject({
        city: "Cetinje",
        address: "Nova ulica 25",
        phone: "+382 67 987 654",
      });
      await expect(
        page
          .locator(".therapist-account-profile")
          .getByRole("heading", { name: "Jelena Promijenjeno" }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Otvori javni profil", exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Jelena Promijenjeno",
      );
      await page.goto("/account");
    }
    await page.reload();
    await expect(page.locator(".profile-summary-details time")).toHaveAttribute(
      "datetime",
      "1991-06-15",
    );
    await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
    await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Lozinka", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
    await expect(page).toHaveURL(
      therapist ? /\/dashboard$/ : /\/psychotherapy$/,
    );
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "Dobro došli, Jelena." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Uredi profil", exact: true })
      .click();
    await expect(form.getByLabel("Prezime", { exact: true })).toHaveValue(
      "Promijenjeno",
    );
    await expect(
      form.getByLabel(therapist ? "Grad" : "Grad (opcionalno)", {
        exact: true,
      }),
    ).toHaveValue("Cetinje");
    await expect(
      form.getByLabel(
        therapist ? "Adresa ordinacije (opcionalno)" : "Adresa (opcionalno)",
        { exact: true },
      ),
    ).toHaveValue("Nova ulica 25");
    await form.getByRole("button", { name: "Odustani", exact: true }).click();
    await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
    await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
  }
});

// Provjerava mobilni prikaz, tastaturu i engleski jezik bez prelivanja stranice.
test("auth pages are usable on mobile and in English", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/register", "/register/therapist", "/login"]) {
    await page.goto(route);
    await expect(page.locator(".auth-card")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Register", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create your account." }),
  ).toBeVisible();
  await page.getByLabel("First name", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Last name", { exact: true })).toBeFocused();
  await page
    .getByRole("link", { name: "Registration for therapists", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Therapist registration." }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Professional title", { exact: true }),
  ).toBeVisible();
});

// Terapeutski profil i cijena čuvaju se tek nakon koda i ostaju vidljivi nakon ponovne prijave.
test("therapist registration persists the role, profile and service", async ({
  page,
  request,
}) => {
  const email = testEmail();
  await registerTherapistInBrowser(page, email, "45.50");
  expect(
    (
      await database.query("SELECT count(*) FROM users WHERE email = $1", [
        email,
      ])
    ).rows[0].count,
  ).toBe("0");
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Napravite svoj nalog." }),
  ).toBeVisible();
  await expect(page.getByLabel("Kod iz emaila")).toHaveCount(0);
  await page.goto("/register/therapist");
  await expect(
    page.getByRole("heading", { name: "Potvrdite email." }),
  ).toBeVisible();
  await verifyInBrowser(page, await receivedCode(request, email), true);
  await expect(page.locator(".profile-summary-grid")).toContainText("Terapeut");
  const profile = page.locator(".therapist-account-profile");
  await expect(profile).toContainText("Psihoterapeut");
  await expect(profile).toContainText("Podgorica");
  await expect(profile).toContainText(
    "Radim sa odraslima kroz individualne susrete.",
  );
  await expect(profile).toContainText("Neverifikovan profil");
  await expect(profile.locator(".therapist-account-services")).toContainText(
    "45,5",
  );
  const row = (
    await database.query(
      `SELECT u.id,u.role,u.phone,t.id AS profile_id,t.is_verified,t.verified_by,s.duration_minutes,s.price_eur FROM users u JOIN therapists t ON t.linked_user_id = u.id JOIN services s ON s.therapist_id = t.id WHERE u.email = $1 AND s.duration_minutes=60`,
      [email],
    )
  ).rows[0];
  expect(row).toMatchObject({
    role: "THERAPIST",
    phone: "+382 67 123 456",
    is_verified: false,
    verified_by: null,
    duration_minutes: 60,
    price_eur: "45.50",
  });
  const ownProfile = await page.request.get(
    "/api/v1/auth/therapist-profile?userId=someone-else&therapistId=someone-else",
  );
  expect((await ownProfile.json()).therapistProfile.id).toBe(row.profile_id);
  await page.reload();
  await expect(page.locator(".therapist-account-profile")).toContainText(
    "Individualna psihoterapija",
  );
  await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
  await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /^Dobar dan,/ }),
  ).toBeVisible();
  await page.goto("/dashboard?mode=admin&therapist=ana-markovic");
  await expect(
    page.getByRole("heading", { name: /^Dobar dan,/ }),
  ).toBeVisible();
  await expect(page.locator(".role-switch")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Uredi profil terapeuta", exact: true })
    .click();
  await expect(page.locator(".therapist-account-profile")).toContainText(
    "Podgorica",
  );
  await page.getByRole("button", { name: "Uredi profil", exact: true }).click();
  await page.getByLabel("Stručno zvanje", { exact: true }).fill("Psiholog");
  await page
    .getByLabel("Biografija", { exact: true })
    .fill("Ažurirana biografija iz mog naloga.");
  await page.getByLabel("Grad", { exact: true }).fill("Nikšić");
  await page.getByLabel("Telefon", { exact: true }).fill("+382 67 654 321");
  await page
    .getByLabel("Adresa ordinacije (opcionalno)", { exact: true })
    .fill("");
  await page
    .getByRole("button", { name: "Sačuvaj profil", exact: true })
    .click();
  await expect(
    page.locator(".account-profile-editor").getByRole("status"),
  ).toContainText("Profil je sačuvan.");
  await page.reload();
  await page.getByRole("button", { name: "Uredi profil", exact: true }).click();
  await expect(page.getByLabel("Grad", { exact: true })).toHaveValue("Nikšić");
  await expect(page.getByLabel("Biografija", { exact: true })).toHaveValue(
    "Ažurirana biografija iz mog naloga.",
  );
  await expect(page.locator(".therapist-account-services")).toContainText(
    "45,5",
  );
  const persisted = (
    await page.request.get("/api/v1/auth/therapist-profile")
  ).json();
  const savedProfile = (await persisted).therapistProfile;
  expect(savedProfile).toMatchObject({
    city: "Nikšić",
    title: "Psiholog",
    phone: "+382 67 654 321",
    address: null,
    verified: false,
  });
  await page
    .getByRole("link", { name: "Otvori javni profil", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Milica Testović",
  );
  await expect(page.locator("main")).toContainText(
    "Ažurirana biografija iz mog naloga.",
  );
});

// Prazna cijena nije besplatna seansa; server odbija neispravne podatke i ignoriše ADMIN/verifikaciju.
test("therapist validation, optional price and professional verification are enforced", async ({
  page,
  request,
}) => {
  const email = testEmail();
  const values = {
    firstName: "Ana",
    lastName: "Test",
    email,
    dateOfBirth: "1990-01-01",
    password,
    title: "Psiholog",
    biography: "Test biografija.",
    city: "Bar",
    phone: "+38267123456",
    address: "",
    serviceName: "Seansa",
    durationMinutes: "60",
    priceEur: "",
    role: "ADMIN",
    isVerified: true,
  };
  const invalid = await request.post(
    "http://127.0.0.1:4100/api/v1/auth/register/therapist",
    { headers: { Origin: origin }, data: { ...values, priceEur: "-1" } },
  );
  expect(invalid.status()).toBe(400);
  const tooLong = await request.post(
    "http://127.0.0.1:4100/api/v1/auth/register/therapist",
    {
      headers: { Origin: origin },
      data: { ...values, biography: "a".repeat(401) },
    },
  );
  expect(tooLong.status()).toBe(400);
  const started = await request.post(
    "http://127.0.0.1:4100/api/v1/auth/register/therapist",
    { headers: { Origin: origin }, data: values },
  );
  expect(started.status()).toBe(201);
  const challengeId = (await started.json()).challengeId;
  const confirmed = await page.request.post("/api/v1/auth/verify", {
    headers: { Origin: origin },
    data: {
      challengeId,
      code: await receivedCode(request, email),
      role: "ADMIN",
      verified: true,
    },
  });
  expect(confirmed.status()).toBe(201);
  expect((await confirmed.json()).user.role).toBe("THERAPIST");
  await page.goto("/account");
  await expect(page.locator(".therapist-account-services")).toContainText(
    "Na upit",
  );
  await expect(page.locator(".therapist-account-profile")).toContainText(
    "Neverifikovan profil",
  );
  expect(
    (
      await database.query(
        "SELECT s.price_eur FROM services s JOIN therapists t ON t.id = s.therapist_id JOIN users u ON u.id = t.linked_user_id WHERE u.email = $1 AND s.duration_minutes=60",
        [email],
      )
    ).rows[0].price_eur,
  ).toBeNull();
  expect(
    (
      await request.get("http://127.0.0.1:4100/api/v1/auth/therapist-profile")
    ).status(),
  ).toBe(401);
});
