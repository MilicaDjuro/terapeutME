import "../src/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { sign } from "jsonwebtoken";
import {
  createSessionToken,
  verifySessionToken,
  SESSION_SECONDS,
} from "../src/auth/auth.jwt";

// Prijave u istoj sekundi moraju dobiti različite tokene, sa ograničenim rokom i serverskom ulogom.
test("JWT sessions contain the identity, role, expiration and unique session ID", () => {
  const user = {
    id: randomUUID(),
    email: "jwt@example.test",
    firstName: "Ana",
    lastName: "Test",
    dateOfBirth: null,
    role: "THERAPIST" as const,
  };
  const first = createSessionToken(user);
  const second = createSessionToken(user);
  const claims = verifySessionToken(first);
  assert.equal(claims.sub, user.id);
  assert.equal(claims.role, "THERAPIST");
  assert.notEqual(first, second);
  assert.notEqual(claims.jti, verifySessionToken(second).jti);
  assert.ok(claims.exp <= Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  assert.ok(claims.exp > Math.floor(Date.now() / 1000) + SESSION_SECONDS - 10);
  assert.equal(first.includes(user.email), false);
});

// Samo dekodiranje nije provjera: potpis, namjena, algoritam i rok moraju svi odgovarati.
test("JWT verification rejects forged, expired and incorrectly scoped tokens", () => {
  const payload = {
    sub: randomUUID(),
    jti: randomUUID(),
    role: "CLIENT",
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const options = {
    algorithm: "HS256" as const,
    issuer: "terapeut.me-api",
    audience: "terapeut.me-web",
  };
  const secret = process.env.AUTH_SECRET!;
  const valid = sign(payload, secret, options);
  const parts = valid.split(".");
  parts[1] = Buffer.from(
    JSON.stringify({ ...payload, role: "ADMIN" }),
  ).toString("base64url");
  assert.throws(() => verifySessionToken(parts.join(".")));
  assert.throws(() =>
    verifySessionToken(sign(payload, "different-secret", options)),
  );
  assert.throws(() =>
    verifySessionToken(sign({ ...payload, exp: 1 }, secret, options)),
  );
  assert.throws(() =>
    verifySessionToken(
      sign(payload, secret, { ...options, algorithm: "HS512" }),
    ),
  );
  assert.throws(() =>
    verifySessionToken(
      sign(payload, secret, { ...options, issuer: "other-api" }),
    ),
  );
  assert.throws(() =>
    verifySessionToken(
      sign(payload, secret, { ...options, audience: "other-site" }),
    ),
  );
  assert.throws(() =>
    verifySessionToken(sign({ ...payload, role: "UNKNOWN" }, secret, options)),
  );
  assert.throws(() =>
    verifySessionToken(
      sign(
        { sub: payload.sub, jti: payload.jti, role: payload.role },
        secret,
        options,
      ),
    ),
  );
  assert.throws(() => verifySessionToken(undefined));
  assert.throws(() => verifySessionToken("a".repeat(2049)));
});
