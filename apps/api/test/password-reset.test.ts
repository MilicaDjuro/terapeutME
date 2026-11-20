import "../src/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sign } from "jsonwebtoken";
import { Pool } from "pg";
import { DatabaseService } from "../src/database.service";
import { AuthService } from "../src/auth/auth.service";
import { EmailService } from "../src/auth/email.service";
import { PasswordResetService } from "../src/auth/password-reset.service";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
  PASSWORD_RESET_SECONDS,
} from "../src/auth/password-reset.jwt";
import { createSessionToken, verifySessionToken } from "../src/auth/auth.jwt";
import { validatePasswordReset } from "../src/auth/auth.validation";
import {
  hashPassword,
  hashToken,
  verifyPassword,
} from "../src/auth/auth.crypto";

// Potpis i posebna namjena sprečavaju zamjenu sesijskog JWT-a i linka za obnovu.
test("password reset JWTs reject tampering, expiry and session-token substitution", () => {
  const id = randomUUID();
  const reset = createPasswordResetToken(id);
  assert.equal(verifyPasswordResetToken(reset).sub, id);
  assert.notEqual(reset, createPasswordResetToken(id));
  const payload = JSON.parse(
    Buffer.from(reset.split(".")[1], "base64url").toString(),
  );
  assert.equal(payload.exp - payload.iat, PASSWORD_RESET_SECONDS);
  assert.throws(() => verifySessionToken(reset));
  const user = {
    id,
    email: "reset@example.test",
    firstName: "Test",
    lastName: "Test",
    dateOfBirth: null,
    phone: null,
    city: null,
    address: null,
    role: "CLIENT" as const,
  };
  assert.throws(() => verifyPasswordResetToken(createSessionToken(user)));
  for (const changes of [
    { exp: 1 },
    { purpose: "session" },
    { sub: "not-an-id" },
    { jti: "" },
  ]) {
    assert.throws(() =>
      verifyPasswordResetToken(
        sign({ ...payload, ...changes }, process.env.AUTH_SECRET!, {
          algorithm: "HS256",
        }),
      ),
    );
  }
  assert.throws(() =>
    verifyPasswordResetToken(
      sign(payload, "another-secret", { algorithm: "HS256" }),
    ),
  );
  const pieces = reset.split(".");
  pieces[1] = Buffer.from(
    JSON.stringify({ ...payload, sub: randomUUID() }),
  ).toString("base64url");
  assert.throws(() => verifyPasswordResetToken(pieces.join(".")));
});

// Serverska potvrda lozinke važi i kad neko zaobiđe browser formular.
test("password reset validates password length and matching confirmation", () => {
  const password = "Moja nova sigurna lozinka!";
  assert.equal(
    validatePasswordReset({ token: "jwt", password, confirmPassword: password })
      .password,
    password,
  );
  for (const values of [
    { password: "short", confirmPassword: "short" },
    { password, confirmPassword: "Druga duga lozinka!" },
    { password: "a".repeat(129), confirmPassword: "a".repeat(129) },
    { password, confirmPassword: password, token: "" },
  ])
    assert.throws(() => validatePasswordReset({ token: "jwt", ...values }));
});

// Svaki test koristi zasebnu šemu; stvarni korisnici i njihove lozinke ostaju netaknuti.
test(
  "password recovery persists a single-use reset and atomically replaces sessions",
  { skip: !process.env.AUTH_TEST_DATABASE_URL },
  async (context) => {
    const admin = new Pool({
      connectionString: process.env.AUTH_TEST_DATABASE_URL,
    });
    const schemaName = `reset_test_${randomUUID().replaceAll("-", "")}`;
    assert.match(schemaName, /^reset_test_[a-f0-9]{32}$/);
    const url = new URL(process.env.AUTH_TEST_DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schemaName},public`);
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    process.env.DATABASE_URL = url.toString();
    const database = new DatabaseService();
    context.after(async () => {
      await database.pool.end();
      await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await admin.end();
    });
    const root = resolve(__dirname, "../../..");
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
    ]) {
      await database.pool.query(await readFile(resolve(root, file), "utf8"));
    }
    const links = new Map<string, string>();
    let deliveryFails = false;
    const email = {
      mode: "local",
      /** Testni email servis je uključen, ali ne šalje spoljne poruke. */
      assertDeliveryEnabled() {},
      /** Hvata link samo za test; stvarni SMTP i stvarni primaoci se ne koriste. */
      async sendPasswordResetLink(recipient: string, link: string) {
        if (deliveryFails) throw new Error("SMTP unavailable");
        links.set(recipient, link);
      },
    } as unknown as EmailService;
    const auth = new AuthService(database, email);
    const resetService = new PasswordResetService(database, auth, email);
    const oldPassword = "Moja prethodna lozinka!";
    const nextPassword = "Moja obnovljena lozinka!";
    const originalHash = await hashPassword(oldPassword);
    const origin = "http://localhost:3000";
    /** Izdvaja JWT iz fragmenta linka bez pristupa stvarnim emailovima. */
    function tokenFor(address: string) {
      return new URLSearchParams(
        new URL(links.get(address)!).hash.slice(1),
      ).get("token")!;
    }
    for (const role of ["CLIENT", "THERAPIST"]) {
      const address = `${role.toLowerCase()}@example.test`;
      await database.pool.query(
        "INSERT INTO users (email,password_hash,full_name,first_name,last_name,role,verified_at) VALUES ($1,$2,'Test Nalog','Test','Nalog',$3,now())",
        [address, originalHash, role],
      );
      const oldSession = await auth.login(address, oldPassword);
      const first = await resetService.requestReset(address, origin);
      const oldToken = tokenFor(address);
      assert.deepEqual(
        first,
        await resetService.requestReset("missing@example.test", origin),
      );
      assert.equal(links.has("missing@example.test"), false);
      assert.equal(new URL(links.get(address)!).origin, origin);
      assert.equal(new URL(links.get(address)!).search, "");
      const stored = (
        await database.pool.query(
          "SELECT token_hash FROM password_reset_tokens WHERE user_id=$1",
          [oldSession.user.id],
        )
      ).rows[0];
      assert.equal(stored.token_hash, hashToken(oldToken));
      assert.notEqual(stored.token_hash, oldToken);
      await assert.rejects(
        resetService.requestReset(address, "https://untrusted.example"),
      );
      // Nepouzdan origin se odbija prije čuvanja, pa ne poništava korisnikov stvarni link.
      await resetService.requestReset(address, origin);
      const currentToken = tokenFor(address);
      await assert.rejects(resetService.resetPassword(oldToken, nextPassword));
      const outcomes = await Promise.allSettled([
        resetService.resetPassword(currentToken, nextPassword),
        resetService.resetPassword(currentToken, nextPassword),
      ]);
      const accepted = outcomes.find((result) => result.status === "fulfilled");
      assert.ok(accepted && accepted.status === "fulfilled");
      assert.equal(
        outcomes.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(accepted.value.user.role, role);
      assert.equal(
        (await auth.getAccount(accepted.value.token)).email,
        address,
      );
      await assert.rejects(auth.getAccount(oldSession.token));
      await assert.rejects(auth.login(address, oldPassword));
      assert.equal((await auth.login(address, nextPassword)).user.role, role);
      await assert.rejects(
        resetService.resetPassword(currentToken, "Još jedna nova lozinka!"),
      );
      const saved = (
        await database.pool.query(
          "SELECT password_hash FROM users WHERE email=$1",
          [address],
        )
      ).rows[0].password_hash;
      assert.notEqual(saved, nextPassword);
      assert.equal(await verifyPassword(nextPassword, saved), true);
    }
    await context.test(
      "failed session saving rolls back the password, reset link and old sessions",
      async () => {
        const address = "rollback@example.test";
        await database.pool.query(
          "INSERT INTO users (email,password_hash,full_name,first_name,last_name,verified_at) VALUES ($1,$2,'Test','Test','Nalog',now())",
          [address, originalHash],
        );
        const oldSession = await auth.login(address, oldPassword);
        await resetService.requestReset(address, origin);
        const resetToken = tokenFor(address);
        await database.pool.query(
          "ALTER TABLE auth_sessions ADD CONSTRAINT reject_reset_session CHECK (false) NOT VALID",
        );
        try {
          await assert.rejects(
            resetService.resetPassword(resetToken, nextPassword),
          );
          assert.equal(
            (await auth.getAccount(oldSession.token)).email,
            address,
          );
          assert.equal(
            (
              await database.pool.query(
                "SELECT password_hash FROM users WHERE email=$1",
                [address],
              )
            ).rows[0].password_hash,
            originalHash,
          );
        } finally {
          await database.pool.query(
            "ALTER TABLE auth_sessions DROP CONSTRAINT reject_reset_session",
          );
        }
        assert.equal(
          (await resetService.resetPassword(resetToken, nextPassword)).user
            .email,
          address,
        );
      },
    );
    await context.test(
      "expired, suspended, unverified and failed-delivery links cannot reset passwords",
      async () => {
        for (const state of ["expired", "suspended", "unverified", "smtp"]) {
          const address = `${state}@example.test`;
          const inserted = await database.pool.query(
            "INSERT INTO users (email,password_hash,full_name,verified_at) VALUES ($1,$2,'Test',now()) RETURNING id",
            [address, originalHash],
          );
          if (state === "unverified")
            await database.pool.query(
              "UPDATE users SET verified_at=NULL WHERE id=$1",
              [inserted.rows[0].id],
            );
          deliveryFails = state === "smtp";
          await resetService.requestReset(address, origin);
          deliveryFails = false;
          if (state === "unverified" || state === "smtp") {
            assert.equal(links.has(address), false);
          } else {
            if (state === "expired")
              await database.pool.query(
                "UPDATE password_reset_tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1",
                [inserted.rows[0].id],
              );
            if (state === "suspended")
              await database.pool.query(
                "UPDATE users SET suspended_at=now() WHERE id=$1",
                [inserted.rows[0].id],
              );
            await assert.rejects(
              resetService.resetPassword(tokenFor(address), nextPassword),
            );
          }
          assert.equal(
            (
              await database.pool.query(
                "SELECT password_hash FROM users WHERE id=$1",
                [inserted.rows[0].id],
              )
            ).rows[0].password_hash,
            originalHash,
          );
        }
      },
    );
  },
);
