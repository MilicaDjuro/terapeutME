import "../src/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { addDays, dateKey, weekday } from "@terapeut/domain";
import { DatabaseService } from "../src/database.service";
import { AuthService } from "../src/auth/auth.service";
import { EmailService } from "../src/auth/email.service";
import { DirectoryService } from "../src/directory/directory.service";
import { BookingRepository } from "../src/bookings/booking.repository";
import { BookingService } from "../src/bookings/booking.service";
import { BookingNotificationService } from "../src/notifications/booking-notification.service";
import {
  requireInteger,
  requireBookingDate,
  requireTimeRange,
} from "../src/bookings/booking.validation";

// Klijent ne može zaobići provjere mijenjanjem tipa, datuma ili kraja intervala.
test("schedule input validates integers, actual dates and time ranges", () => {
  for (const value of [true, "", "1.5", NaN, Infinity, {}, -1])
    assert.throws(() => requireInteger(value, "Minuti", 0, 1440));
  assert.equal(requireInteger("975", "Minuti", 0, 1440), 975);
  assert.throws(() => requireTimeRange({ start: 600, end: 600 }));
  assert.throws(() => requireBookingDate("2026-02-30"));
  assert.throws(() => requireBookingDate(addDays(dateKey(), 91)));
});

// Sve promjene i konkurentni zahtjevi koriste samo zasebnu testnu šemu, nikad korisnikove naloge.
test(
  "database scheduling prevents races, checks ownership and preserves booking history",
  { skip: !process.env.AUTH_TEST_DATABASE_URL },
  async (context) => {
    const connectionString = process.env.AUTH_TEST_DATABASE_URL!;
    const admin = new Pool({ connectionString });
    const schemaName = `auth_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    const url = new URL(connectionString);
    url.searchParams.set("options", `-c search_path=${schemaName},public`);
    process.env.DATABASE_URL = url.toString();
    const database = new DatabaseService();
    const codes = new Map<string, string>();
    const email = {
      mode: "local",
      /** Testni email servis je uključen, ali ne šalje spoljne poruke. */
      assertDeliveryEnabled() {},
      /** Hvata kod u testu; ne šalje poruku stvarnom primaocu. */
      async sendRegistrationCode(recipient: string, code: string) {
        codes.set(recipient, code);
      },
    } as unknown as EmailService;
    const auth = new AuthService(database, email);
    const directory = new DirectoryService(database);
    const repository = new BookingRepository(database);
    const notifications = new BookingNotificationService(database, email);
    // Ovaj test provjerava zakazivanje; zaseban test ručno obrađuje trajni email red.
    notifications.wake = () => {};
    const service = new BookingService(
      database,
      auth,
      directory,
      repository,
      notifications,
    );
    context.after(async () => {
      service.onModuleDestroy();
      await database.pool.end();
      await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
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

      "db/migrations/015-therapist-notes.sql",
      "db/migrations/016-session-ratings.sql",
    ])
      await database.pool.query(
        await readFile(resolve(__dirname, "../../..", file), "utf8"),
      );
    /** Kreira samo nalog testa i potvrđuje ga kodom uhvaćenim u testnom SMTP servisu. */
    async function createAccount(name: string, therapist = false) {
      const input = {
        firstName: name,
        lastName: "Test",
        email: `${name.toLowerCase()}@example.test`,
        dateOfBirth: "1990-01-01",
        password: "Pravilna test lozinka!",
      };
      const started = await auth.startRegistration(
        input,
        therapist
          ? {
              title: "Psihoterapeut",
              biography: "Test biografija.",
              city: "Podgorica",
              address: null,
              phone: "+38267123456",
              serviceName: "Seansa 60 min",
              durationMinutes: 60,
              priceEur: 50,
            }
          : undefined,
      );
      return auth.verifyRegistration(
        started.challengeId,
        codes.get(input.email)!,
      );
    }
    const therapist = await createAccount("Terapeut", true);
    const otherTherapist = await createAccount("DrugiTerapeut", true);
    const firstClient = await createAccount("PrviPacijent");
    const secondClient = await createAccount("DrugiPacijent");
    const date = addDays(dateKey(), 1);
    await service.saveSchedule(therapist.token, {
      action: "service",
      name: "Seansa 30 min",
      duration: 30,
      price: null,
    });
    const schedule = (await service.schedule(therapist.token)).therapist;
    const service60 = schedule.services.find(
      (service) => service.duration === 60,
    )!;
    const service30 = schedule.services.find(
      (service) => service.duration === 30,
    )!;
    const saved = await service.saveSchedule(therapist.token, {
      action: "window",
      weekday: weekday(date),
      start: 540,
      end: 780,
    });
    const windowId = saved.therapist.availability[0].id;

    await context.test(
      "working hours and prices require the therapist owner",
      async () => {
        // Ponovljeni zahtjevi i paralelni klikovi vraćaju isti interval, bez novog reda u bazi.
        const repeated = await Promise.all([
          service.saveSchedule(therapist.token, {
            action: "window",
            weekday: weekday(date),
            start: 540,
            end: 780,
          }),
          service.saveSchedule(therapist.token, {
            action: "window",
            weekday: weekday(date),
            start: 540,
            end: 780,
          }),
        ]);
        for (const response of repeated) {
          assert.equal(response.notice, "window-already-exists");
          assert.equal(response.therapist.availability.length, 1);
          assert.equal(response.therapist.availability[0].id, windowId);
        }
        await assert.rejects(
          service.saveSchedule(firstClient.token, {
            action: "window",
            weekday: weekday(date),
            start: 0,
            end: 60,
          }),
        );
        await assert.rejects(
          service.saveSchedule(otherTherapist.token, {
            action: "remove-window",
            id: windowId,
          }),
        );
        await assert.rejects(
          service.saveSchedule(therapist.token, {
            action: "window",
            weekday: weekday(date),
            start: 600,
            end: 900,
          }),
          /Radno vrijeme se preklapa sa već sačuvanim periodom/,
        );
        await assert.rejects(
          service.saveSchedule(therapist.token, {
            action: "service",
            name: "Neispravna seansa",
            duration: 241,
            price: 10,
          }),
        );
        assert.equal(
          (await service.schedule(therapist.token)).therapist.availability
            .length,
          1,
        );
        await service.saveSchedule(therapist.token, {
          action: "service",
          serviceId: service30.id,
          name: service30.name,
          duration: 30,
          price: "0",
        });
        assert.equal(
          (await service.schedule(therapist.token)).therapist.services.find(
            (service) => service.duration === 30,
          )!.price,
          0,
        );
      },
    );
    const input = {
      therapistId: schedule.id,
      serviceId: service60.id,
      date,
      start: 540,
      phone: "+38267123456",
      clientEmail: "forged@example.test",
      price: "0",
    };
    await context.test(
      "two clients racing for different durations can only create one overlapping request",
      async () => {
        const results = await Promise.allSettled([
          service.create(firstClient.token, input),
          service.create(secondClient.token, {
            ...input,
            serviceId: service30.id,
          }),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const rows = await database.pool.query(
          "SELECT * FROM booking_requests",
        );
        assert.equal(rows.rowCount, 1);
        const owner =
          rows.rows[0].client_user_id === firstClient.user.id
            ? firstClient
            : secondClient;
        const stranger = owner === firstClient ? secondClient : firstClient;
        const booking = (await service.list(owner.token)).bookings[0];
        assert.equal(booking.clientEmail, owner.user.email);
        assert.equal(booking.events.length, 1);
        assert.equal(booking.duration, rows.rows[0].duration_minutes);
        assert.equal(booking.price, booking.duration === 60 ? 50 : 0);
        assert.equal((await service.list(stranger.token)).bookings.length, 0);
        for (const duration of [30, 60]) {
          const calendar = await service.slots(schedule.id, duration, date);
          assert.equal(
            calendar.slots.find((slot) => slot.start === 540)!.available,
            false,
          );
          assert.equal("clientEmail" in calendar, false);
          assert.equal(
            calendar.slots.find((slot) => slot.start === booking.end)!
              .available,
            true,
          );
        }
        await assert.rejects(
          service.respond(stranger.token, booking.id, { action: "cancel" }),
        );
        await assert.rejects(
          service.respond(otherTherapist.token, booking.id, {
            action: "confirm",
          }),
        );
        await assert.rejects(service.create(therapist.token, input));
        const adjacent = await service.create(stranger.token, {
          ...input,
          serviceId: service30.id,
          start: booking.end,
        });
        assert.equal(adjacent.booking.start, booking.end);
        await service.respond(owner.token, booking.id, {
          action: "cancel",
          reason: "Promjena plana",
        });
        assert.equal(
          (await service.slots(schedule.id, 30, date)).slots.find(
            (slot) => slot.start === 540,
          )!.available,
          true,
        );
        const history = (await service.list(owner.token)).bookings[0];
        assert.equal(history.events.length, 2);
        assert.equal(history.events[1].reason, "Promjena plana");
      },
    );
    await context.test(
      "invalid times and contacts never create partial requests",
      async () => {
        const count = (
          await database.pool.query("SELECT count(*) FROM booking_requests")
        ).rows[0].count;
        await assert.rejects(
          service.create(firstClient.token, {
            ...input,
            start: 720,
            phone: "x",
          }),
        );
        await assert.rejects(
          service.create(firstClient.token, { ...input, start: 755 }),
        );
        await assert.rejects(
          service.create(firstClient.token, { ...input, start: 735 }),
        );
        assert.equal(
          (await database.pool.query("SELECT count(*) FROM booking_requests"))
            .rows[0].count,
          count,
        );
      },
    );
    await context.test(
      "A to B changes are atomic and cancellation releases both session types",
      async () => {
        const created = await service.create(firstClient.token, {
          ...input,
          start: 660,
        });
        await assert.rejects(
          service.respond(therapist.token, created.booking.id, {
            action: "propose",
            date,
            start: 765,
          }),
        );
        assert.equal(
          (await service.list(firstClient.token)).bookings.find(
            (booking) => booking.id === created.booking.id,
          )!.start,
          660,
        );
        await service.respond(therapist.token, created.booking.id, {
          action: "propose",
          date,
          start: 720,
        });
        assert.equal(
          (await service.slots(schedule.id, 60, date)).slots.find(
            (slot) => slot.start === 660,
          )!.available,
          true,
        );
        assert.equal(
          (await service.slots(schedule.id, 30, date)).slots.find(
            (slot) => slot.start === 720,
          )!.available,
          false,
        );
        await service.respond(firstClient.token, created.booking.id, {
          action: "accept-alternative",
        });
        const priceBefore = (
          await service.list(firstClient.token)
        ).bookings.find((booking) => booking.id === created.booking.id)!.price;
        await service.saveSchedule(therapist.token, {
          action: "service",
          serviceId: service60.id,
          name: service60.name,
          duration: 60,
          price: "99",
        });
        assert.equal(
          (await service.list(firstClient.token)).bookings.find(
            (booking) => booking.id === created.booking.id,
          )!.price,
          priceBefore,
        );
        await service.respond(therapist.token, created.booking.id, {
          action: "cancel",
        });
        assert.equal(
          (await service.slots(schedule.id, 60, date)).slots.find(
            (slot) => slot.start === 720,
          )!.available,
          true,
        );
        const events = (await service.list(firstClient.token)).bookings.find(
          (booking) => booking.id === created.booking.id,
        )!.events;
        assert.equal(events.length, 4);
        assert.equal(events[1].previousStart, 660);
      },
    );
    await context.test(
      "custom durations, service ownership and migration reruns preserve bookings",
      async () => {
        await service.saveSchedule(therapist.token, {
          action: "service",
          name: "Razgovor 40",
          duration: 40,
          price: "40",
        });
        await service.saveSchedule(therapist.token, {
          action: "service",
          name: "Razgovor 50",
          duration: 50,
          price: "50",
        });
        const types = (await service.schedule(therapist.token)).therapist
          .services;
        const short = types.find((session) => session.duration === 40)!;
        const long = types.find((session) => session.duration === 50)!;
        await assert.rejects(
          service.saveSchedule(otherTherapist.token, {
            action: "service",
            serviceId: short.id,
            name: "Tuđa seansa",
            duration: 45,
            price: 0,
          }),
        );
        const nextDate = addDays(date, 1);
        await service.saveSchedule(therapist.token, {
          action: "window",
          weekday: weekday(nextDate),
          start: 540,
          end: 720,
        });
        const first = await service.create(firstClient.token, {
          ...input,
          date: nextDate,
          serviceId: short.id,
          start: 540,
        });
        await assert.rejects(
          service.create(firstClient.token, {
            ...input,
            date: nextDate,
            serviceId: short.id,
            start: 630,
            duration: 50,
          }),
          /Trajanje seanse je promijenjeno/,
        );
        assert.equal(first.booking.end, 580);
        const options = await service.slots(schedule.id, 50, nextDate);
        assert.equal(
          options.slots.find((slot) => slot.start === 540)!.available,
          false,
        );
        assert.equal(
          options.slots.find((slot) => slot.start === 580)!.available,
          true,
        );
        assert.equal(
          options.slots.some((slot) => slot.start === 585),
          false,
        );
        const second = await service.create(secondClient.token, {
          ...input,
          date: nextDate,
          serviceId: long.id,
          start: 580,
        });
        assert.equal(second.booking.end, 630);
        await service.saveSchedule(therapist.token, {
          action: "service",
          serviceId: short.id,
          name: "Razgovor 45",
          duration: 45,
          price: "99",
        });
        const history = (await service.list(firstClient.token)).bookings.find(
          (booking) => booking.id === first.booking.id,
        )!;
        assert.equal(history.duration, 40);
        assert.equal(history.price, 40);
        assert.equal(history.serviceName, "Razgovor 40");
        const migration = spawnSync(
          process.execPath,
          [require.resolve("tsx/cli"), resolve(__dirname, "../src/migrate.ts")],
          {
            cwd: resolve(__dirname, "../../.."),
            env: { ...process.env, DATABASE_URL: url.toString() },
            encoding: "utf8",
            windowsHide: true,
          },
        );
        assert.equal(migration.status, 0, migration.stderr);
        assert.equal(
          (await service.schedule(therapist.token)).therapist.services.find(
            (session) => session.id === short.id,
          )!.active,
          true,
        );
        await service.saveSchedule(therapist.token, {
          action: "remove-service",
          serviceId: short.id,
        });
        await assert.rejects(
          service.create(firstClient.token, {
            ...input,
            date: nextDate,
            serviceId: short.id,
            start: 630,
          }),
        );
        assert.equal(
          (await service.list(firstClient.token)).bookings.find(
            (booking) => booking.id === first.booking.id,
          )!.duration,
          40,
        );
      },
    );
    await context.test(
      "removed break actions are rejected and removing hours preserves reservation history",
      async () => {
        await assert.rejects(
          service.saveSchedule(therapist.token, {
            action: "block",
            date,
            start: 720,
            end: 750,
          }),
          /Nepoznata izmjena rasporeda/,
        );
        await assert.rejects(
          service.saveSchedule(therapist.token, {
            action: "remove-block",
            id: randomUUID(),
          }),
          /Nepoznata izmjena rasporeda/,
        );
        assert.equal(
          (await database.pool.query("SELECT count(*) FROM calendar_blocks"))
            .rows[0].count,
          "0",
        );
        assert.equal(
          (await service.slots(schedule.id, 30, date)).slots.find(
            (slot) => slot.start === 720,
          )!.available,
          true,
        );
        await service.saveSchedule(therapist.token, {
          action: "remove-window",
          id: windowId,
        });
        assert.equal(
          (await service.slots(schedule.id, 30, date)).slots.length,
          0,
        );
        assert.ok((await service.list(therapist.token)).bookings.length >= 3);
      },
    );
    await context.test(
      "editing weekly hours and dated availability preserves bookings and ownership",
      async () => {
        const owner = await createAccount("EditTerapeut", true);
        const profile = (await service.schedule(owner.token)).therapist;
        const chosenService = profile.services.find((item) => item.active)!;
        const firstDate = addDays(dateKey(), 2);
        const movedDate = addDays(firstDate, 1);
        const savedWeek = await service.saveSchedule(owner.token, {
          action: "window",
          weekday: weekday(firstDate),
          start: 540,
          end: 720,
        });
        const ownWindow = savedWeek.therapist.availability[0];
        await assert.rejects(
          service.saveSchedule(otherTherapist.token, {
            action: "window",
            id: ownWindow.id,
            weekday: weekday(firstDate),
            start: 600,
            end: 780,
          }),
        );
        await service.saveSchedule(owner.token, {
          action: "window",
          weekday: weekday(firstDate),
          start: 780,
          end: 900,
        });
        await assert.rejects(
          service.saveSchedule(owner.token, {
            action: "window",
            id: ownWindow.id,
            weekday: weekday(firstDate),
            start: 840,
            end: 960,
          }),
        );
        assert.equal(
          (await service.schedule(owner.token)).therapist.availability.find(
            (item) => item.id === ownWindow.id,
          )!.start,
          540,
        );
        await service.saveSchedule(owner.token, {
          action: "window",
          id: ownWindow.id,
          weekday: weekday(movedDate),
          start: 600,
          end: 720,
        });
        const created = await service.saveSchedule(owner.token, {
          action: "date-availability",
          date: firstDate,
          working: "true",
          start: 540,
          end: 720,
        });
        const ownDate = created.therapist.dateAvailability[0];
        assert.equal(
          (await service.slots(profile.id, 60, firstDate)).dayOff,
          false,
        );
        assert.equal(
          (await service.slots(profile.id, 60, firstDate)).slots[0].start,
          540,
        );
        assert.equal(
          (await service.slots(profile.id, 60, addDays(firstDate, 7))).slots[0]
            .start,
          780,
        );
        await assert.rejects(
          service.saveSchedule(firstClient.token, {
            action: "date-availability",
            date: firstDate,
            working: "true",
            start: 540,
            end: 720,
          }),
        );
        await assert.rejects(
          service.saveSchedule(otherTherapist.token, {
            action: "date-availability",
            id: ownDate.id,
            date: firstDate,
            working: "true",
            start: 540,
            end: 720,
          }),
        );
        await assert.rejects(
          service.saveSchedule(otherTherapist.token, {
            action: "remove-date",
            id: ownDate.id,
          }),
        );
        await assert.rejects(
          service.saveSchedule(owner.token, {
            action: "date-availability",
            date: firstDate,
            working: "true",
            start: 540,
            end: 720,
          }),
          /već postoji/,
        );
        const booking = await service.create(firstClient.token, {
          therapistId: profile.id,
          serviceId: chosenService.id,
          date: firstDate,
          start: 540,
          phone: "+38267123456",
        });
        const savedHistory = (
          await service.list(firstClient.token)
        ).bookings.find((item) => item.id === booking.booking.id)!.events;
        await service.saveSchedule(owner.token, {
          action: "service",
          serviceId: chosenService.id,
          name: "Partnerska terapija",
          duration: 40,
          price: 45,
        });
        assert.equal(
          (await service.slots(profile.id, 40, firstDate)).slots.find(
            (item) => item.start === 540,
          )!.available,
          false,
        );
        assert.equal(
          (await service.slots(profile.id, 40, firstDate)).slots.find(
            (item) => item.start === 600,
          )!.available,
          true,
        );
        await service.saveSchedule(owner.token, {
          action: "date-availability",
          id: ownDate.id,
          date: firstDate,
          working: "false",
        });
        assert.deepEqual(
          (await service.slots(profile.id, 40, firstDate)).slots,
          [],
        );
        assert.equal(
          (await service.slots(profile.id, 40, firstDate)).dayOff,
          true,
        );
        // Nova čitanja i sva trajanja moraju poštovati isti aktivan neradni datum.
        assert.equal(
          (await service.schedule(owner.token)).therapist.dateAvailability.find(
            (item) => item.id === ownDate.id,
          )!.working,
          false,
        );
        for (const duration of [30, 50, 60]) {
          const closedDay = await service.slots(
            profile.id,
            duration,
            firstDate,
          );
          assert.equal(closedDay.dayOff, true);
          assert.deepEqual(closedDay.slots, []);
        }
        await assert.rejects(
          service.create(secondClient.token, {
            therapistId: profile.id,
            serviceId: chosenService.id,
            date: firstDate,
            start: 600,
            phone: "+38267123456",
          }),
        );
        await service.saveSchedule(owner.token, {
          action: "date-availability",
          id: ownDate.id,
          date: movedDate,
          working: "true",
          start: 660,
          end: 840,
        });
        assert.equal(
          (await service.slots(profile.id, 40, firstDate)).slots[0].start,
          780,
        );
        assert.equal(
          (await service.slots(profile.id, 40, firstDate)).dayOff,
          false,
        );
        assert.equal(
          (await service.slots(profile.id, 40, movedDate)).slots[0].start,
          660,
        );
        const conflictDate = addDays(movedDate, 1);
        await service.saveSchedule(owner.token, {
          action: "date-availability",
          date: conflictDate,
          working: "false",
        });
        await assert.rejects(
          service.saveSchedule(owner.token, {
            action: "date-availability",
            id: ownDate.id,
            date: conflictDate,
            working: "false",
          }),
          /već postoji/,
        );
        assert.equal(
          (await service.schedule(owner.token)).therapist.dateAvailability.find(
            (item) => item.id === ownDate.id,
          )!.date,
          movedDate,
        );
        for (const input of [
          {
            date: addDays(dateKey(), 91),
            working: "true",
            start: 540,
            end: 720,
          },
          { date: addDays(firstDate, 4), working: "yes" },
          {
            date: addDays(firstDate, 4),
            working: "true",
            start: 720,
            end: 540,
          },
        ]) {
          await assert.rejects(
            service.saveSchedule(owner.token, {
              action: "date-availability",
              ...input,
            }),
          );
        }
        const raceDate = addDays(firstDate, 5);
        const outcomes = await Promise.allSettled([
          service.saveSchedule(owner.token, {
            action: "date-availability",
            date: raceDate,
            working: "true",
            start: 540,
            end: 720,
          }),
          service.saveSchedule(owner.token, {
            action: "date-availability",
            date: raceDate,
            working: "true",
            start: 600,
            end: 780,
          }),
        ]);
        assert.equal(
          outcomes.filter((result) => result.status === "fulfilled").length,
          1,
        );
        await service.saveSchedule(owner.token, {
          action: "remove-date",
          id: ownDate.id,
        });
        assert.equal(
          (await service.slots(profile.id, 40, movedDate)).slots[0].start,
          600,
        );
        const preserved = (await service.list(firstClient.token)).bookings.find(
          (item) => item.id === booking.booking.id,
        )!;
        assert.equal(preserved.duration, 60);
        assert.equal(preserved.serviceName, chosenService.name);
        assert.equal(preserved.price, chosenService.price);
        assert.equal(preserved.date, firstDate);
        assert.equal(preserved.start, 540);
        assert.deepEqual(preserved.events, savedHistory);
      },
    );
    await context.test(
      "server expiry records one event even when multiple workers run",
      async () => {
        const row = (
          await database.pool.query(
            "SELECT id FROM booking_requests WHERE status='REQUESTED' LIMIT 1",
          )
        ).rows[0];
        await database.pool.query(
          "UPDATE booking_requests SET start_at=now()-interval '2 hours',end_at=now()-interval '2 hours'+make_interval(mins=>duration_minutes) WHERE id=$1",
          [row.id],
        );
        await Promise.all([
          repository.expireWaiting(),
          repository.expireWaiting(),
        ]);
        assert.equal(
          (
            await database.pool.query(
              "SELECT status FROM booking_requests WHERE id=$1",
              [row.id],
            )
          ).rows[0].status,
          "EXPIRED_PROVIDER",
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*) FROM booking_events WHERE booking_id=$1 AND action='UNANSWERED_AT_START'",
              [row.id],
            )
          ).rows[0].count,
          "1",
        );
      },
    );
  },
);
