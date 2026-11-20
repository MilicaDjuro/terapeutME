import "../src/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DatabaseService } from "../src/database.service";
import { AuthService } from "../src/auth/auth.service";
import { EmailService } from "../src/auth/email.service";
import { DirectoryService } from "../src/directory/directory.service";
import { PhotosService, normalizePhoto } from "../src/directory/photos.service";
import { seedDirectory } from "../src/directory/seed-directory";
import sharp from "sharp";
import {
  hashPassword,
  hashToken,
  privateHash,
  verifyPassword,
} from "../src/auth/auth.crypto";
import {
  requireBirthDate,
  validateRegistration,
  validateTherapistRegistration,
  requireSessionPrice,
  validateTherapistProfile,
  validateAccountProfile,
} from "../src/auth/auth.validation";

// Provjerava server čak i kada browser pošalje pogrešan datum, kratku lozinku ili dodatnu ulogu.
test("registration validates dates, names, email and password on the server", () => {
  const values = {
    firstName: " Ana ",
    lastName: " Marković ",
    email: " ANA@EXAMPLE.TEST ",
    dateOfBirth: "1990-04-12",
    password: "Moja duga test lozinka!",
    role: "ADMIN",
  };
  assert.equal(validateRegistration(values).email, "ana@example.test");
  assert.equal(validateRegistration(values).firstName, "Ana");
  assert.equal("role" in validateRegistration(values), false);
  assert.throws(() => validateRegistration({ ...values, firstName: " " }));
  assert.throws(() => validateRegistration({ ...values, email: "nije-email" }));
  assert.throws(() => validateRegistration({ ...values, password: "kratka" }));
  assert.throws(() => requireBirthDate("2025-02-29"));
  assert.throws(() => requireBirthDate("2100-01-01"));
  assert.equal(requireBirthDate("2000-02-29"), "2000-02-29");
});

// Provjerava da lozinka nije običan tekst, so je različita i pogrešna lozinka ne prolazi.
test("password hashing uses independent salts and verifies credentials", async () => {
  const password = "Pravilna test lozinka!";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("Pogrešna test lozinka!", first), false);
  assert.equal(await verifyPassword(password, null), false);
});

// Profesionalni podaci se provjeravaju na serveru, uključujući razliku prazne i nulte cijene.
test("therapist registration validates biography, contact, duration and decimal prices", () => {
  const values = {
    firstName: "Ana",
    lastName: "Test",
    email: "ana@example.test",
    dateOfBirth: "1990-04-12",
    password: "Moja duga test lozinka!",
    title: "Psiholog",
    biography: "Radim individualno sa odraslima.",
    city: "Podgorica",
    phone: "+382 67 123 456",
    address: "",
    serviceName: "Individualna seansa",
    durationMinutes: "60",
    priceEur: "45.50",
    role: "ADMIN",
    isVerified: true,
  };
  const validated = validateTherapistRegistration(values);
  assert.equal(validated.profile.priceEur, 45.5);
  assert.equal(validated.profile.address, null);
  assert.equal("role" in validated.registration, false);
  assert.equal("isVerified" in validated.profile, false);
  assert.equal(requireSessionPrice(""), null);
  assert.equal(requireSessionPrice("0"), 0);
  assert.equal(requireSessionPrice("45,25"), 45.25);
  for (const value of ["-1", "1.234", "NaN", "Infinity", "100000000", true, {}])
    assert.throws(() => requireSessionPrice(value));
  for (const duration of ["4", "241", "60.5", "", true])
    assert.throws(() =>
      validateTherapistRegistration({ ...values, durationMinutes: duration }),
    );
  assert.throws(() =>
    validateTherapistRegistration({ ...values, biography: "a".repeat(401) }),
  );
  assert.throws(() =>
    validateTherapistRegistration({ ...values, biography: " " }),
  );
  assert.throws(() =>
    validateTherapistRegistration({ ...values, phone: "nije telefon" }),
  );
  assert.throws(() => validateTherapistRegistration({ ...values, city: "" }));
  const profileUpdate = validateTherapistProfile(values);
  assert.equal("role" in profileUpdate, false);
  assert.equal("isVerified" in profileUpdate, false);
  assert.equal("serviceName" in profileUpdate, false);
});

// Lični formular normalizuje unos i ne dozvoljava promjenu privilegija ili tuđeg naloga.
test("personal profile validation accepts only editable fields", () => {
  const input = {
    firstName: " Milica ",
    lastName: " Test ",
    dateOfBirth: "1992-05-14",
    phone: "+382 67 123 456",
    userId: randomUUID(),
    role: "ADMIN",
    email: "changed@example.test",
    password: "changed",
    verified_at: new Date(),
  };
  assert.deepEqual(validateAccountProfile(input), {
    firstName: "Milica",
    lastName: "Test",
    dateOfBirth: "1992-05-14",
    phone: input.phone,
  });
  assert.equal(validateAccountProfile({ ...input, phone: " " }).phone, null);
  assert.equal(
    validateAccountProfile({ ...input, phone: undefined }).phone,
    undefined,
  );
  for (const invalid of [
    { firstName: " " },
    { lastName: "x".repeat(61) },
    { dateOfBirth: "1990-02-30" },
    { dateOfBirth: "2999-01-01" },
    { phone: "not a number" },
    { phone: 12345678 },
    { city: "x".repeat(81) },
    { address: "x".repeat(161) },
    { biography: "x".repeat(401) },
  ])
    assert.throws(() => validateAccountProfile({ ...input, ...invalid }));
});

// Integracija koristi zasebnu nasumičnu šemu; nikad ne mijenja stvarne naloge ili rezervacije.
test(
  "PostgreSQL registration, verification and session rules",
  { skip: !process.env.AUTH_TEST_DATABASE_URL },
  async (context) => {
    const connectionString = process.env.AUTH_TEST_DATABASE_URL!;
    const admin = new Pool({ connectionString });
    const schemaName = `auth_test_${randomUUID().replaceAll("-", "")}`;
    assert.match(schemaName, /^auth_test_[a-f0-9]{32}$/);
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    const isolatedUrl = new URL(connectionString);
    isolatedUrl.searchParams.set(
      "options",
      `-c search_path=${schemaName},public`,
    );
    process.env.DATABASE_URL = isolatedUrl.toString();
    const database = new DatabaseService();
    const delivered = new Map<string, string>();
    const email = {
      mode: "local",
      /** Testni email servis je uključen, ali ne šalje spoljne poruke. */
      assertDeliveryEnabled() {},
      /** Hvata poruke samo u testu; ne šalje ih stvarnim primaocima. */
      async sendRegistrationCode(recipient: string, code: string) {
        if (recipient.startsWith("smtp-failure"))
          throw new Error("SMTP unavailable");
        delivered.set(recipient, code);
      },
    } as unknown as EmailService;
    const auth = new AuthService(database, email);
    /** Gradi podatke samo testnog naloga; svaka provjera koristi drugi email. */
    function registration(emailAddress: string) {
      return {
        firstName: "Ana",
        lastName: "Test",
        email: emailAddress,
        dateOfBirth: "1990-04-12",
        password: "Pravilna test lozinka!",
      };
    }
    /** Uklanja samo nasumičnu testnu šemu poslije svih provjera, uključujući neuspjeh. */
    context.after(async () => {
      auth.onModuleDestroy();
      await database.pool.end();
      await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await admin.end();
    });
    const rootDirectory = resolve(__dirname, "../../..");
    await database.pool.query(
      await readFile(resolve(rootDirectory, "db/schema.sql"), "utf8"),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/002-auth.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/003-therapist-registration.sql"),
        "utf8",
      ),
    );

    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/004-directory-photos.sql"),
        "utf8",
      ),
    );

    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/006-profile-contact.sql"),
        "utf8",
      ),
    );

    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/007-password-reset.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/008-date-availability.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/009-booking-notifications.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/010-recurring-bookings.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/011-waitlist.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/012-client-materials.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/013-profile-analytics.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/014-profile-view-events.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/015-therapist-notes.sql"),
        "utf8",
      ),
    );
    await database.pool.query(
      await readFile(
        resolve(rootDirectory, "db/migrations/016-session-ratings.sql"),
        "utf8",
      ),
    );
    // Potvrda kreira jedan nalog, serijalizuje paralelne pokušaje i izdaje opozivu sesiju.
    await context.test(
      "account appears only after verification; concurrent verification creates one account",
      async () => {
        const input = registration("confirmed@example.test");
        const started = await auth.startRegistration(input);
        const code = delivered.get(input.email)!;
        assert.match(code, /^\d{4}$/);
        const pending = await database.pool.query(
          "SELECT password_hash, code_hash FROM registration_challenges WHERE id = $1",
          [started.challengeId],
        );
        assert.notEqual(pending.rows[0].password_hash, input.password);
        assert.notEqual(pending.rows[0].code_hash, code);
        assert.equal(
          (await database.pool.query("SELECT count(*) FROM users")).rows[0]
            .count,
          "0",
        );
        await assert.rejects(auth.login(input.email, input.password));
        const outcomes = await Promise.allSettled([
          auth.verifyRegistration(started.challengeId, code),
          auth.verifyRegistration(started.challengeId, code),
        ]);
        const accepted = outcomes.find(
          (outcome) => outcome.status === "fulfilled",
        );
        assert.ok(accepted && accepted.status === "fulfilled");
        assert.equal(
          outcomes.filter((outcome) => outcome.status === "fulfilled").length,
          1,
        );
        assert.equal(accepted.value.user.role, "CLIENT");
        assert.equal(accepted.value.user.dateOfBirth, input.dateOfBirth);
        assert.equal("password_hash" in accepted.value.user, false);
        assert.equal(
          (await auth.getAccount(accepted.value.token)).email,
          input.email,
        );
        const storedSession = (
          await database.pool.query(
            "SELECT token_hash FROM auth_sessions WHERE user_id = $1",
            [accepted.value.user.id],
          )
        ).rows[0];
        assert.equal(storedSession.token_hash, hashToken(accepted.value.token));
        assert.notEqual(storedSession.token_hash, accepted.value.token);
        await assert.rejects(auth.getAccount("invalid"));
        await auth.logout(accepted.value.token);
        await assert.rejects(auth.getAccount(accepted.value.token));
        await assert.rejects(auth.startRegistration(input));
        await assert.rejects(auth.login(input.email, "Pogrešna test lozinka!"));
        const signedIn = await auth.login(input.email, input.password);
        await database.pool.query(
          "UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
          [hashToken(signedIn.token)],
        );
        await assert.rejects(auth.getAccount(signedIn.token));
        const active = await auth.login(input.email, input.password);
        await database.pool.query(
          "UPDATE users SET role = 'THERAPIST' WHERE id = $1",
          [active.user.id],
        );
        await assert.rejects(auth.getAccount(active.token));
        await database.pool.query(
          "UPDATE users SET role = 'CLIENT' WHERE id = $1",
          [active.user.id],
        );
        await database.pool.query(
          "UPDATE users SET suspended_at = now() WHERE id = $1",
          [active.user.id],
        );
        await assert.rejects(auth.getAccount(active.token));
        await assert.rejects(auth.login(input.email, input.password));
      },
    );

    // Pogrešni kodovi troše pokušaje i poslije ponovnog slanja ili stvaranja nove servis instance.
    await context.test(
      "five wrong codes lock verification and resend cannot reset attempts",
      async () => {
        const input = registration("locked@example.test");
        const started = await auth.startRegistration(input);
        const correctCode = delivered.get(input.email)!;
        const wrongCode = ((Number(correctCode) + 1) % 10000)
          .toString()
          .padStart(4, "0");
        for (let attempt = 0; attempt < 5; attempt += 1)
          await assert.rejects(
            auth.verifyRegistration(started.challengeId, wrongCode),
          );
        const restarted = new AuthService(database, email);
        await assert.rejects(
          restarted.verifyRegistration(started.challengeId, correctCode),
        );
        await assert.rejects(restarted.resendCode(started.challengeId));
        assert.equal(
          (
            await database.pool.query(
              "SELECT failed_attempts FROM registration_challenges WHERE id = $1",
              [started.challengeId],
            )
          ).rows[0].failed_attempts,
          5,
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*) FROM users WHERE email = $1",
              [input.email],
            )
          ).rows[0].count,
          "0",
        );
      },
    );

    // Istek i stariji kod ne prolaze; ponovni email je ograničen na jedan u 60 sekundi.
    await context.test(
      "expiration, resend cooldown and old-code invalidation",
      async () => {
        const input = registration("resend@example.test");
        const started = await auth.startRegistration(input);
        const old = delivered.get(input.email)!;
        await assert.rejects(auth.resendCode(started.challengeId));
        await database.pool.query(
          "UPDATE registration_challenges SET expires_at = now() - interval '1 second', next_send_at = now() - interval '1 second' WHERE id = $1",
          [started.challengeId],
        );
        await assert.rejects(
          auth.verifyRegistration(
            started.challengeId,
            delivered.get(input.email)!,
          ),
        );
        await auth.resendCode(started.challengeId);
        const newest = delivered.get(input.email)!;
        assert.notEqual(newest, old);
        await assert.rejects(auth.verifyRegistration(started.challengeId, old));
        const confirmed = await auth.verifyRegistration(
          started.challengeId,
          newest,
        );
        assert.equal(confirmed.user.email, input.email);
      },
    );

    // SMTP kvar ne kreira korisnika i omogućava novi početni pokušaj.
    await context.test(
      "SMTP failure never reports registration success or creates an account",
      async () => {
        const input = registration("smtp-failure@example.test");
        await assert.rejects(auth.startRegistration(input));
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*) FROM users WHERE email = $1",
              [input.email],
            )
          ).rows[0].count,
          "0",
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*) FROM registration_challenges WHERE email = $1",
              [input.email],
            )
          ).rows[0].count,
          "0",
        );
      },
    );

    // Potvrda kreira THERAPIST nalog, povezani profil i uslugu, bez profesionalne verifikacije.
    await context.test(
      "therapist account, profile and service are created together with the requested price",
      async () => {
        const details = {
          title: "Psihoterapeut",
          biography: "Radim sa odraslim osobama.",
          city: "Nikšić",
          address: "Test ulica 12",
          phone: "+382 67 123 456",
          serviceName: "Individualna seansa",
          durationMinutes: 60,
          priceEur: 55.25,
        };
        const input = registration("therapist@example.test");
        const started = await auth.startRegistration(input, details);
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*) FROM users WHERE email = $1",
              [input.email],
            )
          ).rows[0].count,
          "0",
        );
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*) FROM therapists t JOIN users u ON u.id = t.linked_user_id WHERE u.email = $1",
              [input.email],
            )
          ).rows[0].count,
          "0",
        );
        await assert.rejects(auth.startRegistration(input));
        await database.pool.query(
          "UPDATE registration_challenges SET next_send_at = now() - interval '1 second' WHERE id = $1",
          [started.challengeId],
        );
        await auth.resendCode(started.challengeId);
        assert.equal(
          (
            await database.pool.query(
              "SELECT registration_role FROM registration_challenges WHERE id = $1",
              [started.challengeId],
            )
          ).rows[0].registration_role,
          "THERAPIST",
        );
        const code = delivered.get(input.email)!;
        const results = await Promise.allSettled([
          auth.verifyRegistration(started.challengeId, code),
          auth.verifyRegistration(started.challengeId, code),
        ]);
        const accepted = results.find(
          (result) => result.status === "fulfilled",
        );
        assert.ok(accepted && accepted.status === "fulfilled");
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        assert.equal(accepted.value.user.role, "THERAPIST");
        const profile = await auth.getTherapistProfile(accepted.value.token);
        assert.equal(profile.name, "Ana Test");
        assert.equal(profile.city, "Nikšić");
        assert.equal(profile.biography, details.biography);
        assert.equal(profile.phone, details.phone);
        assert.equal(profile.verified, false);
        assert.equal(profile.services.length, 1);
        assert.equal(profile.services[0].priceEur, 55.25);
        assert.equal(profile.services[0].durationMinutes, 60);
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*) FROM therapist_registration_details WHERE challenge_id = $1",
              [started.challengeId],
            )
          ).rows[0].count,
          "0",
        );
        const login = await auth.login(input.email, input.password);
        assert.equal(login.user.role, "THERAPIST");
        assert.equal(
          (await auth.getTherapistProfile(login.token)).id,
          profile.id,
        );

        // Svaki drugi terapeut dobija drugi profil; NULL i 0 ostaju različite vrijednosti.
        for (const price of [null, 0]) {
          const nextInput = registration(
            `therapist-${price === null ? "null" : "zero"}@example.test`,
          );
          const next = await auth.startRegistration(nextInput, {
            ...details,
            city: "Budva",
            priceEur: price,
          });
          const confirmed = await auth.verifyRegistration(
            next.challengeId,
            delivered.get(nextInput.email)!,
          );
          const nextProfile = await auth.getTherapistProfile(confirmed.token);
          assert.notEqual(nextProfile.id, profile.id);
          assert.equal(nextProfile.services[0].priceEur, price);
          assert.equal(
            (await auth.getTherapistProfile(login.token)).city,
            "Nikšić",
          );
        }
        const clientInput = registration("role-client@example.test");
        const clientStarted = await auth.startRegistration(clientInput);
        const clientAccount = await auth.verifyRegistration(
          clientStarted.challengeId,
          delivered.get(clientInput.email)!,
        );
        assert.equal(clientAccount.user.role, "CLIENT");
        await assert.rejects(auth.getTherapistProfile(clientAccount.token));
        await assert.rejects(auth.getTherapistProfile(undefined));
      },
    );

    // Kvar čuvanja usluge mora povući i users i therapists upise, ostavljajući kod za novi pokušaj.
    await context.test(
      "therapist verification rolls back all records when service creation fails",
      async () => {
        const input = {
          ...registration("rollback-therapist@example.test"),
          firstName: "Rollback",
        };
        const details = {
          title: "Psiholog",
          biography: "Test biografija.",
          city: "Podgorica",
          address: null,
          phone: "+38267123456",
          serviceName: "Test failure",
          durationMinutes: 60,
          priceEur: null,
        };
        const started = await auth.startRegistration(input, details);
        await database.pool.query(
          "ALTER TABLE services ADD CONSTRAINT test_reject_service CHECK (name_mne <> 'Test failure')",
        );
        try {
          await assert.rejects(
            auth.verifyRegistration(
              started.challengeId,
              delivered.get(input.email)!,
            ),
          );
          assert.equal(
            (
              await database.pool.query(
                "SELECT count(*) FROM users WHERE email = $1",
                [input.email],
              )
            ).rows[0].count,
            "0",
          );
          assert.equal(
            (
              await database.pool.query(
                "SELECT count(*) FROM therapists WHERE full_name = 'Rollback Test'",
              )
            ).rows[0].count,
            "0",
          );
          assert.equal(
            (
              await database.pool.query(
                "SELECT count(*) FROM registration_challenges WHERE id = $1",
                [started.challengeId],
              )
            ).rows[0].count,
            "1",
          );
        } finally {
          await database.pool.query(
            "ALTER TABLE services DROP CONSTRAINT test_reject_service",
          );
        }
        const confirmed = await auth.verifyRegistration(
          started.challengeId,
          delivered.get(input.email)!,
        );
        assert.equal(confirmed.user.role, "THERAPIST");
        assert.equal(
          (await auth.getTherapistProfile(confirmed.token)).services.length,
          1,
        );
      },
    );

    // Čuvanje profila mora ostati kod vlasnika i sačuvati usluge, verifikaciju i atomski upis kontakta.
    await context.test(
      "profile updates enforce ownership and roll back if contact saving fails",
      async () => {
        const ownerInput = registration("profile-update@example.test");
        const started = await auth.startRegistration(ownerInput, {
          title: "Psihoterapeut",
          biography: "Početna biografija.",
          city: "Nikšić",
          address: "Test ulica",
          phone: "+38267123456",
          serviceName: "Test seansa",
          durationMinutes: 60,
          priceEur: 45,
        });
        const owner = await auth.verifyRegistration(
          started.challengeId,
          delivered.get(ownerInput.email)!,
        );
        const other = await auth.login(
          "therapist-zero@example.test",
          "Pravilna test lozinka!",
        );
        const client = await auth.login(
          "role-client@example.test",
          "Pravilna test lozinka!",
        );
        const original = await auth.getTherapistProfile(owner.token);
        const otherOriginal = await auth.getTherapistProfile(other.token);
        const input = validateTherapistProfile({
          title: "Psiholog",
          biography: "Nova biografija.",
          city: "Kotor",
          phone: "+38267111222",
          address: "",
          therapistId: otherOriginal.id,
          role: "ADMIN",
          isVerified: true,
        });
        await assert.rejects(auth.updateTherapistProfile(undefined, input));
        await assert.rejects(auth.updateTherapistProfile(client.token, input));
        const updated = await auth.updateTherapistProfile(owner.token, input);
        assert.equal(updated.id, original.id);
        assert.equal(updated.city, "Kotor");
        assert.equal(updated.address, null);
        assert.equal(updated.phone, input.phone);
        assert.equal(updated.verified, original.verified);
        assert.deepEqual(updated.services, original.services);
        assert.deepEqual(
          await auth.getTherapistProfile(other.token),
          otherOriginal,
        );
        await database.pool.query(
          "ALTER TABLE users ADD CONSTRAINT test_reject_contact CHECK (phone <> '+38267999999')",
        );
        try {
          await assert.rejects(
            auth.updateTherapistProfile(owner.token, {
              ...input,
              city: "Bar",
              phone: "+38267999999",
            }),
          );
          assert.deepEqual(
            await auth.getTherapistProfile(owner.token),
            updated,
          );
        } finally {
          await database.pool.query(
            "ALTER TABLE users DROP CONSTRAINT test_reject_contact",
          );
        }
      },
    );

    // Slike se čuvaju samo kod vlasnika, imaju jednu profilnu i ostaju ispravne nakon izmjene.
    await context.test(
      "photo uploads validate bytes, enforce ownership and serialize the eight-photo limit",
      async () => {
        const photos = new PhotosService(database, auth);
        const account = await auth.login(
          "therapist@example.test",
          "Pravilna test lozinka!",
        );
        const other = await auth.login(
          "therapist-zero@example.test",
          "Pravilna test lozinka!",
        );
        const image = await sharp({
          create: { width: 32, height: 32, channels: 3, background: "#356452" },
        })
          .png()
          .toBuffer();
        const file = {
          buffer: image,
          size: image.length,
          mimetype: "image/png",
        };
        await assert.rejects(
          normalizePhoto({
            buffer: Buffer.from("<svg></svg>"),
            size: 11,
            mimetype: "image/png",
          }),
        );
        await assert.rejects(
          normalizePhoto({ ...file, size: 6 * 1024 * 1024 }),
        );
        await assert.rejects(photos.upload(undefined, file));
        const clientAccount = await auth.login(
          "role-client@example.test",
          "Pravilna test lozinka!",
        );
        await assert.rejects(photos.upload(clientAccount.token, file));
        const first = await photos.upload(account.token, file);
        const second = await photos.upload(account.token, file);
        assert.equal(first.primary, true);
        assert.equal(second.primary, false);
        assert.equal(
          (await sharp(await photos.read(first.id)).metadata()).format,
          "webp",
        );
        await assert.rejects(photos.change(other.token, first.id, "delete"));
        await assert.rejects(photos.change(other.token, first.id, "primary"));
        await photos.change(account.token, second.id, "primary");
        assert.equal(
          (await auth.getTherapistProfile(account.token)).photos[0].id,
          second.id,
        );
        await photos.change(account.token, second.id, "delete");
        await assert.rejects(photos.read(second.id));
        assert.equal(
          (await auth.getTherapistProfile(account.token)).photos[0].id,
          first.id,
        );
        const parallel = await Promise.allSettled(
          Array.from({ length: 9 }, () => photos.upload(account.token, file)),
        );
        assert.equal(
          parallel.filter((result) => result.status === "fulfilled").length,
          7,
        );
        const profile = await auth.getTherapistProfile(account.token);
        assert.equal(profile.photos.length, 8);
        assert.equal(profile.photos.filter((photo) => photo.primary).length, 1);
        await database.pool.query(
          "UPDATE therapists SET is_active=false WHERE id=$1",
          [profile.id],
        );
        await assert.rejects(photos.read(first.id));
        await database.pool.query(
          "UPDATE therapists SET is_active=true WHERE id=$1",
          [profile.id],
        );
      },
    );

    // Katalog uvodi postojeće profile jednom i čita izmjene isključivo iz baze bez privatnih polja.
    await context.test(
      "directory seed is idempotent, includes registrations and reflects database changes",
      async () => {
        const before = Number(
          (await database.pool.query("SELECT count(*) FROM therapists")).rows[0]
            .count,
        );
        await seedDirectory(database.pool);
        await seedDirectory(database.pool);
        assert.equal(
          Number(
            (await database.pool.query("SELECT count(*) FROM therapists"))
              .rows[0].count,
          ),
          before + 4,
        );
        const directory = new DirectoryService(database);
        const list = await directory.list();
        const ana = list.find((profile) => profile.id === "ana-markovic")!;
        assert.equal(
          ana.services.find((service) => service.id === "ana-individual")!
            .price,
          45,
        );
        assert.equal(ana.availability.length, 5);
        assert.equal("email" in ana, false);
        assert.equal("phone" in ana, false);
        const login = await auth.login("ana.markovic@example.test", "Test123");
        assert.equal(login.user.role, "THERAPIST");
        const own = await auth.getTherapistProfile(login.token);
        assert.equal(own.publicId, "ana-markovic");
        await database.pool.query(
          "UPDATE therapists SET city='Cetinje' WHERE id=$1",
          [own.id],
        );
        assert.equal(
          (await directory.list()).find(
            (profile) => profile.id === "ana-markovic",
          )!.city,
          "Cetinje",
        );
        const registered = (await directory.list()).find(
          (profile) => profile.name === "Ana Test" && profile.city === "Nikšić",
        )!;
        assert.equal(registered.photos!.length, 8);
      },
    );

    // Lični i javni podaci mijenjaju se samo kod vlasnika; oba upisa imaju zajednički ROLLBACK.
    await context.test(
      "personal profile edits persist for both roles and preserve ownership",
      async () => {
        const untouched = (
          await database.pool.query(
            "SELECT * FROM users WHERE email='ana.markovic@example.test'",
          )
        ).rows[0];
        for (const role of ["CLIENT", "THERAPIST"]) {
          const input = registration(
            `personal-${role.toLowerCase()}@example.test`,
          );
          const details =
            role === "THERAPIST"
              ? {
                  title: "Psiholog",
                  biography: "Biografija za test ličnih podataka.",
                  city: "Bar",
                  address: null,
                  phone: "+38267123456",
                  serviceName: "Seansa",
                  durationMinutes: 50,
                  priceEur: 40,
                }
              : undefined;
          const started = await auth.startRegistration(input, details);
          const account = await auth.verifyRegistration(
            started.challengeId,
            delivered.get(input.email)!,
          );
          const before = (
            await database.pool.query("SELECT * FROM users WHERE id=$1", [
              account.user.id,
            ])
          ).rows[0];
          const values = validateAccountProfile({
            firstName: "Milica",
            lastName: "Novo",
            dateOfBirth: "1991-06-15",
            phone: "+38267987654",
            city: "Cetinje",
            address: "Nova ulica 25",
            title: "Psiholog",
            biography: "Nova biografija u zajedničkom formularu.",
            userId: untouched.id,
            role: "ADMIN",
            email: "attacker@example.test",
            isVerified: true,
          });
          await assert.rejects(auth.updateAccountProfile(undefined, values));
          const updated = await auth.updateAccountProfile(
            account.token,
            values,
          );
          assert.equal(updated.firstName, "Milica");
          assert.equal(updated.lastName, "Novo");
          assert.equal(updated.dateOfBirth, "1991-06-15");
          assert.equal(updated.role, role);
          assert.equal(updated.email, input.email);
          assert.equal(updated.phone, values.phone);
          const stored = (
            await database.pool.query("SELECT * FROM users WHERE id=$1", [
              account.user.id,
            ])
          ).rows[0];
          assert.equal(stored.full_name, "Milica Novo");
          assert.equal(stored.password_hash, before.password_hash);
          assert.deepEqual(stored.verified_at, before.verified_at);
          assert.deepEqual(await auth.getAccount(account.token), updated);
          if (role === "THERAPIST") {
            const profile = await auth.getTherapistProfile(account.token);
            assert.equal(profile.name, "Milica Novo");
            assert.equal(profile.city, "Cetinje");
            assert.equal(profile.address, "Nova ulica 25");
            assert.equal(profile.biography, values.biography);
            await assert.rejects(
              auth.updateAccountProfile(account.token, {
                ...values,
                city: null,
              }),
            );
            await assert.rejects(
              auth.updateAccountProfile(account.token, {
                ...values,
                phone: null,
              }),
            );
            assert.equal(profile.verified, false);
            assert.equal(profile.services[0].durationMinutes, 50);
            assert.equal(
              (await new DirectoryService(database).list()).find(
                (item) => item.id === profile.publicId,
              )!.name,
              "Milica Novo",
            );
            await database.pool.query(
              "ALTER TABLE users ADD CONSTRAINT reject_personal_save CHECK (first_name <> 'Rejected')",
            );
            try {
              await assert.rejects(
                auth.updateAccountProfile(account.token, {
                  ...values,
                  firstName: "Rejected",
                }),
              );
              assert.equal(
                (await auth.getAccount(account.token)).firstName,
                "Milica",
              );
              assert.equal(
                (await auth.getTherapistProfile(account.token)).name,
                "Milica Novo",
              );
            } finally {
              await database.pool.query(
                "ALTER TABLE users DROP CONSTRAINT reject_personal_save",
              );
            }
          } else {
            assert.equal(updated.city, "Cetinje");
            assert.equal(updated.address, "Nova ulica 25");
            await auth.updateAccountProfile(account.token, {
              ...values,
              phone: undefined,
            });
            assert.equal(
              (await auth.getAccount(account.token)).phone,
              values.phone,
            );
            await auth.updateAccountProfile(account.token, {
              ...values,
              phone: null,
              city: null,
              address: null,
            });
            assert.equal((await auth.getAccount(account.token)).phone, null);
            assert.equal((await auth.getAccount(account.token)).city, null);
            assert.equal((await auth.getAccount(account.token)).address, null);
          }
          await auth.logout(account.token);
          const signedIn = await auth.login(input.email, input.password);
          assert.equal(signedIn.user.firstName, "Milica");
        }
        assert.deepEqual(
          (
            await database.pool.query("SELECT * FROM users WHERE id=$1", [
              untouched.id,
            ])
          ).rows[0],
          untouched,
        );
      },
    );

    // Paralelni zahtjevi ne mogu preskočiti trajni brojač pokušaja.
    await context.test(
      "database rate limit persists across instances and parallel requests",
      async () => {
        const results = await Promise.allSettled([
          auth.limitAttempts("test-rate", 2, 900),
          auth.limitAttempts("test-rate", 2, 900),
          new AuthService(database, email).limitAttempts("test-rate", 2, 900),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          2,
        );
        await assert.rejects(auth.limitAttempts("test-rate", 2, 900));
      },
    );
  },
);
