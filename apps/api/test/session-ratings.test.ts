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
import { SessionRatingService } from "../src/bookings/session-rating.service";
import { BookingRepository } from "../src/bookings/booking.repository";
import { DirectoryService } from "../src/directory/directory.service";

// Svaki upis ide u privremenu šemu; test ne ocjenjuje stvarne terapeute ili klijente.
test(
  "session ratings enforce ownership, completion and one score per booking",
  {
    skip: !process.env.AUTH_TEST_DATABASE_URL,
  },
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
      .sort()) {
      await database.pool.query(
        await readFile(resolve(root, "migrations", file), "utf8"),
      );
    }
    const accounts = new Map<string, AccountUser>();
    const auth = {
      /** Test zamjenjuje samo provjeru JWT-a; browser provjerava stvarnu sesiju. */
      async getAccount(token: string) {
        const user = accounts.get(token);
        if (!user) throw new Error("No test session");
        return user;
      },
      /** Ograničenje pokušaja je pokriveno postojećim auth testovima. */
      async limitAttempts() {},
    } as unknown as AuthService;
    const ratings = new SessionRatingService(database, auth);
    const directory = new DirectoryService(database);
    const repository = new BookingRepository(database);
    const users: string[] = [];
    for (const role of [
      "CLIENT",
      "CLIENT",
      "CLIENT",
      "THERAPIST",
      "ADMIN",
    ] as const) {
      const id = (
        await database.pool.query(
          "INSERT INTO users(email,password_hash,full_name,role,verified_at) VALUES($1,'unused','Ocjena Test',$2,now()) RETURNING id",
          [`${randomUUID()}@example.test`, role],
        )
      ).rows[0].id;
      users.push(id);
      accounts.set(id, { id, role } as AccountUser);
    }
    const [clientA, clientB, stranger, therapistUser, administrator] = users;
    const therapists: string[] = [];
    const services: string[] = [];
    for (let index = 0; index < 2; index++) {
      const therapistId = (
        await database.pool.query(
          "INSERT INTO therapists(full_name,title_mne,title_en,city) VALUES('Ocjena Terapeut','Terapeut','Therapist','Podgorica') RETURNING id",
        )
      ).rows[0].id;
      therapists.push(therapistId);
      services.push(
        (
          await database.pool.query(
            "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes) VALUES($1,'Seansa','Session',50) RETURNING id",
            [therapistId],
          )
        ).rows[0].id,
      );
    }
    let bookingNumber = 0;
    /** Pravi odvojene prošle seanse; buduća završena seansa namjerno testira serverski sat. */
    async function createBooking(
      status = "COMPLETED",
      clientId = clientA,
      therapistIndex = 0,
      future = false,
    ) {
      bookingNumber += 1;
      return (
        await database.pool.query(
          `INSERT INTO booking_requests(client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status)
       VALUES($1,$2,$3,'Seansa',50,'Klijent','test@example.test','+38267123456',
       now()+$4*interval '1 day',now()+$4*interval '1 day'+interval '50 minutes',$5) RETURNING id`,
          [
            clientId,
            therapists[therapistIndex],
            services[therapistIndex],
            future ? bookingNumber : -bookingNumber,
            status,
          ],
        )
      ).rows[0].id as string;
    }
    const firstBooking = await createBooking("CONFIRMED");
    await context.test(
      "requires a client session, ownership and an integer from 1 to 5",
      async () => {
        await assert.rejects(
          ratings.save(undefined, firstBooking, { score: 5 }),
        );
        for (const token of [therapistUser, administrator]) {
          await assert.rejects(
            ratings.save(token, firstBooking, { score: 5 }),
            /samo njen klijent/,
          );
        }
        for (const id of [firstBooking, randomUUID(), "invalid"]) {
          await assert.rejects(
            ratings.save(stranger, id, { score: 5 }),
            /nije pronađena/,
          );
        }
        for (const score of [0, 6, -1, 2.5, true, null, "", "5x", {}, []]) {
          await assert.rejects(ratings.save(clientA, firstBooking, { score }));
        }
        for (const body of [null, [], "5"]) {
          await assert.rejects(ratings.save(clientA, firstBooking, body));
        }
      },
    );
    await context.test(
      "rejects unconfirmed or missed sessions and sessions whose end is still ahead",
      async () => {
        for (const status of [
          "REQUESTED",
          "ALTERNATIVE_PROPOSED",
          "DECLINED",
          "CANCELLED",
          "EXPIRED_PROVIDER",
          "EXPIRED_CLIENT",
          "NO_SHOW",
        ]) {
          const id = await createBooking(status);
          await assert.rejects(
            ratings.save(clientA, id, { score: 5 }),
            /nakon završetka/,
          );
        }
        const futureId = await createBooking("COMPLETED", clientA, 0, true);
        const confirmedFuture = await createBooking(
          "CONFIRMED",
          clientA,
          0,
          true,
        );
        const ongoing = await createBooking("CONFIRMED");
        await database.pool.query(
          "UPDATE booking_requests SET start_at=now()-interval '10 minutes',end_at=now()+interval '40 minutes' WHERE id=$1",
          [ongoing],
        );
        for (const id of [futureId, confirmedFuture, ongoing]) {
          await assert.rejects(
            ratings.save(clientA, id, { score: 5 }),
            /nakon završetka/,
          );
        }
        const eligible = (
          await repository.list(database.pool, undefined, clientA)
        ).find((booking) => booking.id === firstBooking)!;
        assert.equal(eligible.canRate, true);
        assert.equal(eligible.rating, null);
        assert.equal(
          (await repository.list(database.pool, undefined, clientA)).find(
            (booking) => booking.id === futureId,
          )!.canRate,
          false,
        );
        const profile = (await directory.list(database.pool, therapists[0]))[0];
        assert.equal(profile.ratingTotal, 0);
        assert.equal(profile.ratingCount, 0);
      },
    );
    await context.test(
      "parallel clicks and retries save exactly one score and cannot change it",
      async () => {
        const results = await Promise.all([
          ratings.save(clientA, firstBooking, { score: 5 }),
          ratings.save(clientA, firstBooking, { score: "5" }),
        ]);
        assert.deepEqual(results, [{ rating: 5 }, { rating: 5 }]);
        await assert.rejects(
          ratings.save(clientA, firstBooking, { score: 1 }),
          /već ocijenjena/,
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*)::int AS count FROM session_ratings",
            )
          ).rows[0].count,
          1,
        );
        const own = (
          await repository.list(database.pool, undefined, clientA)
        ).find((booking) => booking.id === firstBooking)!;
        assert.equal(own.rating, 5);
        assert.equal(own.canRate, false);
        assert.equal(own.status, "CONFIRMED");
        assert.equal(
          (await directory.list(database.pool, therapists[0]))[0].ratingTotal,
          5,
        );
        // Kasnija ručna oznaka završetka ne smije drugi put dodati iste bodove.
        await database.pool.query(
          "UPDATE booking_requests SET status='COMPLETED' WHERE id=$1",
          [firstBooking],
        );
        assert.equal(
          (await directory.list(database.pool, therapists[0]))[0].ratingTotal,
          5,
        );
        const therapist = (
          await repository.list(database.pool, therapists[0])
        ).find((booking) => booking.id === firstBooking)!;
        assert.equal(therapist.rating, null);
        assert.equal(therapist.canRate, false);
      },
    );
    await context.test(
      "sums multiple clients and sessions while keeping therapists and identity separate",
      async () => {
        await ratings.save(clientA, await createBooking(), { score: 3 });
        await ratings.save(clientB, await createBooking("COMPLETED", clientB), {
          score: 4,
          therapistId: therapists[1],
          clientId: clientA,
        });
        await ratings.save(
          clientA,
          await createBooking("COMPLETED", clientA, 1),
          { score: 2 },
        );
        const profile = (await directory.list(database.pool, therapists[0]))[0];
        assert.equal(profile.ratingTotal, 12);
        assert.equal(profile.ratingCount, 3);
        assert.equal(
          (await directory.list(database.pool, therapists[1]))[0].ratingTotal,
          2,
        );
        assert.equal(JSON.stringify(profile).includes(clientA), false);
        assert.equal(JSON.stringify(profile).includes(firstBooking), false);
        assert.equal("ratings" in profile, false);
      },
    );
    await context.test(
      "outcome corrections remove points without deleting the rating or duplicating restored points",
      async () => {
        await database.pool.query(
          "UPDATE booking_requests SET status='NO_SHOW' WHERE id=$1",
          [firstBooking],
        );
        assert.equal(
          (await directory.list(database.pool, therapists[0]))[0].ratingTotal,
          7,
        );
        assert.equal(
          (await directory.list(database.pool, therapists[0]))[0].ratingCount,
          2,
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT score FROM session_ratings WHERE booking_id=$1",
              [firstBooking],
            )
          ).rows[0].score,
          5,
        );
        await database.pool.query(
          "UPDATE booking_requests SET status='COMPLETED' WHERE id=$1",
          [firstBooking],
        );
        await ratings.save(clientA, firstBooking, { score: 5 });
        assert.equal(
          (await directory.list(database.pool, therapists[0]))[0].ratingTotal,
          12,
        );
      },
    );
    await context.test(
      "a database error rolls back and permits a safe retry",
      async () => {
        const id = await createBooking();
        await database.pool
          .query(`CREATE FUNCTION reject_rating() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$;
      CREATE TRIGGER reject_rating BEFORE INSERT ON session_ratings FOR EACH ROW EXECUTE FUNCTION reject_rating()`);
        await assert.rejects(
          ratings.save(clientA, id, { score: 1 }),
          /test failure/,
        );
        await database.pool.query(
          "DROP TRIGGER reject_rating ON session_ratings; DROP FUNCTION reject_rating()",
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT * FROM session_ratings WHERE booking_id=$1",
              [id],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (await directory.list(database.pool, therapists[0]))[0].ratingTotal,
          12,
        );
        await ratings.save(clientA, id, { score: 1 });
        assert.equal(
          (await directory.list(database.pool, therapists[0]))[0].ratingTotal,
          13,
        );
      },
    );
  },
);
