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
import { EmailService } from "../src/auth/email.service";
import { hashPassword } from "../src/auth/auth.crypto";
import { DirectoryService } from "../src/directory/directory.service";
import { BookingService } from "../src/bookings/booking.service";
import { BookingRepository } from "../src/bookings/booking.repository";
import { BookingNotificationService } from "../src/notifications/booking-notification.service";
import {
  buildBookingEmail,
  type BookingEmailDetails,
} from "../src/notifications/booking-email-message";

// Tekst poruke koristi snimak rezervacije i pravilno razlikuje predlog od potvrđene seanse.
test("booking email text includes snapshots, local date, previous time and a safe app link", () => {
  const details: BookingEmailDetails = {
    therapistName: "Ana Marković",
    clientName: "Mila Test",
    serviceName: "Seansa 50",
    date: "2026-10-20",
    start: 660,
    end: 710,
    duration: 50,
    price: null,
    city: "Podgorica",
    address: "Ulica 1",
    previousDate: "2026-10-19",
    previousStart: 540,
  };
  const message = buildBookingEmail(
    "booking-proposed",
    details,
    "http://localhost:3000/account#booking-test",
  );
  assert.match(message.subject, /predložen/);
  const onlineMessage = buildBookingEmail(
    "booking-confirmed",
    { ...details, online: true },
    "https://example.test/account",
  );
  assert.match(onlineMessage.text, /Online video seansa/);
  assert.doesNotMatch(onlineMessage.text, /Ordinacija:|Ulica 1/);
  for (const text of [
    "Ana Marković",
    "Mila Test",
    "Seansa 50",
    "11:00–11:50",
    "Europe/Podgorica",
    "Na upit",
    "2026-10-19 u 09:00",
    "još nije potvrđena",
    "/account#booking-test",
  ])
    assert.ok(message.text.includes(text), text);
  assert.match(
    buildBookingEmail(
      "booking-confirmed",
      { ...details, price: 0 },
      "http://localhost:3000",
    ).text,
    /0,00/,
  );
});

// Izolovana šema i lažni SMTP provjeravaju trajnost, rollback, retry i konkurentno slanje bez stvarnih emailova.
test(
  "booking outbox persists notifications and safely processes delivery",
  { skip: !process.env.AUTH_TEST_DATABASE_URL },
  async (context) => {
    const admin = new Pool({
      connectionString: process.env.AUTH_TEST_DATABASE_URL,
    });
    const schemaName = `auth_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    const url = new URL(process.env.AUTH_TEST_DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schemaName},public`);
    process.env.DATABASE_URL = url.toString();
    const database = new DatabaseService();
    const messages: {
      recipient: string;
      subject: string;
      text: string;
      id: string;
    }[] = [];
    let failSending = false;
    let failureCode: string | undefined;
    let sendGate: (() => Promise<void>) | null = null;
    const email = {
      mode: "local",
      /** Testni email servis je uključen, ali ne šalje spoljne poruke. */
      assertDeliveryEnabled() {},
      /** Hvata samo testne poruke; greška i čekanje oponašaju stvarni SMTP servis. */
      async sendBookingNotification(
        recipient: string,
        subject: string,
        text: string,
        id: string,
      ) {
        if (failSending)
          throw Object.assign(new Error("Test SMTP failure"), {
            code: failureCode,
          });
        if (sendGate) await sendGate();
        messages.push({ recipient, subject, text, id });
      },
    } as unknown as EmailService;
    const notifications = new BookingNotificationService(database, email);
    const secondWorker = new BookingNotificationService(database, email);
    // Ručno biramo trenutak obrade, da test ne zavisi od brzine intervala ili SMTP-a.
    notifications.wake = () => {};
    const auth = new AuthService(database, email);
    const repository = new BookingRepository(database);
    const service = new BookingService(
      database,
      auth,
      new DirectoryService(database),
      repository,
      notifications,
    );
    context.after(async () => {
      await notifications.onModuleDestroy();
      await secondWorker.onModuleDestroy();
      await database.pool.end();
      await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await admin.end();
    });
    for (const filename of [
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
      "db/migrations/015-online-sessions.sql",
    ])
      await database.pool.query(
        await readFile(resolve(__dirname, "../../..", filename), "utf8"),
      );
    const password = "Testna lozinka za email obavjestenja!";
    const passwordHash = await hashPassword(password);
    for (const [name, role] of [
      ["therapist", "THERAPIST"],
      ["patient", "CLIENT"],
      ["other", "CLIENT"],
    ])
      await database.pool.query(
        "INSERT INTO users (email,password_hash,full_name,first_name,last_name,role,verified_at) VALUES ($1,$2,$3,$3,'Test',$4,now())",
        [`${name}@example.test`, passwordHash, name, role],
      );
    const therapist = await auth.login("therapist@example.test", password);
    const patient = await auth.login("patient@example.test", password);
    const other = await auth.login("other@example.test", password);
    const therapistId = (
      await database.pool.query(
        "INSERT INTO therapists (linked_user_id,full_name,title_mne,title_en,bio_mne,city) VALUES ($1,'Test Terapeut','Psihoterapeut','Psychotherapist','Test biografija','Podgorica') RETURNING id",
        [therapist.user.id],
      )
    ).rows[0].id;
    const sessionId = (
      await database.pool.query(
        "INSERT INTO services (therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,'Seansa 60','Session 60',60,50) RETURNING id",
        [therapistId],
      )
    ).rows[0].id;
    let nextDay = 1;
    /** Svaki scenario dobija novi datum, pa ranije rezervacije ne utiču na provjeru. */
    async function createBooking() {
      const date = addDays(dateKey(), nextDay++);
      await service.saveSchedule(therapist.token, {
        action: "date-availability",
        date,
        working: "true",
        start: "540",
        end: "1020",
      });
      return (
        await service.create(patient.token, {
          therapistId,
          serviceId: sessionId,
          duration: "60",
          date,
          start: "540",
          phone: "+38267123456",
        })
      ).booking;
    }
    /** Čita javno objašnjena polja reda, bez sadržaja poruke ili SMTP tajni. */
    async function rowsFor(bookingId: string) {
      return (
        await database.pool.query(
          "SELECT * FROM notification_outbox WHERE booking_id=$1 ORDER BY created_at,id",
          [bookingId],
        )
      ).rows;
    }

    await context.test(
      "new request notifies the therapist once and duplicate queue writes are ignored",
      async () => {
        const booking = await createBooking();
        assert.equal(messages.length, 0);
        const connection = await database.pool.connect();
        try {
          await notifications.queue(
            connection,
            booking.id,
            "booking-requested",
            "THERAPIST",
          );
        } finally {
          connection.release();
        }
        assert.equal((await rowsFor(booking.id)).length, 1);
        await notifications.processPending();
        await notifications.processPending();
        assert.equal(messages.length, 1);
        assert.equal(messages[0].recipient, "therapist@example.test");
        assert.match(messages[0].text, /\/dashboard#booking-/);
        assert.ok((await rowsFor(booking.id))[0].sent_at);
        const count = (await rowsFor(booking.id)).length;
        await assert.rejects(
          service.respond(other.token, booking.id, { action: "cancel" }),
        );
        await assert.rejects(
          service.create(other.token, {
            therapistId,
            serviceId: sessionId,
            date: booking.date,
            start: "540",
            phone: "+38267123456",
          }),
        );
        assert.equal((await rowsFor(booking.id)).length, count);
      },
    );

    await context.test(
      "SMTP failure preserves the booking and retries after restart with the same message ID",
      async () => {
        const booking = await createBooking();
        failSending = true;
        await notifications.processPending();
        let row = (await rowsFor(booking.id))[0];
        assert.equal(row.attempts, 1);
        assert.equal(row.last_error, "SMTP_SEND_FAILED");
        assert.equal(row.sent_at, null);
        await notifications.processPending();
        assert.equal((await rowsFor(booking.id))[0].attempts, 1);
        assert.equal(
          (await service.list(patient.token)).bookings.find(
            (item) => item.id === booking.id,
          )!.status,
          "REQUESTED",
        );
        for (const [code, expected] of [
          ["EAUTH", "SMTP_AUTH_FAILED"],
          ["ECONNECTION", "SMTP_CONNECTION_FAILED"],
          ["SES_SEND_FAILED", "SES_SEND_FAILED"],
        ]) {
          failureCode = code;
          await database.pool.query(
            "UPDATE notification_outbox SET scheduled_at=now() WHERE id=$1",
            [row.id],
          );
          await notifications.processPending();
          assert.equal((await rowsFor(booking.id))[0].last_error, expected);
        }
        failSending = false;
        failureCode = undefined;
        await database.pool.query(
          "UPDATE notification_outbox SET scheduled_at=now() WHERE id=$1",
          [row.id],
        );
        await secondWorker.processPending();
        row = (await rowsFor(booking.id))[0];
        assert.equal(row.attempts, 5);
        assert.ok(row.sent_at);
        assert.equal(row.last_error, null);
        assert.equal(messages.at(-1)!.id, row.id);
      },
    );

    await context.test(
      "confirmation skips an unsent obsolete request and emails only the client",
      async () => {
        const booking = await createBooking();
        const before = messages.length;
        await service.respond(therapist.token, booking.id, {
          action: "confirm",
        });
        await notifications.processPending();
        const rows = await rowsFor(booking.id);
        assert.equal(
          rows.find((row) => row.template_key === "booking-requested")!
            .skipped_reason,
          "BOOKING_CHANGED",
        );
        assert.equal(messages.length, before + 1);
        assert.equal(messages.at(-1)!.recipient, "patient@example.test");
        assert.match(messages.at(-1)!.subject, /potvrđen/);
        assert.match(messages.at(-1)!.text, /\/account#booking-/);
        await service.respond(patient.token, booking.id, { action: "cancel" });
        await notifications.processPending();
        assert.equal(messages.at(-1)!.recipient, "therapist@example.test");
        assert.match(messages.at(-1)!.subject, /otkazan/);
      },
    );

    await context.test(
      "proposal, acceptance, rejection and therapist cancellation notify the other party",
      async () => {
        for (const reply of ["accept-alternative", "reject-alternative"]) {
          const booking = await createBooking();
          await notifications.processPending();
          await service.respond(therapist.token, booking.id, {
            action: "propose",
            date: booking.date,
            start: "660",
          });
          await notifications.processPending();
          assert.equal(messages.at(-1)!.recipient, "patient@example.test");
          assert.match(messages.at(-1)!.text, /11:00–12:00/);
          assert.match(messages.at(-1)!.text, /Prethodni termin:.*09:00/);
          await service.respond(patient.token, booking.id, { action: reply });
          await notifications.processPending();
          assert.equal(messages.at(-1)!.recipient, "therapist@example.test");
          assert.match(
            messages.at(-1)!.subject,
            reply === "accept-alternative" ? /prihvatio/ : /odbio/,
          );
        }
        for (const action of ["decline", "cancel"]) {
          const booking = await createBooking();
          await notifications.processPending();
          await service.respond(therapist.token, booking.id, { action });
          await notifications.processPending();
          assert.equal(messages.at(-1)!.recipient, "patient@example.test");
          assert.match(
            messages.at(-1)!.subject,
            action === "decline" ? /odbijen/ : /otkazan/,
          );
        }
      },
    );

    await context.test(
      "two workers and repeated ticks cannot send the same pending row concurrently",
      async () => {
        const booking = await createBooking();
        const before = messages.length;
        let release = () => {};
        let started = () => {};
        const waiting = new Promise<void>((resolve) => {
          release = resolve;
        });
        const sending = new Promise<void>((resolve) => {
          started = resolve;
        });
        sendGate = async () => {
          started();
          await waiting;
        };
        const first = notifications.processPending();
        try {
          await sending;
          await secondWorker.processPending();
          assert.equal(messages.length, before);
          release();
          await first;
        } finally {
          release();
          sendGate = null;
        }
        await secondWorker.processPending();
        assert.equal(messages.length, before + 1);
        assert.ok((await rowsFor(booking.id))[0].sent_at);
      },
    );

    await context.test(
      "inactive recipients are skipped instead of receiving private details",
      async () => {
        const booking = await createBooking();
        const before = messages.length;
        await database.pool.query(
          "UPDATE users SET suspended_at=now() WHERE id=$1",
          [therapist.user.id],
        );
        try {
          await notifications.processPending();
        } finally {
          await database.pool.query(
            "UPDATE users SET suspended_at=NULL WHERE id=$1",
            [therapist.user.id],
          );
        }
        assert.equal(
          (await rowsFor(booking.id))[0].skipped_reason,
          "RECIPIENT_UNAVAILABLE",
        );
        assert.equal(messages.length, before);
      },
    );

    await context.test(
      "outbox failure rolls back the booking, status and history without sending",
      async () => {
        const booking = await createBooking();
        await notifications.processPending();
        const before = messages.length;
        const count = (
          await database.pool.query("SELECT count(*) FROM booking_requests")
        ).rows[0].count;
        await database.pool.query(
          "CREATE FUNCTION fail_booking_email() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Test outbox failure'; END$$; CREATE TRIGGER fail_booking_email BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION fail_booking_email()",
        );
        try {
          await assert.rejects(createBooking());
          await assert.rejects(
            service.respond(therapist.token, booking.id, { action: "confirm" }),
          );
          assert.equal(
            (await database.pool.query("SELECT count(*) FROM booking_requests"))
              .rows[0].count,
            count,
          );
          const preserved = (await service.list(patient.token)).bookings.find(
            (item) => item.id === booking.id,
          )!;
          assert.equal(preserved.status, "REQUESTED");
          assert.equal(preserved.events.length, 1);
          assert.equal((await rowsFor(booking.id)).length, 1);
          assert.equal(messages.length, before);
        } finally {
          await database.pool.query(
            "DROP TRIGGER fail_booking_email ON notification_outbox; DROP FUNCTION fail_booking_email()",
          );
        }
      },
    );
  },
);
