import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { addDays, dateKey } from "@terapeut/domain";
import { hashPassword } from "../../apps/api/src/auth/auth.crypto";

const database = new Pool({
  connectionString: process.env.AUTH_E2E_DATABASE_URL,
});
const origin = "http://127.0.0.1:3200";
const password = "Sigurna lozinka za privatne biljeske!";
test.use({ actionTimeout: 15000 });
// Nalozi i bilješke su sintetički; runner po završetku uklanja cijelu testnu šemu.
test.beforeAll(async () => {
  expect(
    (await database.query("SELECT current_schema() AS name")).rows[0].name,
  ).toMatch(/^auth_e2e_[a-f0-9]{32}$/);
});
test.afterAll(async () => {
  await database.end();
});

/** Priprema dva terapeuta istog klijenta i drugog klijenta samo prvog terapeuta. */
async function fixture() {
  const hash = await hashPassword(password);
  const ids: string[] = [];
  const emails: string[] = [];
  for (const [index, role] of [
    "THERAPIST",
    "THERAPIST",
    "CLIENT",
    "CLIENT",
    "CLIENT",
  ].entries()) {
    const email = `notes-${randomUUID()}@example.test`;
    const name =
      index === 2
        ? "Klijent Jedan"
        : index === 3
          ? "Klijent Dva"
          : `Biljeske Test ${index}`;
    const id = (
      await database.query(
        "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES($1,$2,$3,'Biljeske','Test','1990-01-01',$4,now(),'+38267123456') RETURNING id",
        [email, hash, name, role],
      )
    ).rows[0].id;
    ids.push(id);
    emails.push(email);
  }
  const therapistIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const therapistId = (
      await database.query(
        "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city) VALUES($1,'Terapeut Biljeske','Psihoterapeut','Psychotherapist','Podgorica') RETURNING id",
        [ids[index]],
      )
    ).rows[0].id;
    therapistIds.push(therapistId);
    const serviceId = (
      await database.query(
        "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes) VALUES($1,'Seansa','Session',50) RETURNING id",
        [therapistId],
      )
    ).rows[0].id;
    for (const clientIndex of index === 0 ? [2, 3] : [2])
      await database.query(
        `INSERT INTO booking_requests(client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status)
      VALUES($1,$2,$3,'Seansa',50,$4,$5,'+38267123456',($6::date+interval '9 hours'+$7*interval '1 hour') AT TIME ZONE 'Europe/Podgorica',($6::date+interval '9 hours 50 minutes'+$7*interval '1 hour') AT TIME ZONE 'Europe/Podgorica','REQUESTED')`,
        [
          ids[clientIndex],
          therapistId,
          serviceId,
          clientIndex === 2 ? "Klijent Jedan" : "Klijent Dva",
          emails[clientIndex],
          addDays(dateKey(), 2),
          clientIndex - 2,
        ],
      );
  }
  return { ids, emails, therapistIds };
}

/** Prijavljuje stvarni nalog kroz API; JWT ostaje HttpOnly kolačić konteksta browsera. */
async function signIn(context: BrowserContext, email: string) {
  const response = await context.request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { email, password },
  });
  expect(response.ok()).toBe(true);
}

// Uređivanje i promjena klijenta prolaze kroz UI; zabranjene radnje pokušavamo i direktnim HTTP pozivima.
test("private notes persist by client and stay inaccessible to clients and other therapists", async ({
  page,
  context,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(180000);
  const data = await fixture();
  expect((await request.get("/api/v1/therapist-notes/clients")).status()).toBe(
    401,
  );
  await signIn(context, data.emails[0]);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Moj nalog", exact: true }).click();
  await page
    .locator("#account-dropdown")
    .getByRole("link", { name: "Privatne bilješke", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/notes$/);
  await expect(
    page.getByRole("heading", { name: "Privatne bilješke", exact: true }),
  ).toBeVisible();
  const picker = page.getByRole("combobox", { name: "Klijent", exact: true });
  await picker.selectOption(data.ids[2]);
  await expect(
    page.getByText("Za ovog klijenta još nemate privatnih bilješki.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Dodaj bilješku", exact: true })
    .click();
  await expect(picker).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Naslov bilješke", exact: true })
    .fill("Privatna seansa");
  await page
    .getByRole("textbox", { name: "Tekst bilješke", exact: true })
    .fill("Privatni tekst prvog terapeuta.\nDrugi red ostaje sačuvan.");
  await page.route("**/api/v1/therapist-notes", async (route) => {
    if (route.request().method() === "POST")
      await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Sačuvaj bilješku", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Čuvanje bilješke…", exact: true }),
  ).toBeDisabled();
  const card = page.getByRole("article", {
    name: "Privatna seansa",
    exact: true,
  });
  await expect(card).toContainText("Privatni tekst prvog terapeuta.");
  await expect(
    page.getByText("Bilješka je sačuvana. Vidljiva je samo vama.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.unroute("**/api/v1/therapist-notes");
  const stored = await page.request.get(
    `/api/v1/therapist-notes?clientId=${data.ids[2]}`,
  );
  expect(stored.headers()["cache-control"]).toContain("no-store");
  const note = (await stored.json()).notes[0];
  await page.reload();
  await picker.selectOption(data.ids[2]);
  await expect(card).toContainText("Drugi red ostaje sačuvan.");
  await picker.selectOption(data.ids[3]);
  await expect(card).toHaveCount(0);
  await page
    .getByRole("button", { name: "Dodaj bilješku", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Naslov bilješke", exact: true })
    .fill("Drugi klijent");
  await page
    .getByRole("textbox", { name: "Tekst bilješke", exact: true })
    .fill("Odvojena bilješka drugog klijenta.");
  await page
    .getByRole("button", { name: "Sačuvaj bilješku", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Drugi klijent", exact: true }),
  ).toBeVisible();
  await picker.selectOption(data.ids[2]);
  await card
    .getByRole("button", { name: "Uredi bilješku", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Tekst bilješke", exact: true })
    .fill("Sačuvana izmjena u aplikaciji.");
  await page
    .getByRole("button", { name: "Sačuvaj bilješku", exact: true })
    .click();
  await expect(card).toContainText("Sačuvana izmjena u aplikaciji.");
  const updatedNotes = await (
    await page.request.get(`/api/v1/therapist-notes?clientId=${data.ids[2]}`)
  ).json();
  const currentVersion = updatedNotes.notes.find(
    (item: { id: string }) => item.id === note.id,
  ).version;
  await card
    .getByRole("button", { name: "Uredi bilješku", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Tekst bilješke", exact: true })
    .fill("Moja nesacuvana izmjena.");
  // Drugi tab istog autora čuva noviju verziju; prvi tab mora zadržati svoj unos i prikazati konflikt.
  const newer = await page.request.post(
    `/api/v1/therapist-notes/${note.id}/update`,
    {
      headers: { Origin: origin },
      data: {
        clientUserId: data.ids[2],
        title: "Privatna seansa",
        content: "Novija sačuvana verzija.",
        version: currentVersion,
      },
    },
  );
  expect(newer.ok()).toBe(true);
  await page
    .getByRole("button", { name: "Sačuvaj bilješku", exact: true })
    .click();
  await expect(page.locator(".notes-page").getByRole("alert")).toContainText(
    "međuvremenu izmijenjena",
  );
  await expect(
    page.getByRole("textbox", { name: "Tekst bilješke", exact: true }),
  ).toHaveValue("Moja nesacuvana izmjena.");
  await page.getByRole("button", { name: "Odustani", exact: true }).click();
  await page
    .getByRole("button", { name: "Osvježi bilješke", exact: true })
    .click();
  await expect(card).toContainText("Novija sačuvana verzija.");
  // Veliki UTF-8 tekst prolazi poseban JSON limit API-ja, ali ostaje ograničen na 20000 znakova.
  const longText = "Ž".repeat(15000);
  const large = await page.request.post("/api/v1/therapist-notes", {
    headers: { Origin: origin },
    data: {
      clientUserId: data.ids[3],
      title: "Duga bilješka",
      content: longText,
    },
  });
  expect(large.ok()).toBe(true);
  expect((await large.json()).note.content.length).toBe(15000);
  const clientContext = await browser.newContext({ baseURL: origin });
  const otherContext = await browser.newContext({ baseURL: origin });
  try {
    await signIn(clientContext, data.emails[2]);
    await signIn(otherContext, data.emails[1]);
    for (const path of [
      "/api/v1/therapist-notes/clients",
      `/api/v1/therapist-notes?clientId=${data.ids[2]}`,
    ])
      expect((await clientContext.request.get(path)).status()).toBe(403);
    expect(
      (
        await clientContext.request.post(
          `/api/v1/therapist-notes/${note.id}/update`,
          {
            headers: { Origin: origin },
            data: {
              clientUserId: data.ids[2],
              title: "Pokusaj",
              content: "Pokusaj",
              version: 2,
            },
          },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await clientContext.request.post(
          `/api/v1/therapist-notes/${note.id}/archive`,
          { headers: { Origin: origin }, data: { version: 2 } },
        )
      ).status(),
    ).toBe(403);
    const otherList = await otherContext.request.get(
      `/api/v1/therapist-notes?clientId=${data.ids[2]}`,
    );
    expect((await otherList.json()).notes).toEqual([]);
    expect(
      (
        await otherContext.request.post(
          `/api/v1/therapist-notes/${note.id}/update`,
          {
            headers: { Origin: origin },
            data: {
              clientUserId: data.ids[2],
              title: "Pokusaj",
              content: "Pokusaj",
              version: 2,
            },
          },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await otherContext.request.post(
          `/api/v1/therapist-notes/${note.id}/archive`,
          { headers: { Origin: origin }, data: { version: 2 } },
        )
      ).status(),
    ).toBe(404);
    const clientPage = await clientContext.newPage();
    await clientPage.goto("/account");
    await clientPage
      .getByRole("button", { name: "Moj nalog", exact: true })
      .click();
    await expect(
      clientPage
        .locator("#account-dropdown")
        .getByRole("link", { name: "Privatne bilješke", exact: true }),
    ).toHaveCount(0);
    expect(
      await (await clientContext.request.get("/api/v1/bookings")).text(),
    ).not.toContain("Novija sačuvana verzija.");
    expect(
      await (
        await clientContext.request.get("/api/v1/client-materials")
      ).text(),
    ).not.toContain("Novija sačuvana verzija.");
    expect(
      (
        await page.request.post("/api/v1/therapist-notes", {
          headers: { Origin: "https://untrusted.example" },
          data: {
            clientUserId: data.ids[2],
            title: "Pokusaj",
            content: "Pokusaj",
          },
        })
      ).status(),
    ).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("private-notes-mobile.png"),
      fullPage: true,
    });
    page.once("dialog", (dialog) => dialog.accept());
    await card
      .getByRole("button", { name: "Arhiviraj bilješku", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    expect(
      (
        await database.query(
          "SELECT archived_at FROM therapist_client_notes WHERE id=$1",
          [note.id],
        )
      ).rows[0].archived_at,
    ).toBeTruthy();
    // Brzi link iz kartice termina otvara već izabranog klijenta.
    await page.goto("/dashboard");
    await page
      .getByRole("link", { name: "Privatne bilješke za klijenta", exact: true })
      .first()
      .click();
    await expect(picker).toHaveValue(data.ids[2]);
  } finally {
    await clientContext.close();
    await otherContext.close();
  }
});
