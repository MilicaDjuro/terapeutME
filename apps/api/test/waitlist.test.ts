import "../src/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { addDays, dateKey, weekday } from "@terapeut/domain";
import { DatabaseService } from "../src/database.service";
import { AuthService } from "../src/auth/auth.service";
import type { AccountUser } from "../src/auth/auth.types";
import type { EmailService } from "../src/auth/email.service";
import { DirectoryService } from "../src/directory/directory.service";
import { BookingRepository } from "../src/bookings/booking.repository";
import { BookingService } from "../src/bookings/booking.service";
import { RecurringBookingService } from "../src/bookings/recurring-booking.service";
import { WaitlistService } from "../src/bookings/waitlist.service";
import { BookingNotificationService } from "../src/notifications/booking-notification.service";

// Testovi koriste stvarne SQL lock-ove i posebnu šemu; JWT provjeravaju auth i browser testovi.
test(
  "waiting list assigns confirmed sessions in signup order without losing history",
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
      /** Predstavlja već provjerenu sesiju; tijelo zahtjeva ne određuje identitet. */
      async getAccount(token: string) {
        return accounts.get(token)!;
      },
      /** Ograničavanje pokušaja je pokriveno postojećim auth testovima. */
      async limitAttempts() {},
    } as unknown as AuthService;
    const repository = new BookingRepository(database);
    const directory = new DirectoryService(database);
    const notifications = new BookingNotificationService(
      database,
      {} as EmailService,
    );
    notifications.wake = () => {};
    const waitlist = new WaitlistService(
      database,
      auth,
      directory,
      repository,
      notifications,
    );
    const recurring = new RecurringBookingService(
      database,
      auth,
      directory,
      repository,
      notifications,
      waitlist,
    );
    const bookings = new BookingService(
      database,
      auth,
      directory,
      repository,
      notifications,
      recurring,
      waitlist,
    );
    context.after(async () => {
      await waitlist.onModuleDestroy();
      await recurring.onModuleDestroy();
      await database.pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
    for (const file of [
      "schema.sql",
      "migrations/002-auth.sql",
      "migrations/003-therapist-registration.sql",
      "migrations/004-directory-photos.sql",
      "migrations/005-booking-sessions.sql",
      "migrations/006-profile-contact.sql",
      "migrations/007-password-reset.sql",
      "migrations/008-date-availability.sql",
      "migrations/009-booking-notifications.sql",
      "migrations/010-recurring-bookings.sql",
      "migrations/011-waitlist.sql",
      "migrations/012-client-materials.sql",
      "migrations/013-profile-analytics.sql",
      "migrations/014-profile-view-events.sql",
    ]) {
      await database.pool.query(
        await readFile(resolve(__dirname, "../../../db", file), "utf8"),
      );
    }

    /** Svaki scenario dobija svog terapeuta, tri klijenta i radne sate, bez stvarnih naloga. */
    async function fixture() {
      const tokens: string[] = [];
      for (const role of ["THERAPIST", "CLIENT", "CLIENT", "CLIENT"] as const) {
        const token = randomUUID();
        const email = `${token}@example.test`;
        const user = (
          await database.pool.query(
            "INSERT INTO users(email,password_hash,full_name,first_name,last_name,date_of_birth,role,verified_at,phone) VALUES ($1,'unused','Lista Test','Lista','Test','1990-01-01',$2,now(),'+38267123456') RETURNING id",
            [email, role],
          )
        ).rows[0];
        accounts.set(token, {
          id: user.id,
          role,
          email,
          firstName: "Lista",
          lastName: "Test",
        } as AccountUser);
        tokens.push(token);
      }
      const therapist = (
        await database.pool.query(
          "INSERT INTO therapists(linked_user_id,full_name,city,title_mne,title_en) VALUES ($1,'Lista Terapeut','Podgorica','Psihoterapeut','Psychotherapist') RETURNING id",
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
        first: tokens[2],
        second: tokens[3],
        date: addDays(dateKey(), 2),
      };
    }

    /** Rezerviše 09:00 da lista ima stvarno zauzet termin koji čeka oslobađanje. */
    async function occupy(
      data: Awaited<ReturnType<typeof fixture>>,
      confirm = true,
    ) {
      const result = await bookings.create(data.patient, {
        therapistId: data.therapist,
        serviceId: data.service,
        date: data.date,
        start: "540",
        phone: "+38267123456",
      });
      if (confirm)
        await bookings.respond(data.owner, result.booking!.id, {
          action: "confirm",
        });
      return result.booking!.id;
    }

    /** Pravi tačan izbor; izmjene u testu predstavljaju stvarni korisnikov formular. */
    function input(
      data: Awaited<ReturnType<typeof fixture>>,
      overrides: Record<string, string> = {},
    ) {
      return {
        requestId: randomUUID(),
        therapistId: data.therapist,
        serviceId: data.service,
        duration: "50",
        price: "45",
        mode: "exact",
        firstDate: data.date,
        lastDate: data.date,
        weekdays: String(weekday(data.date)),
        start: "540",
        end: "590",
        phone: "+38267123456",
        consent: "true",
        ...overrides,
      };
    }

    await context.test(
      "FIFO, duplicate submissions, ownership, one assignment and two email recipients",
      async () => {
        const data = await fixture();
        const original = await occupy(data);
        const firstInput = input(data);
        const first = (await waitlist.join(data.first, firstInput))
          .waitlistEntry!;
        const second = (await waitlist.join(data.second, input(data)))
          .waitlistEntry!;
        assert.equal(
          (await waitlist.join(data.first, input(data))).waitlistEntry!.id,
          first.id,
        );
        await assert.rejects(waitlist.cancel(data.second, first.id));
        await assert.rejects(waitlist.join(data.owner, input(data)));
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.first)!)).length,
          1,
        );
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.owner)!)).length,
          2,
        );
        await bookings.respond(data.patient, original, { action: "cancel" });
        await Promise.all([
          waitlist.refreshTherapist(data.therapist),
          waitlist.refreshTherapist(data.therapist),
        ]);
        const rows = await waitlist.listForUser(accounts.get(data.first)!);
        assert.equal(rows[0].status, "ASSIGNED");
        assert.equal(
          (await waitlist.join(data.first, firstInput)).waitlistEntry!.id,
          first.id,
        );
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.second)!))[0].status,
          "WAITING",
        );
        const assigned = (
          await repository.list(database.pool, data.therapist)
        ).find((booking) => booking.id === rows[0].bookingId)!;
        assert.equal(assigned.status, "CONFIRMED");
        assert.equal(assigned.clientUserId, accounts.get(data.first)!.id);
        assert.equal(assigned.events[0].action, "WAITLIST_ASSIGNED");
        assert.equal(
          (
            await database.pool.query(
              "SELECT 1 FROM notification_outbox WHERE booking_id=$1 AND template_key='waitlist-assigned'",
              [assigned.id],
            )
          ).rowCount,
          2,
        );
        await assert.rejects(waitlist.cancel(data.first, first.id));
        assert.equal(
          (await repository.list(database.pool, data.therapist)).find(
            (booking) => booking.id === assigned.id,
          )!.status,
          "CONFIRMED",
        );
        await bookings.respond(data.first, assigned.id, { action: "cancel" });
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.second)!))[0].id,
          second.id,
        );
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.second)!))[0].status,
          "ASSIGNED",
        );
        assert.equal(
          (await repository.list(database.pool, data.therapist)).filter(
            (booking) => booking.status === "CONFIRMED",
          ).length,
          1,
        );
      },
    );

    await context.test(
      "flexible preferences match the full session, weekdays and closed date priority",
      async () => {
        const data = await fixture();
        const original = await occupy(data);
        // Starija prijava za drugi datum ne smije spriječiti dodjelu odgovarajućem klijentu.
        const later = addDays(data.date, 1);
        await database.pool.query(
          "INSERT INTO availability_dates(therapist_id,work_date,is_working) VALUES ($1,$2,false)",
          [data.therapist, later],
        );
        await waitlist.join(
          data.first,
          input(data, {
            firstDate: later,
            lastDate: later,
            weekdays: String(weekday(later)),
          }),
        );
        const flexible = (
          await waitlist.join(
            data.second,
            input(data, {
              mode: "flexible",
              lastDate: later,
              weekdays: [weekday(data.date), weekday(later)].sort().join(","),
            }),
          )
        ).waitlistEntry!;
        assert.equal(flexible.status, "WAITING");
        await bookings.respond(data.patient, original, { action: "cancel" });
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.first)!))[0].status,
          "WAITING",
        );
        const row = (await waitlist.listForUser(accounts.get(data.second)!))[0];
        assert.equal(row.status, "ASSIGNED");
        assert.equal(
          (await repository.list(database.pool, data.therapist)).find(
            (booking) => booking.id === row.bookingId,
          )!.date,
          data.date,
        );
        await assert.rejects(
          waitlist.join(
            data.first,
            input(data, { mode: "flexible", end: "570" }),
          ),
        );
        await assert.rejects(
          waitlist.join(
            data.first,
            input(data, { weekdays: String((weekday(data.date) + 1) % 7) }),
          ),
        );
      },
    );

    await context.test(
      "withdrawing and invalid consent never assign an unwanted session",
      async () => {
        const data = await fixture();
        const original = await occupy(data);
        for (const change of [
          { consent: "false" },
          { weekdays: "7" },
          { phone: "abc" },
          { duration: "60" },
          { price: "99" },
          { start: "590", end: "540" },
        ]) {
          await assert.rejects(waitlist.join(data.first, input(data, change)));
        }
        const first = (await waitlist.join(data.first, input(data)))
          .waitlistEntry!;
        await waitlist.cancel(data.first, first.id);
        await waitlist.join(data.second, input(data));
        await bookings.respond(data.patient, original, { action: "cancel" });
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.first)!))[0].status,
          "CANCELLED",
        );
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.second)!))[0].status,
          "ASSIGNED",
        );
      },
    );

    await context.test(
      "ordinary booking cannot bypass an existing queue during simultaneous cancellation",
      async () => {
        const data = await fixture();
        const original = await occupy(data);
        await waitlist.join(data.first, input(data));
        const results = await Promise.allSettled([
          bookings.respond(data.patient, original, { action: "cancel" }),
          bookings.create(data.second, {
            therapistId: data.therapist,
            serviceId: data.service,
            date: data.date,
            start: "540",
            phone: "+38267123456",
          }),
        ]);
        assert.equal(results[0].status, "fulfilled");
        assert.equal(results[1].status, "rejected");
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.first)!))[0].status,
          "ASSIGNED",
        );
      },
    );

    await context.test(
      "outbox failure rolls back cancellation, assignment and history, then retry succeeds",
      async () => {
        const data = await fixture();
        const original = await occupy(data);
        await waitlist.join(data.first, input(data));
        const queue = notifications.queue.bind(notifications);
        notifications.queue = async (
          ...args: Parameters<typeof notifications.queue>
        ) => {
          if (args[2] === "waitlist-assigned")
            throw new Error("Test outbox failure");
          return queue(...args);
        };
        try {
          await assert.rejects(
            bookings.respond(data.patient, original, { action: "cancel" }),
          );
        } finally {
          notifications.queue = queue;
        }
        assert.equal(
          (await repository.list(database.pool, data.therapist)).length,
          1,
        );
        assert.equal(
          (await repository.list(database.pool, data.therapist))[0].status,
          "CONFIRMED",
        );
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.first)!))[0].status,
          "WAITING",
        );
        await bookings.respond(data.patient, original, { action: "cancel" });
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.first)!))[0].status,
          "ASSIGNED",
        );
      },
    );

    await context.test(
      "changed price requires a fresh consent and inactive accounts are skipped",
      async () => {
        const data = await fixture();
        const original = await occupy(data);
        await waitlist.join(data.first, input(data));
        await bookings.saveSchedule(data.owner, {
          action: "service",
          serviceId: data.service,
          name: "Nova seansa",
          duration: "50",
          price: "55",
        });
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.first)!))[0].status,
          "UNAVAILABLE",
        );
        await waitlist.join(data.second, input(data, { price: "55" }));
        await database.pool.query(
          "UPDATE users SET suspended_at=now() WHERE id=$1",
          [accounts.get(data.second)!.id],
        );
        await bookings.respond(data.patient, original, { action: "cancel" });
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.second)!))[0].status,
          "UNAVAILABLE",
        );
        assert.equal(
          (await repository.list(database.pool, data.therapist)).filter(
            (booking) => booking.status === "CONFIRMED",
          ).length,
          0,
        );
      },
    );

    await context.test(
      "restart catches up a free time and expired entries never book a past day",
      async () => {
        const data = await fixture();
        const original = await occupy(data);
        await waitlist.join(data.first, input(data));
        await database.pool.query(
          "UPDATE booking_requests SET status='CANCELLED' WHERE id=$1",
          [original],
        );
        const restarted = new WaitlistService(
          database,
          auth,
          directory,
          repository,
          notifications,
        );
        await restarted.refreshAll();
        await restarted.onModuleDestroy();
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.first)!))[0].status,
          "ASSIGNED",
        );
        await waitlist.join(data.second, input(data));
        await database.pool.query(
          "UPDATE booking_waitlist SET first_date=$2,last_date=$2 WHERE client_user_id=$1 AND status='WAITING'",
          [accounts.get(data.second)!.id, addDays(dateKey(), -1)],
        );
        await waitlist.refreshTherapist(data.therapist);
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.second)!))[0].status,
          "EXPIRED",
        );
      },
    );

    await context.test(
      "moving A to B and stopping a recurring series release times directly to the queue",
      async () => {
        const data = await fixture();
        const original = await occupy(data, false);
        await waitlist.join(data.first, input(data));
        await bookings.respond(data.owner, original, {
          action: "propose",
          date: data.date,
          start: "600",
        });
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.first)!))[0].status,
          "ASSIGNED",
        );
        await bookings.respond(data.patient, original, {
          action: "accept-alternative",
        });
        await recurring.create(data.owner, {
          bookingId: original,
          intervalDays: "7",
        });
        const series = (
          await recurring.listForUser(accounts.get(data.owner)!)
        )[0];
        const nextDate = addDays(data.date, 7);
        await waitlist.join(
          data.second,
          input(data, {
            firstDate: nextDate,
            lastDate: nextDate,
            start: "600",
            end: "650",
            weekdays: String(weekday(nextDate)),
          }),
        );
        await recurring.stop(data.owner, series.id);
        assert.equal(
          (await waitlist.listForUser(accounts.get(data.second)!))[0].status,
          "ASSIGNED",
        );
      },
    );
  },
);
