import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { addDays, dateKey } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";
import { createMaterialTestPdf } from "../fixtures/material-pdf";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const origin = "http://127.0.0.1:3200";
const password = "Sigurna lozinka za privatne materijale!";
let passwordHash = "";
// Neispravan selektor se javlja brzo, umjesto da potroši cijeli složeni scenario.
test.use({ actionTimeout: 15000 });
// Dokumenti i nalozi postoje samo u izolovanoj testnoj šemi.
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

/** Kreira dva terapeuta i dva klijenta, sa provjerenim vezama preko potvrđenih seansi. */
async function fixture() {
  const userIds: string[] = [];
  const emails: string[] = [];
  for (const [index, role] of [
    "THERAPIST",
    "THERAPIST",
    "CLIENT",
    "CLIENT",
  ].entries()) {
    const email = `material-${randomUUID()}@example.test`;
    const id = (
      await database.query(
        "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,$2,$3,'Materijal','Test','1990-01-01',$4,now(),'+38267123456') RETURNING id",
        [email, passwordHash, `Materijal Klijent ${index}`, role],
      )
    ).rows[0].id;
    emails.push(email);
    userIds.push(id);
  }
  const therapistIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const therapist = (
      await database.query(
        "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city) VALUES ($1,$2,'Psihoterapeut','Psychotherapist','Podgorica') RETURNING id",
        [userIds[index], `Terapeut Materijal ${index}`],
      )
    ).rows[0].id;
    therapistIds.push(therapist);
    const service = (
      await database.query(
        "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes) VALUES ($1,'Seansa','Session',50) RETURNING id",
        [therapist],
      )
    ).rows[0].id;
    for (const clientIndex of index === 0 ? [2, 3] : [2]) {
      await database.query(
        `INSERT INTO booking_requests(client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status,confirmed_at)
       VALUES ($1,$2,$3,'Seansa',50,$4,$5,'+38267123456',($6::date+$7*interval '1 minute') AT TIME ZONE 'Europe/Podgorica',($6::date+($7+50)*interval '1 minute') AT TIME ZONE 'Europe/Podgorica','CONFIRMED',now())`,
        [
          userIds[clientIndex],
          therapist,
          service,
          `Materijal Klijent ${clientIndex}`,
          emails[clientIndex],
          addDays(dateKey(), 2),
          540 + (clientIndex - 2) * 60,
        ],
      );
    }
  }
  return { userIds, emails, therapistIds };
}

/** Prijavljuje stvarni nalog; JWT ostaje u HttpOnly kolačiću browsera. */
async function signIn(page: Page, email: string, therapist: boolean) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(therapist ? /\/dashboard$/ : /\/psychotherapy$/);
}

// Pravi PDF ide kroz formular, privatno preuzimanje i uređivanje; drugi klijent i terapeut ostaju bez pristupa.
test("therapist assigns a private PDF and homework, client downloads it, and withdrawal closes access", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120000);
  const data = await fixture();
  const clientContext = await browser.newContext({ baseURL: origin });
  const otherClientContext = await browser.newContext({ baseURL: origin });
  const otherTherapistContext = await browser.newContext({ baseURL: origin });
  const client = await clientContext.newPage();
  const otherClient = await otherClientContext.newPage();
  const otherTherapist = await otherTherapistContext.newPage();
  try {
    await signIn(page, data.emails[0], true);
    await signIn(client, data.emails[2], false);
    await signIn(otherClient, data.emails[3], false);
    await signIn(otherTherapist, data.emails[1], true);
    await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
    await page
      .locator(".account-dropdown")
      .getByRole("link", { name: "Domaći zadaci i materijali", exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboard#my-materials$/);
    await expect(page.locator(".account-dropdown")).toHaveCount(0);
    const section = page.locator("#my-materials");
    await section
      .getByRole("combobox", { name: "Klijent za materijale", exact: true })
      .selectOption(data.userIds[2]);
    await section
      .getByRole("button", { name: "Dodaj materijal ili zadatak", exact: true })
      .click();
    const editor = section.locator(".material-editor");
    await editor
      .getByLabel("Naslov materijala", { exact: true })
      .fill("Dnevnik za naredni susret");
    await editor
      .getByRole("combobox", { name: "Vrsta materijala", exact: true })
      .selectOption("JOURNAL");
    await editor
      .getByRole("textbox", { name: "Uputstvo ili tekst zadatka", exact: true })
      .fill("Pročitajte priloženi materijal.\nPonesite ga na sljedeću seansu.");
    await editor
      .getByLabel("Rok (opciono)", { exact: true })
      .fill(addDays(dateKey(), 7));
    const pdf = createMaterialTestPdf();
    await editor
      .getByLabel("PDF prilog (opciono, do 5 MB)", { exact: true })
      .setInputFiles({
        name: "domaći-dnevnik.pdf",
        mimeType: "application/pdf",
        buffer: pdf,
      });
    let finishUpload: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    // Kontrolisano čekanje dokazuje da je dugme blokirano i spinner vidljiv prije potvrde servera.
    await page.route("**/api/v1/client-materials", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await editor
      .getByRole("button", { name: "Sačuvaj materijal", exact: true })
      .click();
    try {
      await expect(
        editor.getByRole("button", {
          name: "Čuvanje materijala…",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        editor.getByText("Čuvanje zadatka i priloga…", { exact: true }),
      ).toBeVisible();
    } finally {
      finishUpload();
    }
    await expect(
      section.getByText("Materijal je sačuvan i dostupan klijentu.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.unroute("**/api/v1/client-materials");
    const response = await (
      await page.request.get("/api/v1/client-materials")
    ).json();
    expect(response.materials).toHaveLength(1);
    const id = response.materials[0].id;
    expect(response.materials[0].fileName).toBe("domaći-dnevnik.pdf");
    expect(
      (await request.get(`/api/v1/client-materials/${id}/file`)).status(),
    ).toBe(401);
    expect(
      (
        await otherClient.request.get(`/api/v1/client-materials/${id}/file`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await otherTherapist.request.get(`/api/v1/client-materials/${id}/file`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await otherTherapist.request.post(
          `/api/v1/client-materials/${id}/archive`,
          { headers: { Origin: origin }, data: { version: 1 } },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await client.request.post("/api/v1/client-materials", {
          headers: { Origin: origin },
          multipart: { title: "Tuđi upis" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post("/api/v1/client-materials", {
          headers: { Origin: "https://untrusted.example" },
          multipart: { title: "Nedozvoljen izvor" },
        })
      ).status(),
    ).toBe(403);
    // Materijal za drugog klijenta istog terapeuta ne smije se pojaviti u prvom klijentovom nalogu.
    expect(
      (
        await page.request.post("/api/v1/client-materials", {
          headers: { Origin: origin },
          multipart: {
            clientUserId: data.userIds[3],
            title: "Preporuka samo za drugog klijenta",
            kind: "RESOURCE",
            instructions: "Preporučeni tekst.",
            resourceUrl: "https://example.test/resource",
            dueDate: "",
          },
        })
      ).ok(),
    ).toBe(true);
    await client
      .getByRole("button", { name: "Moj nalog", exact: true })
      .click();
    const accountLinks = client.locator(".account-dropdown a");
    await expect(accountLinks.nth(0)).toHaveText("Moji termini");
    await expect(accountLinks.nth(1)).toHaveText("Domaći zadaci i materijali");
    await accountLinks.nth(1).click();
    await expect(client).toHaveURL(/\/account#my-materials$/);
    await expect(client.locator(".account-dropdown")).toHaveCount(0);
    const clientSection = client.locator("#my-materials");
    await expect(
      clientSection.getByRole("heading", {
        name: "Materijali i domaći zadaci",
        exact: true,
      }),
    ).toBeInViewport();
    const card = clientSection.locator(`[data-material-id="${id}"]`);
    await expect(
      card.getByRole("heading", {
        name: "Dnevnik za naredni susret",
        exact: true,
      }),
    ).toBeVisible();
    await expect(clientSection.locator(".material-card")).toHaveCount(1);
    await expect(clientSection).not.toContainText(
      "Preporuka samo za drugog klijenta",
    );
    const fileResponse = await client.request.get(
      `/api/v1/client-materials/${id}/file`,
    );
    expect(fileResponse.headers()["cache-control"]).toBe("private, no-store");
    expect(fileResponse.headers()["x-content-type-options"]).toBe("nosniff");
    expect(fileResponse.headers()["content-type"]).toContain("application/pdf");
    expect(await fileResponse.body()).toEqual(pdf);
    const downloaded = client.waitForEvent("download");
    await card
      .getByRole("button", { name: "Preuzmi PDF", exact: true })
      .click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("domaći-dnevnik.pdf");
    expect(await readFile((await download.path())!)).toEqual(pdf);
    await client.setViewportSize({ width: 390, height: 844 });
    expect(
      await client.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await card.screenshot({
      path: testInfo.outputPath("client-material-mobile.png"),
    });
    const ownerCard = section.locator(`[data-material-id="${id}"]`);
    await ownerCard
      .getByRole("button", { name: "Uredi materijal", exact: true })
      .click();
    await editor
      .getByLabel("Naslov materijala", { exact: true })
      .fill("Dnevnik — izmijenjeno uputstvo");
    await editor
      .getByRole("textbox", { name: "Uputstvo ili tekst zadatka", exact: true })
      .fill("Sačuvano novo uputstvo.");
    await editor
      .getByRole("button", { name: "Sačuvaj materijal", exact: true })
      .click();
    await expect(
      ownerCard.getByRole("heading", {
        name: "Dnevnik — izmijenjeno uputstvo",
        exact: true,
      }),
    ).toBeVisible();
    await clientSection
      .getByRole("button", { name: "Osvježi materijale", exact: true })
      .click();
    await expect(card).toContainText("Sačuvano novo uputstvo.");
    await expect(card).toContainText("domaći-dnevnik.pdf");
    await otherClient.goto("/account#my-materials");
    await expect(
      otherClient.locator("#my-materials .material-card"),
    ).toHaveCount(1);
    await expect(otherClient.locator("#my-materials")).toContainText(
      "Preporuka samo za drugog klijenta",
    );
    await expect(otherClient.locator("#my-materials")).not.toContainText(
      "Dnevnik — izmijenjeno uputstvo",
    );
    await ownerCard
      .getByRole("button", { name: "Povuci materijal", exact: true })
      .click();
    await ownerCard
      .getByRole("button", { name: "Potvrdi povlačenje", exact: true })
      .click();
    await expect(ownerCard).toHaveCount(0);
    await clientSection
      .getByRole("button", { name: "Osvježi materijale", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    expect(
      (
        await client.request.get(`/api/v1/client-materials/${id}/file`)
      ).status(),
    ).toBe(404);
  } finally {
    await clientContext.close();
    await otherClientContext.close();
    await otherTherapistContext.close();
  }
});

// Isti HTTP upload put odbija pogrešan PDF, prevelik prilog i nedozvoljen link bez djelimičnog upisa.
test("invalid material uploads and links leave the database unchanged", async ({
  page,
}) => {
  test.setTimeout(90000);
  const data = await fixture();
  await signIn(page, data.emails[0], true);
  const input = {
    clientUserId: data.userIds[2],
    title: "Test provjere",
    kind: "HOMEWORK",
    instructions: "Uputstvo.",
    resourceUrl: "",
    dueDate: "",
  };
  const section = page.locator("#my-materials");
  await section
    .getByRole("combobox", { name: "Klijent za materijale", exact: true })
    .selectOption(data.userIds[2]);
  await section
    .getByRole("button", { name: "Dodaj materijal ili zadatak", exact: true })
    .click();
  const editor = section.locator(".material-editor");
  await editor
    .getByRole("textbox", { name: "Naslov materijala", exact: true })
    .fill("Prazan prilog");
  await editor
    .getByLabel("PDF prilog (opciono, do 5 MB)", { exact: true })
    .setInputFiles({
      name: "prazan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(0),
    });
  await editor
    .getByRole("button", { name: "Sačuvaj materijal", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText(
    "PDF dokument je prazan.",
  );
  const fake = await page.request.post("/api/v1/client-materials", {
    headers: { Origin: origin },
    multipart: {
      ...input,
      file: {
        name: "fake.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("<html>fake</html>"),
      },
    },
  });
  expect(fake.status()).toBe(400);
  const huge = await page.request.post("/api/v1/client-materials", {
    headers: { Origin: origin },
    multipart: {
      ...input,
      file: {
        name: "huge.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      },
    },
  });
  expect(huge.status()).toBe(413);
  const link = await page.request.post("/api/v1/client-materials", {
    headers: { Origin: origin },
    multipart: { ...input, resourceUrl: "javascript:alert(1)" },
  });
  expect(link.status()).toBe(400);
  expect(
    (await (await page.request.get("/api/v1/client-materials")).json())
      .materials,
  ).toHaveLength(0);
});
