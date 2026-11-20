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
  assert.throws(validateConfiguration, /AUTH_EMAIL_MODE/);
  process.env.AUTH_EMAIL_MODE = "smtp";
  delete process.env.SMTP_PASS;
  assert.throws(validateConfiguration, /SMTP/);
});

test("Render Free se pokreće sa izričito isključenim emailom, bez SMTP i Resend tajni", () => {
  process.env.AUTH_EMAIL_MODE = "disabled";
  for (const name of [
    "SMTP_HOST",
    "SMTP_FROM",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "RESEND_API_KEY",
    "RESEND_FROM",
  ]) {
    delete process.env[name];
  }
  validateConfiguration();
  process.env.AUTH_EMAIL_MODE = "resend";
  assert.throws(validateConfiguration, /RESEND/);
});

test("Resend HTTPS zahtijeva samo vlastiti ključ i pošiljaoca", () => {
  process.env.AUTH_EMAIL_MODE = "resend";
  process.env.RESEND_API_KEY = "re_configuration_test_only";
  process.env.RESEND_FROM = "Terapeut.me <noreply@example.invalid>";
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  validateConfiguration();
  delete process.env.RESEND_FROM;
  assert.throws(validateConfiguration, /RESEND_FROM/);
  process.env.AUTH_EMAIL_MODE = "resned";
  assert.throws(validateConfiguration, /AUTH_EMAIL_MODE/);
});

test("SES traži region, ograničene AWS ključeve, pošiljaoca i sanduče za povratne poruke", () => {
  process.env.AUTH_EMAIL_MODE = "ses";
  const settings = {
    AWS_REGION: "eu-central-1",
    AWS_ACCESS_KEY_ID: "test-access-key",
    AWS_SECRET_ACCESS_KEY: "test-secret-key",
    SES_FROM: "Terapeut.me <obavjestenja@mail.example.invalid>",
    SES_FEEDBACK_EMAIL: "operator@example.invalid",
  };
  Object.assign(process.env, settings);
  for (const name of [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_FROM",
    "SMTP_USER",
    "SMTP_PASS",
    "RESEND_API_KEY",
    "RESEND_FROM",
  ])
    delete process.env[name];
  validateConfiguration();
  for (const [name, value] of Object.entries(settings)) {
    delete process.env[name];
    assert.throws(validateConfiguration, new RegExp(name));
    process.env[name] = value;
  }
  process.env.AWS_REGION = "https://example.invalid";
  assert.throws(validateConfiguration, /AWS_REGION/);
  process.env.AWS_REGION = settings.AWS_REGION;
  process.env.SES_FEEDBACK_EMAIL = "not-an-email";
  assert.throws(validateConfiguration, /SES_FEEDBACK_EMAIL/);
});
