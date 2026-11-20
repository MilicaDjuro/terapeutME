import "../src/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { DatabaseService } from "../src/database.service";
import { AuthService } from "../src/auth/auth.service";
import type { AccountUser } from "../src/auth/auth.types";
import { TherapistNotesService } from "../src/notes/therapist-notes.service";

// Prava testna šema provjerava privatnost između autora, istog klijenta i drugog terapeuta.
test(
  "therapist notes remain private to the author and persist separately for every client",
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
    context.after(async () => {
      await database.pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
    const root = resolve(__dirname, "../../../db");
    await database.pool.query(
      await readFile(resolve(root, "schema.sql"), "utf8"),
    );
    for (const file of (await readdir(resolve(root, "migrations")))
      .filter((name) => /^\d+-.*\.sql$/.test(name))
      .sort())
      await database.pool.query(
        await readFile(resolve(root, "migrations", file), "utf8"),
      );
    const accounts = new Map<string, AccountUser>();
    const auth = {
      /** Zamjenjuje već provjeren JWT samo u izolovanom testu; nepoznate sesije odbija. */
      async getAccount(token: string) {
        const user = accounts.get(token);
        if (!user) throw new Error("No test session");
        return user;
      },
      /** Postojeći auth testovi pokrivaju trajno ograničenje pokušaja. */
      async limitAttempts() {},
    } as unknown as AuthService;
    const notes = new TherapistNotesService(database, auth);
    const tokens: string[] = [];
    for (const role of [
      "THERAPIST",
      "THERAPIST",
      "CLIENT",
      "CLIENT",
      "CLIENT",
      "ADMIN",
    ] as const) {
      const id = (
        await database.pool.query(
          "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at) VALUES($1,'unused','Biljeska Test','Biljeska','Test','1990-01-01',$2,now()) RETURNING id",
          [`${randomUUID()}@example.test`, role],
        )
      ).rows[0].id;
      tokens.push(id);
      accounts.set(id, { id, role } as AccountUser);
    }
    const [owner, otherOwner, clientA, clientB, stranger, administrator] =
      tokens;
    const therapistIds: string[] = [];
    for (const [index, userId] of [owner, otherOwner].entries()) {
      const therapistId = (
        await database.pool.query(
          "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city) VALUES($1,'Terapeut Biljeske','Psihoterapeut','Psychotherapist','Podgorica') RETURNING id",
          [userId],
        )
      ).rows[0].id;
      therapistIds.push(therapistId);
      const serviceId = (
        await database.pool.query(
          "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes) VALUES($1,'Seansa','Session',50) RETURNING id",
          [therapistId],
        )
      ).rows[0].id;
      for (const [clientIndex, clientId] of (index === 0
        ? [clientA, clientB]
        : [clientA]
      ).entries()) {
        await database.pool.query(
          `INSERT INTO booking_requests(client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status)
        VALUES($1,$2,$3,'Seansa',50,'Test','test@example.test','+38267123456',now()+interval '4 days'+$4*interval '1 hour',now()+interval '4 days'+$4*interval '1 hour'+interval '50 minutes','REQUESTED')`,
          [clientId, therapistId, serviceId, clientIndex],
        );
      }
    }
    /** Pravi sintetički unos; pravi sadržaj bilješki se ne koristi u testovima. */
    function input(
      clientUserId = clientA,
      changes: Record<string, unknown> = {},
    ) {
      return {
        clientUserId,
        title: "Privatna bilješka",
        content: "Prvi red.\nDrugi red.",
        ...changes,
      };
    }
    let firstId = "";
    let latestVersion = 1;
    await context.test(
      "sessions, roles, client relationships and text limits are checked on the server",
      async () => {
        await assert.rejects(notes.clients(undefined));
        for (const token of [clientA, clientB, administrator]) {
          await assert.rejects(notes.clients(token), /samo terapeutu/);
          await assert.rejects(notes.list(token, clientA), /samo terapeutu/);
          await assert.rejects(
            notes.save(token, input()),
            /samo njihov terapeut/,
          );
          await assert.rejects(
            notes.archive(token, randomUUID(), { version: 1 }),
            /samo terapeutu/,
          );
        }
        assert.deepEqual(
          new Set(
            (await notes.clients(owner)).clients.map((client) => client.id),
          ),
          new Set([clientA, clientB]),
        );
        assert.deepEqual(
          (await notes.clients(otherOwner)).clients.map((client) => client.id),
          [clientA],
        );
        await assert.rejects(notes.list(owner, stranger), /svog klijenta/);
        await assert.rejects(
          notes.save(owner, input(stranger)),
          /svog klijenta/,
        );
        for (const changes of [
          { title: " " },
          { content: "" },
          { title: "x".repeat(161) },
          { content: "x".repeat(20001) },
          { content: "a\0b" },
          { content: 123 },
        ])
          await assert.rejects(notes.save(owner, input(clientA, changes)));
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*)::integer AS count FROM therapist_client_notes",
            )
          ).rows[0].count,
          0,
        );
      },
    );
    await context.test(
      "multiple notes persist by client and cancelled bookings keep the author's relationship",
      async () => {
        const first = await notes.save(owner, input());
        firstId = first.note.id;
        await notes.save(owner, input(clientA, { title: "Druga bilješka" }));
        await notes.save(
          owner,
          input(clientB, { content: "Samo drugi klijent." }),
        );
        assert.equal((await notes.list(owner, clientA)).notes.length, 2);
        assert.equal((await notes.list(owner, clientB)).notes.length, 1);
        assert.equal(first.note.content, "Prvi red.\nDrugi red.");
        assert.ok(first.note.createdAt);
        await database.pool.query(
          "UPDATE booking_requests SET status='CANCELLED' WHERE therapist_id=$1",
          [therapistIds[0]],
        );
        assert.equal((await notes.list(owner, clientA)).notes.length, 2);
        const stored = (
          await database.pool.query(
            "SELECT content FROM therapist_client_notes WHERE id=$1",
            [firstId],
          )
        ).rows[0];
        assert.equal(stored.content, first.note.content);
      },
    );
    await context.test(
      "same-client therapist cannot read, edit or archive the other author's note",
      async () => {
        assert.deepEqual((await notes.list(otherOwner, clientA)).notes, []);
        await assert.rejects(
          notes.save(otherOwner, input(clientA, { version: 1 }), firstId),
          /nije pronađena/,
        );
        await assert.rejects(
          notes.archive(otherOwner, firstId, { version: 1 }),
          /nije pronađena/,
        );
        await notes.save(
          otherOwner,
          input(clientA, { title: "Samo drugi terapeut" }),
        );
        assert.equal(
          (await notes.list(owner, clientA)).notes.some(
            (note) => note.title === "Samo drugi terapeut",
          ),
          false,
        );
      },
    );
    await context.test(
      "editing preserves client and creation date; stale versions cannot overwrite changes",
      async () => {
        const original = (await notes.list(owner, clientA)).notes.find(
          (note) => note.id === firstId,
        )!;
        const changed = await notes.save(
          owner,
          input(clientA, {
            version: 1,
            title: "Uređeno",
            content: "Sačuvana izmjena.",
          }),
          firstId,
        );
        assert.equal(changed.note.version, 2);
        latestVersion = 2;
        assert.equal(changed.note.createdAt, original.createdAt);
        await assert.rejects(
          notes.save(owner, input(clientB, { version: 2 }), firstId),
          /ne može se promijeniti/,
        );
        await assert.rejects(
          notes.save(owner, input(clientA, { version: 1 }), firstId),
          /međuvremenu izmijenjena/,
        );
        await assert.rejects(
          notes.archive(owner, firstId, { version: 1 }),
          /međuvremenu izmijenjena/,
        );
        const results = await Promise.allSettled([
          notes.save(
            owner,
            input(clientA, { version: 2, content: "Izmjena A" }),
            firstId,
          ),
          notes.save(
            owner,
            input(clientA, { version: 2, content: "Izmjena B" }),
            firstId,
          ),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        assert.equal(
          results.filter((result) => result.status === "rejected").length,
          1,
        );
        latestVersion = 3;
        assert.equal(
          (await notes.list(owner, clientA)).notes.find(
            (note) => note.id === firstId,
          )!.version,
          3,
        );
      },
    );
    await context.test(
      "failed saving rolls back and archiving leaves other clients' notes intact",
      async () => {
        await database.pool.query(
          "CREATE FUNCTION reject_note_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic write failure'; END $$; CREATE TRIGGER reject_note_write BEFORE UPDATE ON therapist_client_notes FOR EACH ROW EXECUTE FUNCTION reject_note_write()",
        );
        await assert.rejects(
          notes.save(
            owner,
            input(clientA, { version: latestVersion }),
            firstId,
          ),
        );
        await database.pool.query(
          "DROP TRIGGER reject_note_write ON therapist_client_notes; DROP FUNCTION reject_note_write()",
        );
        assert.equal(
          (await notes.list(owner, clientA)).notes.find(
            (note) => note.id === firstId,
          )!.version,
          latestVersion,
        );
        assert.equal(
          (await notes.archive(owner, firstId, { version: latestVersion }))
            .archived,
          true,
        );
        assert.equal((await notes.list(owner, clientA)).notes.length, 1);
        assert.equal((await notes.list(owner, clientB)).notes.length, 1);
        await assert.rejects(
          notes.save(
            owner,
            input(clientA, { version: latestVersion }),
            firstId,
          ),
          /nije pronađena/,
        );
        const archived = (
          await database.pool.query(
            "SELECT archived_at,content FROM therapist_client_notes WHERE id=$1",
            [firstId],
          )
        ).rows[0];
        assert.ok(archived.archived_at);
        assert.ok(archived.content);
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*)::integer AS count FROM client_materials",
            )
          ).rows[0].count,
          0,
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*)::integer AS count FROM notification_outbox",
            )
          ).rows[0].count,
          0,
        );
      },
    );
  },
);
