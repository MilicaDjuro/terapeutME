import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Pool } from "pg";

const origin = "http://127.0.0.1:3200";
const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
// Konekcije pripadaju samo testnoj šemi koju runner uklanja.
test.afterAll(async () => {
  await database.end();
});

// Provjerava testne prijave za sve uvezene stručnjake i čitanje njihovih profila iz baze.
test("imported professionals can sign in with the local test password", async ({
  page,
}) => {
  for (const email of [
    "ana.markovic@example.test",
    "jelena.petrovic@example.test",
    "maja.radovic@example.test",
    "milica.jovanovic@example.test",
  ]) {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Lozinka", { exact: true }).fill("Test123");
    await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page
      .getByRole("link", { name: "Uredi profil terapeuta", exact: true })
      .click();
    await expect(page.locator(".therapist-account-profile")).toContainText(
      "Vaše fotografije",
    );
    await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
    await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
});

// Nova registracija i fotografije odmah postaju dio javnog DB kataloga, bez lokalnih lažnih profila.
test("new therapist photos persist, appear publicly and reject changes by another therapist", async ({
  page,
  request,
}) => {
  const email = `photo-${randomUUID()}@example.test`;
  const password = "Pravilna test lozinka!";
  const started = await request.post("/api/v1/auth/register/therapist", {
    headers: { Origin: origin },
    data: {
      firstName: "Foto",
      lastName: "Terapeut",
      email,
      password,
      dateOfBirth: "1990-01-01",
      title: "Psiholog",
      biography: "Profil sa fotografijama.",
      city: "Cetinje",
      phone: "+38267123456",
      serviceName: "Seansa",
      durationMinutes: "60",
      priceEur: "",
    },
  });
  expect(started.status()).toBe(201);
  const challengeId = (await started.json()).challengeId;
  const messages = await (
    await request.get("http://127.0.0.1:8025/api/v1/messages")
  ).json();
  const message = messages.messages.find(
    (item: { To: { Address: string }[] }) =>
      item.To.some((recipient) => recipient.Address === email),
  );
  const content = await (
    await request.get(`http://127.0.0.1:8025/api/v1/message/${message.ID}`)
  ).json();
  const confirmed = await page.request.post("/api/v1/auth/verify", {
    headers: { Origin: origin },
    data: { challengeId, code: content.Text.match(/je: (\d{4})/)[1] },
  });
  expect(confirmed.status()).toBe(201);
  await page.goto("/account");
  const png = await sharp({
    create: { width: 48, height: 48, channels: 3, background: "#356452" },
  })
    .png()
    .toBuffer();
  for (let index = 0; index < 2; index += 1) {
    await page.getByLabel("Fotografija (JPG, PNG ili WebP)").setInputFiles({
      name: `photo-${index}.png`,
      mimeType: "image/png",
      buffer: png,
    });
    await page
      .getByRole("button", { name: "Sačuvaj fotografiju", exact: true })
      .click();
    await expect(page.locator(".own-photo")).toHaveCount(index + 1);
  }
  const own = (
    await (await page.request.get("/api/v1/auth/therapist-profile")).json()
  ).therapistProfile;
  expect(own.photos.length).toBe(2);
  await page
    .getByRole("button", { name: "Postavi kao profilnu", exact: true })
    .click();
  await expect(
    page.locator(".own-photo").first().locator("img"),
  ).toHaveAttribute("src", own.photos[1].url);
  await page.reload();
  await expect(page.locator(".own-photo")).toHaveCount(2);
  const bytes = await page.request.get(own.photos[0].url);
  expect(bytes.headers()["content-type"]).toContain("image/webp");
  expect(bytes.headers()["x-content-type-options"]).toBe("nosniff");
  const attacker = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { email: "ana.markovic@example.test", password: "Test123" },
  });
  expect(attacker.status()).toBe(201);
  expect(
    (
      await request.delete(
        `/api/v1/auth/therapist-profile/photos/${own.photos[0].id}`,
        { headers: { Origin: origin }, data: {} },
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(
        `/api/v1/auth/therapist-profile/photos/${own.photos[0].id}/primary`,
        { headers: { Origin: origin }, data: {} },
      )
    ).status(),
  ).toBe(404);
  const fake = await page.request.post(
    "/api/v1/auth/therapist-profile/photos",
    {
      headers: { Origin: origin },
      multipart: {
        photo: {
          name: "fake.png",
          mimeType: "image/png",
          buffer: Buffer.from("<svg></svg>"),
        },
      },
    },
  );
  expect(fake.status()).toBe(400);
  await page
    .getByRole("link", { name: "Otvori javni profil", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Foto Terapeut", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".public-photo-gallery img")).toHaveCount(2);
  await expect(page.locator(".profile-identity .avatar img")).toHaveAttribute(
    "src",
    own.photos[1].url,
  );
  await database.query("UPDATE therapists SET city='Danilovgrad' WHERE id=$1", [
    own.id,
  ]);
  await page.reload();
  await expect(page.locator(".profile-identity")).toContainText("Danilovgrad");
  await page.goto("/psychotherapy?q=Foto Terapeut");
  await expect(page.locator(".therapist-card")).toHaveCount(1);
  const publicProfiles = await (
    await page.request.get("/api/v1/therapists")
  ).json();
  expect(
    publicProfiles.therapists.find(
      (profile: { id: string; profession: string }) =>
        profile.id === own.publicId,
    ).profession,
  ).toBe("psychologist");
  await expect(page.locator(".therapist-card .avatar img")).toHaveAttribute(
    "src",
    own.photos[1].url,
  );
  await page.goto("/account");
  await page
    .locator(".own-photo")
    .first()
    .getByRole("button", { name: "Obriši fotografiju" })
    .click();
  await expect(page.locator(".own-photo")).toHaveCount(1);
  expect((await page.request.get(own.photos[1].url)).status()).toBe(404);
});
