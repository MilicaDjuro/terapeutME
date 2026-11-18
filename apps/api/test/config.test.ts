import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedOrigins,
  apiListenAddress,
  validateConfiguration,
} from "../src/config";

let originalEnvironment: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnvironment = { ...process.env };
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgresql://example.invalid/terapeut";
  process.env.AUTH_SECRET =
    "configuration-test-secret-with-at-least-32-characters";
  process.env.AUTH_EMAIL_MODE = "smtp";
  process.env.SMTP_HOST = "smtp.example.invalid";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_FROM = "Terapeut.me <noreply@example.invalid>";
  process.env.SMTP_USER = "test-user";
  process.env.SMTP_PASS = "test-password";
  process.env.WEB_ORIGINS = "https://terapeut.example.invalid";
  delete process.env.PORT;
  delete process.env.API_PORT;
  delete process.env.API_HOST;
});

afterEach(() => {
  process.env = originalEnvironment;
});

test("Render PORT ima prednost i produkcija sluša na svim interfejsima", () => {
  process.env.PORT = "10000";
  process.env.API_PORT = "4000";
  validateConfiguration();
  assert.deepEqual(apiListenAddress(), { host: "0.0.0.0", port: 10000 });
});

test("lokalni API zadržava vlastiti port i lokalnu adresu", () => {
  process.env.NODE_ENV = "development";
  assert.deepEqual(apiListenAddress(), { host: "127.0.0.1", port: 4000 });
  process.env.API_PORT = "4100";
  assert.deepEqual(apiListenAddress(), { host: "127.0.0.1", port: 4100 });
  process.env.API_HOST = "0.0.0.0";
  assert.equal(apiListenAddress().host, "0.0.0.0");
});

test("neispravan serverski ili SMTP port prekida pokretanje", () => {
  for (const port of ["0", "65536", "4000.5", "not-a-port"]) {
    process.env.PORT = port;
    assert.throws(validateConfiguration, /API port/);
  }
  delete process.env.PORT;
  for (const port of ["0", "65536", "465.5", "not-a-port"]) {
    process.env.SMTP_PORT = port;
    assert.throws(validateConfiguration, /SMTP_PORT/);
  }
});

test("produkcija odbija nedostajuće i neispravne frontend origine", () => {
  for (const origin of [
    "",
    "http://localhost:3000",
    "https://",
    "https://terapeut.example.invalid/",
    "https://terapeut.example.invalid/login",
    "https://user:password@terapeut.example.invalid",
    "https://terapeut.example.invalid?preview=true",
    "https://terapeut.example.invalid,",
  ]) {
    process.env.WEB_ORIGINS = origin;
    assert.throws(validateConfiguration, /WEB_ORIGINS/);
  }
  delete process.env.WEB_ORIGINS;
  assert.throws(validateConfiguration, /WEB_ORIGINS/);
});

test("produkcija dozvoljava samo navedene HTTPS domene i stvarni email servis", () => {
  process.env.WEB_ORIGINS =
    "https://terapeut.example.invalid, https://www.terapeut.example.invalid";
  validateConfiguration();
  assert.deepEqual(allowedOrigins(), [
    "https://terapeut.example.invalid",
    "https://www.terapeut.example.invalid",
  ]);
  process.env.AUTH_EMAIL_MODE = "local";
  assert.throws(validateConfiguration, /SMTP/);
  process.env.AUTH_EMAIL_MODE = "smtp";
  delete process.env.SMTP_PASS;
  assert.throws(validateConfiguration, /SMTP/);
});
