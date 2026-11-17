import "../src/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { addDays, dateKey } from "@terapeut/domain";
import { DatabaseService } from "../src/database.service";
import { AuthService } from "../src/auth/auth.service";
import type { AccountUser } from "../src/auth/auth.types";
import { MaterialsService } from "../src/materials/materials.service";
import {
  validateMaterial,
  validateMaterialFile,
} from "../src/materials/materials.validation";
import { createMaterialTestPdf } from "../../../tests/fixtures/material-pdf";

// Serverska provjera ne vjeruje MIME nazivu, nastavku datoteke ili browser validaciji.
test("materials reject unsafe links, incomplete instructions and fake or oversized PDF files", () => {
  const input = {
    title: "Zadatak",
    kind: "HOMEWORK",
    instructions: "Pročitajte priloženi materijal.",
    resourceUrl: "",
    dueDate: "",
  };
  for (const change of [
    { title: "" },
    { kind: "OTHER" },
    { instructions: "x".repeat(10001) },
    { resourceUrl: "javascript:alert(1)" },
    { resourceUrl: "data:text/html,test" },
    { resourceUrl: "https://user:pass@example.test" },
    { dueDate: "2026-02-30" },
  ]) {
    assert.throws(() => validateMaterial({ ...input, ...change }));
  }
  assert.equal(
    validateMaterial({ ...input, resourceUrl: "https://example.test/material" })
      .resourceUrl,
    "https://example.test/material",
  );
  const pdf = createMaterialTestPdf();
  const valid = { buffer: pdf, size: pdf.length, originalname: "dnevnik.pdf" };
  assert.deepEqual(validateMaterialFile(valid)!.data, pdf);
  assert.equal(
    validateMaterialFile({ ...valid, originalname: "../../dnevnik.pdf" })!.name,
    "dnevnik.pdf",
  );
  assert.equal(
    validateMaterialFile({
      ...valid,
      originalname: Buffer.from("domaći.pdf", "utf8").toString("latin1"),
    })!.name,
    "domaći.pdf",
  );
  assert.throws(() =>
    validateMaterialFile({
      ...valid,
      buffer: Buffer.from("<html>fake PDF</html>"),
      size: 21,
    }),
  );
  assert.throws(() =>
    validateMaterialFile({ ...valid, size: 5 * 1024 * 1024 + 1 }),
  );
  assert.throws(() =>
    validateMaterialFile({ ...valid, originalname: "test.html" }),
  );
  assert.throws(() =>
    validateMaterialFile({ ...valid, buffer: pdf.subarray(0, 30), size: 30 }),
  );
});

// Stvarna baza provjerava privatnost i atomsko čuvanje; JWT potpis i kolačić pokrivaju browser testovi.
test(
  "private materials stay restricted to the assigned client and the owning therapist",
  { skip: !process.env.AUTH_TEST_DATABASE_URL },
  async (context) => {
    const admin = new Pool({
      connectionString: process.env.AUTH_TEST_DATABASE_URL,
    });
    const schema = `auth_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.AUTH_TEST_DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    const database = new DatabaseService();
    const accounts = new Map<string, AccountUser>();
    const auth = {
      /** Predstavlja već provjerenu sesiju i odbija nepoznate identitete. */
      async getAccount(token: string) {
        const user = accounts.get(token);
        if (!user) throw new Error("No test session");
        return user;
      },
      /** Ograničavanje pokušaja je provjereno postojećim auth testovima. */
      async limitAttempts() {},
    } as unknown as AuthService;
    const materials = new MaterialsService(database, auth);
    context.after(async () => {
      await database.pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
    const root = resolve(__dirname, "../../../db");
    await database.pool.query(
      await readFile(resolve(root, "schema.sql"), "utf8"),
    );
    for (const name of (await readdir(resolve(root, "migrations")))
      .filter((name) => /^\d+-.*\.sql$/.test(name))
      .sort()) {
      await database.pool.query(
        await readFile(resolve(root, "migrations", name), "utf8"),
      );
    }

    /** Kreira dva terapeuta i tri nezavisna klijenta samo u testnoj šemi. */
    async function fixture() {
      const tokens: string[] = [];
      for (const role of [
        "THERAPIST",
        "THERAPIST",
        "CLIENT",
        "CLIENT",
        "CLIENT",
      ] as const) {
        const token = randomUUID();
        const email = `${token}@example.test`;
        const user = (
          await database.pool.query(
            "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,'unused','Materijal Test','Materijal','Test','1990-01-01',$2,now(),'+38267123456') RETURNING id",
            [email, role],
          )
        ).rows[0];
        accounts.set(token, {
          id: user.id,
          email,
          role,
          firstName: "Materijal",
          lastName: "Test",
        } as AccountUser);
        tokens.push(token);
      }
      const therapistIds: string[] = [];
      for (const token of tokens.slice(0, 2)) {
        const therapist = (
          await database.pool.query(
            "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city) VALUES ($1,'Materijal Terapeut','Psihoterapeut','Psychotherapist','Podgorica') RETURNING id",
            [accounts.get(token)!.id],
          )
        ).rows[0].id;
        therapistIds.push(therapist);
        const service = (
          await database.pool.query(
            "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes) VALUES ($1,'Seansa','Session',50) RETURNING id",
            [therapist],
          )
        ).rows[0].id;
        await database.pool.query(
          `INSERT INTO booking_requests(client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status,confirmed_at)
        VALUES ($1,$2,$3,'Seansa',50,'Materijal Test',$4,'+38267123456',($5::date+interval '9 hours') AT TIME ZONE 'Europe/Podgorica',($5::date+interval '9 hours 50 minutes') AT TIME ZONE 'Europe/Podgorica','CONFIRMED',now())`,
          [
            accounts.get(tokens[2])!.id,
            therapist,
            service,
            accounts.get(tokens[2])!.email,
            addDays(dateKey(), 2),
          ],
        );
      }
      return {
        owner: tokens[0],
        otherOwner: tokens[1],
        client: tokens[2],
        otherClient: tokens[3],
        stranger: tokens[4],
        therapist: therapistIds[0],
        clientId: accounts.get(tokens[2])!.id,
      };
    }

    /** Priprema tekstualni zadatak koji može imati dodatni PDF ili preporučeni link. */
    function input(clientUserId: string, changes: Record<string, string> = {}) {
      return {
        clientUserId,
        title: "Zadatak za sljedeću seansu",
        kind: "HOMEWORK",
        instructions: "Pročitajte uputstvo prije sljedeće seanse.",
        resourceUrl: "",
        dueDate: addDays(dateKey(), 7),
        ...changes,
      };
    }

    await context.test(
      "client lists and PDF downloads are isolated, including between two therapists of the same client",
      async () => {
        const data = await fixture();
        const pdf = createMaterialTestPdf();
        const created = await materials.save(data.owner, input(data.clientId), {
          buffer: pdf,
          size: pdf.length,
          originalname: "zadatak.pdf",
        });
        const ownList = await materials.list(data.owner);
        assert.equal(ownList.clients.length, 1);
        assert.equal(ownList.materials.length, 1);
        assert.equal("file_data" in ownList.materials[0], false);
        assert.equal(
          (await materials.list(data.client)).materials[0].id,
          created.id,
        );
        assert.deepEqual(
          (await materials.download(data.client, created.id)).data,
          pdf,
        );
        assert.deepEqual(
          (await materials.download(data.owner, created.id)).data,
          pdf,
        );
        assert.equal(
          (await materials.list(data.otherOwner)).materials.length,
          0,
        );
        assert.equal(
          (await materials.list(data.otherClient)).materials.length,
          0,
        );
        for (const token of [data.otherOwner, data.otherClient, data.stranger])
          await assert.rejects(materials.download(token, created.id));
        await assert.rejects(materials.download(undefined, created.id));
        await assert.rejects(materials.save(data.client, input(data.clientId)));
        await assert.rejects(
          materials.save(data.owner, input(accounts.get(data.otherClient)!.id)),
        );
        await assert.rejects(
          materials.save(
            data.otherOwner,
            input(data.clientId, { version: "1" }),
            undefined,
            created.id,
          ),
        );
        await assert.rejects(
          materials.archive(data.otherOwner, created.id, { version: "1" }),
        );
        await assert.rejects(
          materials.archive(data.client, created.id, { version: "1" }),
        );
        const other = await materials.save(
          data.otherOwner,
          input(data.clientId, { kind: "JOURNAL", title: "Drugi terapeut" }),
        );
        assert.equal((await materials.list(data.client)).materials.length, 2);
        assert.equal((await materials.list(data.owner)).materials.length, 1);
        await assert.rejects(materials.download(data.owner, other.id));
      },
    );

    await context.test(
      "pending requests do not establish a client relationship",
      async () => {
        const data = await fixture();
        await database.pool.query(
          "UPDATE booking_requests SET status='REQUESTED',confirmed_at=NULL WHERE therapist_id=$1",
          [data.therapist],
        );
        assert.equal((await materials.list(data.owner)).clients.length, 0);
        await assert.rejects(materials.save(data.owner, input(data.clientId)));
      },
    );

    await context.test(
      "editing retains the PDF and recipient, rejects stale versions and can replace or remove the attachment",
      async () => {
        const data = await fixture();
        const pdf = createMaterialTestPdf();
        const created = await materials.save(data.owner, input(data.clientId), {
          buffer: pdf,
          size: pdf.length,
          originalname: "prvi.pdf",
        });
        await materials.save(
          data.owner,
          input(accounts.get(data.otherClient)!.id, {
            version: "1",
            title: "Novo uputstvo",
          }),
          undefined,
          created.id,
        );
        const updated = (await materials.list(data.client)).materials[0];
        assert.equal(updated.clientUserId, data.clientId);
        assert.equal(updated.title, "Novo uputstvo");
        assert.equal(updated.fileName, "prvi.pdf");
        assert.equal(updated.version, 2);
        await assert.rejects(
          materials.save(
            data.owner,
            input(data.clientId, { version: "1", title: "Stari tab" }),
            undefined,
            created.id,
          ),
        );
        await assert.rejects(
          materials.archive(data.owner, created.id, { version: "1" }),
        );
        await materials.save(
          data.owner,
          input(data.clientId, { version: "2" }),
          { buffer: pdf, size: pdf.length, originalname: "novi.pdf" },
          created.id,
        );
        assert.equal(
          (await materials.download(data.client, created.id)).name,
          "novi.pdf",
        );
        await materials.save(
          data.owner,
          input(data.clientId, { version: "3", removeFile: "true" }),
          undefined,
          created.id,
        );
        assert.equal(
          (await materials.list(data.client)).materials[0].fileName,
          null,
        );
        await assert.rejects(materials.download(data.client, created.id));
      },
    );

    await context.test(
      "empty or invalid edits preserve the existing attachment and document",
      async () => {
        const data = await fixture();
        const pdf = createMaterialTestPdf();
        const created = await materials.save(
          data.owner,
          input(data.clientId, { instructions: "" }),
          { buffer: pdf, size: pdf.length, originalname: "samo-prilog.pdf" },
        );
        await assert.rejects(
          materials.save(
            data.owner,
            input(data.clientId, {
              version: "1",
              instructions: "",
              removeFile: "true",
            }),
            undefined,
            created.id,
          ),
        );
        await assert.rejects(
          materials.save(
            data.owner,
            input(data.clientId, { version: "1" }),
            {
              buffer: Buffer.from("invalid"),
              size: 7,
              originalname: "fake.pdf",
            },
            created.id,
          ),
        );
        assert.equal(
          (await materials.list(data.client)).materials[0].version,
          1,
        );
        assert.deepEqual(
          (await materials.download(data.client, created.id)).data,
          pdf,
        );
        await assert.rejects(
          materials.save(
            data.owner,
            input(data.clientId, { instructions: "" }),
          ),
        );
      },
    );

    await context.test(
      "archiving immediately removes both listings and closes the download",
      async () => {
        const data = await fixture();
        const pdf = createMaterialTestPdf();
        const created = await materials.save(data.owner, input(data.clientId), {
          buffer: pdf,
          size: pdf.length,
          originalname: "za-povlacenje.pdf",
        });
        await materials.archive(data.owner, created.id, { version: "1" });
        assert.equal((await materials.list(data.client)).materials.length, 0);
        assert.equal((await materials.list(data.owner)).materials.length, 0);
        await assert.rejects(materials.download(data.client, created.id));
        await assert.rejects(
          materials.save(
            data.owner,
            input(data.clientId, { version: "2" }),
            undefined,
            created.id,
          ),
        );
        assert.ok(
          (
            await database.pool.query(
              "SELECT archived_at FROM client_materials WHERE id=$1",
              [created.id],
            )
          ).rows[0].archived_at,
        );
      },
    );
  },
);
