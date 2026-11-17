import "../src/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { addDays, dateKey } from "@terapeut/domain";
import { DatabaseService } from "../src/database.service";
import { AuthService } from "../src/auth/auth.service";
import type { AccountUser } from "../src/auth/auth.types";
import type { EmailService } from "../src/auth/email.service";
import { DirectoryService } from "../src/directory/directory.service";
import { BookingRepository } from "../src/bookings/booking.repository";
import { BookingService } from "../src/bookings/booking.service";
import { RecurringBookingService } from "../src/bookings/recurring-booking.service";
import { BookingNotificationService } from "../src/notifications/booking-notification.service";

// JWT je pokriven auth testovima; ovdje provjeravamo dozvole, SQL transakcije i ponavljanje nakon restarta.
test(
  "recurring sessions persist rules, protect occupancy and allow one-session changes",
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
      /** Predstavlja već provjerenu sesiju testa; body ne može promijeniti identitet. */
      async getAccount(token: string) {
        const account = accounts.get(token);
        if (!account) throw new Error("Unknown test account");
        return account;
      },
      /** Ograničavanje pokušaja odvojeno provjeravaju auth testovi. */
      async limitAttempts() {},
    } as unknown as AuthService;
    const repository = new BookingRepository(database);
    const directory = new DirectoryService(database);
    const notifications = new BookingNotificationService(
      database,
      {} as EmailService,
    );
    notifications.wake = () => {};
    const recurring = new RecurringBookingService(
      database,
      auth,
      directory,
      repository,
      notifications,
    );
    const bookings = new BookingService(
      database,
      auth,
      directory,
      repository,
      notifications,
      recurring,
    );
    context.after(async () => {
      await recurring.onModuleDestroy();
      await database.pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
    for (const file of [
      "db/schema.sql",
      "db/migrations/002-auth.sql",
      "db/migrations/003-therapist-registration.sql",
      "db/migrations/004-directory-photos.sql",
      "db/migrations/005-booking-sessions.sql",
      "db/migrations/006-profile-contact.sql",
      "db/migrations/007-password-reset.sql",
      "db/migrations/008-date-availability.sql",
      "db/migrations/009-booking-notifications.sql",
      "db/migrations/010-recurring-bookings.sql",
      "db/migrations/011-waitlist.sql",
      "db/migrations/012-client-materials.sql",
      "db/migrations/013-profile-analytics.sql",
      "db/migrations/014-profile-view-events.sql",
    ])
      await database.pool.query(
        await readFile(resolve(__dirname, "../../..", file), "utf8"),
      );

    /** Kreira nezavisnog terapeuta i dva pacijenta samo u testnoj šemi. */
    async function fixture() {
      const tokens: string[] = [];
      for (const role of ["THERAPIST", "CLIENT", "CLIENT"] as const) {
        const token = randomUUID();
        const user = (
          await database.pool.query(
            "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,'unused','Serija Test','Serija','Test','1990-01-01',$2,now(),'+38267123456') RETURNING id",
            [`${token}@example.test`, role],
          )
        ).rows[0];
        accounts.set(token, {
          id: user.id,
          role,
          email: `${token}@example.test`,
          firstName: "Serija",
          lastName: "Test",
        } as AccountUser);
        tokens.push(token);
      }
      const therapist = (
        await database.pool.query(
          "INSERT INTO therapists(linked_user_id,full_name,city,title_mne,title_en) VALUES ($1,'Serija Terapeut','Podgorica','Psihoterapeut','Psychotherapist') RETURNING id",
          [accounts.get(tokens[0])!.id],
        )
      ).rows[0].id;
      const service = (
        await database.pool.query(
          "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,'Seansa 50','Session 50',50,45) RETURNING id",
          [therapist],
        )
      ).rows[0].id;
      for (let day = 0; day < 7; day++)
        await database.pool.query(
          "INSERT INTO availability_windows(therapist_id,weekday,start_minute,end_minute) VALUES ($1,$2,540,1020)",
          [therapist, day],
        );
      return {
        therapist,
        service,
        owner: tokens[0],
        patient: tokens[1],
        other: tokens[2],
      };
    }

    /** Rezerviše i potvrđuje jednu buduću polaznu seansu kroz postojeći servis. */
    async function anchor(
      data: Awaited<ReturnType<typeof fixture>>,
      date = addDays(dateKey(), 2),
    ) {
      const result = await bookings.create(data.patient, {
        therapistId: data.therapist,
        serviceId: data.service,
        date,
        start: "540",
        phone: "+38267123456",
      });
      return (
        await bookings.respond(data.owner, result.booking.id, {
          action: "confirm",
        })
      ).booking;
    }

    await context.test(
      "weekly and fortnightly series are atomic, private and idempotent under concurrent creation",
      async () => {
        for (const interval of [7, 14]) {
          const data = await fixture();
          const initial = await anchor(data);
          await assert.rejects(
            recurring.create(data.patient, {
              bookingId: initial.id,
              intervalDays: String(interval),
            }),
          );
          const outsider = await fixture();
          await assert.rejects(
            recurring.create(outsider.owner, {
              bookingId: initial.id,
              intervalDays: String(interval),
            }),
          );
          await assert.rejects(
            recurring.create(data.owner, {
              bookingId: initial.id,
              intervalDays: "15",
            }),
          );
          const input = {
            bookingId: initial.id,
            intervalDays: String(interval),
          };
          await Promise.all([
            recurring.create(data.owner, input),
            recurring.create(data.owner, input),
          ]);
          const sessions = (await bookings.list(data.patient)).bookings;
          assert.equal(sessions.length, Math.floor(88 / interval) + 1);
          for (let index = 0; index < sessions.length; index++) {
            assert.equal(
              sessions[index].date,
              addDays(initial.date, index * interval),
            );
            assert.equal(sessions[index].status, "CONFIRMED");
          }
          assert.equal((await bookings.list(data.other)).series.length, 0);
          assert.equal((await bookings.list(data.other)).bookings.length, 0);
          const slots = await bookings.slots(
            data.therapist,
            "50",
            addDays(initial.date, interval),
          );
          assert.equal(
            slots.slots.find((slot) => slot.start === 540)?.available,
            false,
          );
        }
      },
    );

    await context.test(
      "an occupied date rolls back the initial rule, all added bookings, history and email rows",
      async () => {
        const data = await fixture();
        const initial = await anchor(data);
        await bookings.create(data.other, {
          therapistId: data.therapist,
          serviceId: data.service,
          date: addDays(initial.date, 14),
          start: "540",
          phone: "+38267123456",
        });
        const before = (
          await database.pool.query("SELECT count(*) FROM notification_outbox")
        ).rows[0].count;
        await assert.rejects(
          recurring.create(data.owner, {
            bookingId: initial.id,
            intervalDays: "7",
          }),
          /Serija nije sačuvana/,
        );
        assert.equal(
          (await repository.list(database.pool, data.therapist)).length,
          2,
        );
        assert.equal(
          (await recurring.listForUser(accounts.get(data.owner)!)).length,
          0,
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*) FROM notification_outbox",
            )
          ).rows[0].count,
          before,
        );
      },
    );

    await context.test(
      "moving and cancelling one occurrence never changes or recreates the remaining series",
      async () => {
        const data = await fixture();
        const initial = await anchor(data);
        await recurring.create(data.owner, {
          bookingId: initial.id,
          intervalDays: "14",
        });
        const before = (await bookings.list(data.patient)).bookings;
        const chosen = before[1];
        const next = before[2];
        const movedDate = addDays(chosen.date, 1);
        await bookings.respond(data.owner, chosen.id, {
          action: "propose",
          date: movedDate,
          start: "600",
        });
        await bookings.respond(data.patient, chosen.id, {
          action: "accept-alternative",
        });
        await bookings.respond(data.patient, next.id, { action: "cancel" });
        await Promise.all([
          recurring.refreshTherapist(data.therapist),
          recurring.refreshTherapist(data.therapist),
        ]);
        const after = (await bookings.list(data.patient)).bookings;
        assert.equal(after.length, before.length);
        const moved = after.find((booking) => booking.id === chosen.id)!;
        assert.equal(moved.date, movedDate);
        assert.equal(moved.series!.originalDate, chosen.date);
        assert.equal(
          after.find((booking) => booking.id === next.id)!.status,
          "CANCELLED",
        );
        for (const original of before.filter(
          (booking) => ![chosen.id, next.id].includes(booking.id),
        )) {
          assert.equal(
            after.find((booking) => booking.id === original.id)!.date,
            original.date,
          );
          assert.equal(
            after.find((booking) => booking.id === original.id)!.status,
            original.status,
          );
        }
      },
    );

    /** Oponaša bazu poslije dužeg rada/restarta: završena polazna seansa i još neobrađen naredni datum. */
    async function pastSeries(data: Awaited<ReturnType<typeof fixture>>) {
      const firstDate = addDays(dateKey(), -13);
      const nextDate = addDays(dateKey(), 1);
      const bookingId = randomUUID();
      const seriesId = randomUUID();
      await database.pool.query(
        `INSERT INTO booking_requests(id,client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,price_eur_snapshot,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status)
      VALUES ($1,$2,$3,$4,'Seansa 50',50,45,'Serija Test',$5,'+38267123456',($6::date+interval '9 hours') AT TIME ZONE 'Europe/Podgorica',($6::date+interval '9 hours 50 minutes') AT TIME ZONE 'Europe/Podgorica','COMPLETED')`,
        [
          bookingId,
          accounts.get(data.patient)!.id,
          data.therapist,
          data.service,
          accounts.get(data.patient)!.email,
          firstDate,
        ],
      );
      await database.pool.query(
        "INSERT INTO booking_series(id,therapist_id,client_user_id,anchor_booking_id,interval_days,first_date,start_minute,next_date) VALUES ($1,$2,$3,$4,14,$5,540,$6)",
        [
          seriesId,
          data.therapist,
          accounts.get(data.patient)!.id,
          bookingId,
          firstDate,
          nextDate,
        ],
      );
      await database.pool.query(
        "UPDATE booking_requests SET series_id=$2,occurrence_date=$3 WHERE id=$1",
        [bookingId, seriesId, firstDate],
      );
      return { seriesId, bookingId, nextDate };
    }

    await context.test(
      "a restarted worker records closed dates, continues the series and resolves only the selected exception",
      async () => {
        const data = await fixture();
        const rule = await pastSeries(data);
        await database.pool.query(
          "INSERT INTO availability_dates(therapist_id,work_date,is_working,start_minute,end_minute) VALUES ($1,$2,false,NULL,NULL)",
          [data.therapist, rule.nextDate],
        );
        await recurring.refreshDue();
        const restarted = new RecurringBookingService(
          database,
          auth,
          directory,
          repository,
          notifications,
        );
        await restarted.refreshDue();
        const overview = (
          await restarted.listForUser(accounts.get(data.owner)!)
        )[0];
        assert.equal(overview.issues.length, 1);
        assert.equal(overview.issues[0].date, rule.nextDate);
        const before = await repository.list(database.pool, data.therapist);
        assert.equal(
          before.filter((booking) => booking.date === rule.nextDate).length,
          0,
        );
        await assert.rejects(
          recurring.resolveIssue(data.other, rule.seriesId, {
            occurrenceDate: rule.nextDate,
            date: addDays(rule.nextDate, 1),
            start: "600",
          }),
        );
        await recurring.resolveIssue(data.owner, rule.seriesId, {
          occurrenceDate: rule.nextDate,
          date: addDays(rule.nextDate, 1),
          start: "600",
        });
        const after = await repository.list(database.pool, data.therapist);
        assert.equal(after.length, before.length + 1);
        assert.equal(
          (await recurring.listForUser(accounts.get(data.patient)!))[0].issues
            .length,
          0,
        );
        await assert.rejects(
          recurring.resolveIssue(data.owner, rule.seriesId, {
            occurrenceDate: rule.nextDate,
            date: addDays(rule.nextDate, 2),
            start: "600",
          }),
        );
      },
    );

    await context.test(
      "stopping is owner-only and idempotent, cancels future slots and preserves past outcomes",
      async () => {
        const data = await fixture();
        const rule = await pastSeries(data);
        await recurring.refreshTherapist(data.therapist);
        const outsider = await fixture();
        await assert.rejects(recurring.stop(data.patient, rule.seriesId));
        await assert.rejects(recurring.stop(outsider.owner, rule.seriesId));
        await recurring.stop(data.owner, rule.seriesId);
        const count = (
          await database.pool.query("SELECT count(*) FROM notification_outbox")
        ).rows[0].count;
        await recurring.stop(data.owner, rule.seriesId);
        await recurring.refreshDue();
        const sessions = await repository.list(database.pool, data.therapist);
        assert.equal(
          sessions.find((booking) => booking.id === rule.bookingId)!.status,
          "COMPLETED",
        );
        assert.ok(
          sessions
            .filter((booking) => booking.id !== rule.bookingId)
            .every((booking) => booking.status === "CANCELLED"),
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*) FROM notification_outbox",
            )
          ).rows[0].count,
          count,
        );
        assert.equal(
          (await recurring.listForUser(accounts.get(data.patient)!))[0].active,
          false,
        );
      },
    );

    await context.test(
      "proposing another client's time cannot take a due recurring occurrence",
      async () => {
        const data = await fixture();
        const requested = await bookings.create(data.other, {
          therapistId: data.therapist,
          serviceId: data.service,
          date: addDays(dateKey(), 3),
          start: "540",
          phone: "+38267123456",
        });
        const rule = await pastSeries(data);
        await assert.rejects(
          bookings.respond(data.owner, requested.booking.id, {
            action: "propose",
            date: rule.nextDate,
            start: "540",
          }),
        );
        const calendar = await bookings.slots(
          data.therapist,
          "50",
          rule.nextDate,
        );
        assert.equal(
          calendar.slots.find((slot) => slot.start === 540)?.available,
          false,
        );
        const unchanged = (
          await repository.list(database.pool, data.therapist)
        ).find((booking) => booking.id === requested.booking.id)!;
        assert.equal(unchanged.date, requested.booking.date);
        assert.equal(unchanged.status, "REQUESTED");
      },
    );

    await context.test(
      "an unexpected email-outbox failure rolls back the complete initial series",
      async () => {
        const data = await fixture();
        const initial = await anchor(data);
        await database.pool
          .query(`CREATE FUNCTION fail_series_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test outbox failure'; END $$;
          CREATE TRIGGER reject_series_email BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION fail_series_email()`);
        try {
          await assert.rejects(
            recurring.create(data.owner, {
              bookingId: initial.id,
              intervalDays: "7",
            }),
            /test outbox failure/,
          );
          assert.equal(
            (await repository.list(database.pool, data.therapist)).length,
            1,
          );
          assert.equal(
            (await recurring.listForUser(accounts.get(data.owner)!)).length,
            0,
          );
          assert.equal(
            (
              await repository.list(database.pool, data.therapist)
            )[0].events.some((event) => event.action === "SERIES_STARTED"),
            false,
          );
        } finally {
          await database.pool.query(
            "DROP TRIGGER reject_series_email ON notification_outbox; DROP FUNCTION fail_series_email()",
          );
        }
      },
    );

    await context.test(
      "a series and an independent client racing for the same future time cannot overlap",
      async () => {
        const data = await fixture();
        const initial = await anchor(data);
        const results = await Promise.allSettled([
          recurring.create(data.owner, {
            bookingId: initial.id,
            intervalDays: "7",
          }),
          bookings.create(data.other, {
            therapistId: data.therapist,
            serviceId: data.service,
            date: addDays(initial.date, 7),
            start: "540",
            phone: "+38267123456",
          }),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const overlaps = (
          await database.pool.query(
            "SELECT count(*) FROM booking_requests a JOIN booking_requests b ON a.id<b.id AND a.therapist_id=b.therapist_id AND tstzrange(a.start_at,a.end_at,'[)') && tstzrange(b.start_at,b.end_at,'[)') WHERE a.therapist_id=$1 AND a.status IN ('CONFIRMED','REQUESTED') AND b.status IN ('CONFIRMED','REQUESTED')",
            [data.therapist],
          )
        ).rows[0].count;
        assert.equal(overlaps, "0");
      },
    );
  },
);
