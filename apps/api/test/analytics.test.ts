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
import { AnalyticsService } from "../src/analytics/analytics.service";

// Prava izolovana baza provjerava jedinstvenost, istorijske brojeve i odvajanje vlasnika.
test(
  "profile analytics preserves history, deduplicates views and isolates each therapist",
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
      .sort()) {
      await database.pool.query(
        await readFile(resolve(root, "migrations", file), "utf8"),
      );
    }
    const accounts = new Map<string, AccountUser>();
    const auth = {
      /** Zamjenjuje već provjeren JWT; nepoznati nalog se odbija. */
      async getAccount(token: string) {
        const user = accounts.get(token);
        if (!user) throw new Error("No session");
        return user;
      },
      /** Auth testovi zasebno provjeravaju ograničenje pokušaja. */
      async limitAttempts() {},
    } as unknown as AuthService;
    const analytics = new AnalyticsService(database, auth);
    for (const role of [
      "THERAPIST",
      "THERAPIST",
      "CLIENT",
      "CLIENT",
    ] as const) {
      const id = (
        await database.pool.query(
          "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at) VALUES ($1,'unused','Analytics Test','Analytics','Test','1990-01-01',$2,now()) RETURNING id",
          [`${randomUUID()}@example.test`, role],
        )
      ).rows[0].id;
      accounts.set(id, { id, role } as AccountUser);
    }
    const [owner, otherOwner, client, otherClient] = [...accounts.keys()];
    const therapistIds: string[] = [];
    const services: string[] = [];
    for (const userId of [owner, otherOwner]) {
      const id = (
        await database.pool.query(
          "INSERT INTO therapists(linked_user_id,public_id,full_name,title_mne,title_en,city) VALUES ($1,$2,'Analytics Therapist','Psihoterapeut','Psychotherapist','Podgorica') RETURNING id",
          [userId, `analytics-${randomUUID()}`],
        )
      ).rows[0].id;
      therapistIds.push(id);
      services.push(
        (
          await database.pool.query(
            "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes) VALUES ($1,'Seansa','Session',50) RETURNING id",
            [id],
          )
        ).rows[0].id,
      );
    }
    const therapist = therapistIds[0];
    /** Novo otvaranje dobija novi UUID; ponovljeni HTTP zahtjev namjerno koristi isti UUID. */
    async function recordView(
      token: string | undefined,
      profileId: string,
      viewId = randomUUID(),
      anonymousId?: string,
    ) {
      return analytics.recordView(token, profileId, { viewId }, anonymousId);
    }
    await context.test(
      "roles, missing sessions, invalid periods and unavailable profiles are rejected",
      async () => {
        await assert.rejects(analytics.overview(undefined));
        await assert.rejects(analytics.overview(client), /samo terapeutu/);
        await assert.rejects(
          analytics.recordView(client, therapist, { viewId: "invalid" }),
          /oznaka pregleda/,
        );
        await assert.rejects(recordView(client, "missing"), /nije dostupan/);
        for (const days of ["0", "365", "30.0", "all", "30; DROP TABLE users"])
          await assert.rejects(analytics.overview(owner, days));
        const empty = await analytics.overview(owner, "7");
        assert.equal(empty.conversion, null);
        assert.equal(empty.daily.length, 7);
        assert.equal(empty.totals.views, 0);
      },
    );
    await context.test(
      "each opening counts while duplicate HTTP submissions count once",
      async () => {
        const repeatedId = randomUUID();
        await Promise.all(
          Array.from({ length: 6 }, () =>
            recordView(client, therapist, repeatedId),
          ),
        );
        await recordView(otherClient, therapist);
        const publicId = (
          await database.pool.query(
            "SELECT public_id FROM therapists WHERE id=$1",
            [therapist],
          )
        ).rows[0].public_id;
        await recordView(client, publicId);
        const report = await analytics.overview(owner);
        assert.equal(report.totals.views, 3);
        assert.equal(report.uniqueVisitors, 2);
        assert.equal(report.visitorSummary.repeatViews, 1);
        assert.equal(report.visitorSummary.returningVisitors, 1);
        assert.equal(report.visitors[0].views, 2);
        assert.equal(report.daily.at(-1)!.uniqueVisitors, 2);
        assert.equal(report.daily.at(-1)!.repeatViews, 1);
        assert.equal(report.conversion, 0);
        await database.pool.query(
          "INSERT INTO profile_view_events(therapist_id,user_id,view_id,kind,viewed_at) VALUES ($1,$2,gen_random_uuid(),'CLIENT',now()-interval '8 days')",
          [therapist, client],
        );
        assert.equal((await analytics.overview(owner, "7")).totals.views, 3);
        assert.equal((await analytics.overview(owner, "30")).totals.views, 4);
        assert.equal((await analytics.overview(owner, "30")).uniqueVisitors, 2);
      },
    );

    /** Dodaje rezervaciju bez zauzimanja drugih fixture termina; sve je samo u testnoj šemi. */
    async function booking(
      profileIndex: number,
      clientId: string,
      minute: number,
    ) {
      return (
        await database.pool.query(
          `INSERT INTO booking_requests(client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status)
      VALUES ($1,$2,$3,'Seansa',50,'Test','test@example.test','+38267123456',now()+interval '10 days'+$4*interval '1 minute',now()+interval '10 days'+($4+50)*interval '1 minute','CANCELLED') RETURNING id`,
          [
            clientId,
            therapistIds[profileIndex],
            services[profileIndex],
            minute,
          ],
        )
      ).rows[0].id as string;
    }
    /** Čuva stvarne oznake radnji; vrijeme po potrebi pomjeramo radi granica perioda. */
    async function event(
      id: string,
      action: string,
      status: string,
      daysAgo = 0,
    ) {
      await database.pool.query(
        "INSERT INTO booking_events(booking_id,actor_role,action,next_status,created_at) VALUES ($1,'CLIENT',$2,$3,now()-$4*interval '1 day')",
        [id, action, status, daysAgo],
      );
    }
    await context.test(
      "requests, first confirmations, cancellations and accepted reschedules come from history",
      async () => {
        const first = await booking(0, client, 0);
        await event(first, "REQUEST_CREATED", "REQUESTED");
        await event(first, "CONFIRM", "CONFIRMED");
        await event(first, "ALTERNATIVE_PROPOSED", "ALTERNATIVE_PROPOSED");
        await event(first, "ACCEPT_ALTERNATIVE", "CONFIRMED");
        await event(first, "CLIENT_CANCELLED", "CANCELLED");
        const second = await booking(0, client, 60);
        await event(second, "REQUEST_CREATED", "REQUESTED");
        await event(second, "ALTERNATIVE_PROPOSED", "ALTERNATIVE_PROPOSED");
        await event(second, "REJECT_ALTERNATIVE", "DECLINED");
        const third = await booking(0, otherClient, 120);
        await event(third, "REQUEST_CREATED", "REQUESTED", 1);
        await event(third, "DECLINE", "DECLINED");
        // Automatski termin jeste potvrda, ali nije novi upit niti nova konverzija.
        const automatic = await booking(0, client, 180);
        await event(automatic, "RECURRING_CREATED", "CONFIRMED");
        const old = await booking(0, client, 240);
        await event(old, "REQUEST_CREATED", "REQUESTED", 40);
        await event(old, "CONFIRM", "CONFIRMED", 40);
        await event(old, "THERAPIST_CANCELLED", "CANCELLED", 1);
        const report = await analytics.overview(owner, "30");
        assert.deepEqual(report.totals, {
          views: 4,
          requests: 3,
          confirmed: 2,
          cancelled: 2,
          proposals: 2,
          rescheduled: 1,
          declined: 2,
        });
        assert.equal(report.currentBookings.waiting, 0);
        assert.equal(report.currentBookings.total, 5);
        assert.equal(report.currentBookings.history, 5);
        assert.equal(report.convertedVisitors, 1);
        assert.equal(report.conversion, 50);
        assert.equal(
          (await analytics.overview(owner, "90")).totals.confirmed,
          3,
        );
        assert.equal((await analytics.overview(owner, "90")).daily.length, 90);
        assert.ok(report.trackingStartedAt);
        assert.equal(JSON.stringify(report).includes(client), false);
        assert.equal(
          JSON.stringify(report).includes("test@example.test"),
          false,
        );
      },
    );
    await context.test(
      "other therapist history and views do not leak into the owner's report",
      async () => {
        const other = await booking(1, client, 0);
        await event(other, "REQUEST_CREATED", "REQUESTED");
        await recordView(client, therapistIds[1]);
        const report = await analytics.overview(otherOwner);
        assert.equal(report.totals.requests, 1);
        assert.equal(report.totals.views, 1);
        assert.equal(report.totals.confirmed, 0);
        assert.equal((await analytics.overview(owner)).totals.requests, 3);
        await database.pool.query(
          "UPDATE therapists SET is_active=false WHERE id=$1",
          [therapist],
        );
        await assert.rejects(recordView(client, therapist), /nije dostupan/);
        // Vlasnik i nakon deaktivacije zadržava svoju istorijsku analitiku.
        assert.equal((await analytics.overview(owner)).totals.requests, 3);
      },
    );
    await context.test(
      "local midnight and legacy confirmations use the correct day and count once",
      async () => {
        const id = await booking(1, client, 90);
        // Lokalno 00:30 može biti prethodni UTC datum; izvještaj mora ostati na lokalnom danu.
        await database.pool.query(
          `INSERT INTO booking_events(booking_id,actor_role,action,next_status,created_at)
        VALUES ($1,'CLIENT','REQUEST_CREATED','REQUESTED',((now() AT TIME ZONE 'Europe/Podgorica')::date+time '00:30') AT TIME ZONE 'Europe/Podgorica')`,
          [id],
        );
        await database.pool.query(
          "UPDATE booking_requests SET confirmed_at=now()-interval '8 days' WHERE id=$1",
          [id],
        );
        // Starija potvrda može biti samo u snapshotu; novo prihvatanje ne mijenja datum prve potvrde.
        await event(id, "ACCEPT_ALTERNATIVE", "CONFIRMED");
        const report = await analytics.overview(otherOwner, "7");
        assert.equal(report.daily.at(-1)!.requests, 2);
        assert.equal(report.totals.confirmed, 0);
        const longer = await analytics.overview(otherOwner, "30");
        assert.equal(longer.totals.confirmed, 1);
        for (let index = 1; index < longer.daily.length; index++) {
          const previous = new Date(
            `${longer.daily[index - 1].date}T12:00:00Z`,
          );
          const current = new Date(`${longer.daily[index].date}T12:00:00Z`);
          assert.equal(current.getTime() - previous.getTime(), 86400000);
        }
      },
    );
    await context.test(
      "anonymous repeats, own views and other accounts remain separate and visitors are paginated",
      async () => {
        const profile = therapistIds[1];
        const anonymousId = randomUUID();
        await recordView(undefined, profile, randomUUID(), anonymousId);
        await recordView(undefined, profile, randomUUID(), anonymousId);
        await recordView(undefined, profile, randomUUID(), randomUUID());
        await recordView(otherOwner, profile);
        await recordView(otherOwner, profile);
        await recordView(owner, profile);
        const report = await analytics.overview(otherOwner);
        assert.equal(report.totals.views, 7);
        assert.equal(report.uniqueVisitors, 5);
        assert.equal(report.clientVisitors, 1);
        assert.equal(report.visitorSummary.repeatViews, 2);
        assert.equal(
          report.audiences.find((group) => group.kind === "ANONYMOUS")!.views,
          3,
        );
        assert.equal(
          report.audiences.find((group) => group.kind === "SELF")!.views,
          2,
        );
        assert.equal(
          report.audiences.find((group) => group.kind === "OTHER")!.views,
          1,
        );
        assert.equal(JSON.stringify(report).includes(anonymousId), false);
        await assert.rejects(
          analytics.recordView(
            undefined,
            profile,
            { viewId: randomUUID() },
            "invalid",
          ),
        );
        await assert.rejects(
          analytics.recordView(
            "expired",
            profile,
            { viewId: randomUUID() },
            anonymousId,
          ),
        );
        await assert.rejects(analytics.overview(otherOwner, "30", "0"));
        await database.pool.query(
          "INSERT INTO profile_view_events(therapist_id,view_id,anonymous_id,kind) SELECT $1,gen_random_uuid(),gen_random_uuid(),'ANONYMOUS' FROM generate_series(1,55)",
          [profile],
        );
        const firstPage = await analytics.overview(otherOwner, "30", "1");
        const secondPage = await analytics.overview(otherOwner, "30", "2");
        assert.equal(firstPage.uniqueVisitors, 60);
        assert.equal(firstPage.visitorPages, 2);
        assert.equal(firstPage.visitors.length, 50);
        assert.equal(secondPage.visitors.length, 10);
        assert.equal(
          new Set(
            [...firstPage.visitors, ...secondPage.visitors].map(
              (visitor) => visitor.number,
            ),
          ).size,
          60,
        );
      },
    );
    await context.test(
      "current waiting is separate from received requests and ignores the analytics period",
      async () => {
        const before = await analytics.overview(otherOwner);
        const requested = await booking(1, client, 360);
        const proposed = await booking(1, client, 420);
        const confirmed = await booking(1, client, 480);
        const expired = await booking(1, client, 540);
        await event(requested, "REQUEST_CREATED", "REQUESTED");
        await database.pool.query(
          "UPDATE booking_requests SET status='REQUESTED' WHERE id=$1",
          [requested],
        );
        await database.pool.query(
          "UPDATE booking_requests SET status='ALTERNATIVE_PROPOSED' WHERE id=$1",
          [proposed],
        );
        await database.pool.query(
          "UPDATE booking_requests SET status='CONFIRMED' WHERE id=$1",
          [confirmed],
        );
        await database.pool.query(
          "UPDATE booking_requests SET status='REQUESTED',start_at=now()-interval '2 days',end_at=now()-interval '2 days'+interval '50 minutes' WHERE id=$1",
          [expired],
        );
        const week = await analytics.overview(otherOwner, "7");
        const quarter = await analytics.overview(otherOwner, "90");
        assert.deepEqual(week.currentBookings, quarter.currentBookings);
        assert.equal(week.currentBookings.waiting, 2);
        assert.equal(week.currentBookings.awaitingTherapist, 1);
        assert.equal(week.currentBookings.awaitingClient, 1);
        assert.equal(
          week.currentBookings.confirmed,
          before.currentBookings.confirmed + 1,
        );
        assert.equal(
          week.currentBookings.history,
          before.currentBookings.history + 1,
        );
        assert.equal(
          week.currentBookings.total,
          before.currentBookings.total + 4,
        );
        const received = week.totals.requests;
        await database.pool.query(
          "UPDATE booking_requests SET status='CANCELLED' WHERE id=$1",
          [requested],
        );
        const after = await analytics.overview(otherOwner, "7");
        assert.equal(after.currentBookings.waiting, 1);
        assert.equal(after.totals.requests, received);
        assert.equal(
          (
            await database.pool.query(
              "SELECT status FROM booking_requests WHERE id=$1",
              [expired],
            )
          ).rows[0].status,
          "REQUESTED",
        );
      },
    );
  },
);
