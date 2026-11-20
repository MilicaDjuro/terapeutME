import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EmailService } from "../src/auth/email.service";
import { AuthService } from "../src/auth/auth.service";
import { PasswordResetService } from "../src/auth/password-reset.service";
import { BookingNotificationService } from "../src/notifications/booking-notification.service";
import type { DatabaseService } from "../src/database.service";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

let originalEnvironment: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnvironment = { ...process.env };
  process.env.AUTH_EMAIL_MODE = "resend";
  process.env.RESEND_API_KEY = "re_test_only_never_sent";
  process.env.RESEND_FROM = "Terapeut.me <noreply@example.invalid>";
});

afterEach(() => {
  process.env = originalEnvironment;
});

test("Resend šalje sve vrste poruka HTTPS-om i čuva stabilan outbox ključ", async (context) => {
  const requests: { address: string; options: RequestInit }[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (address: string, options: RequestInit) => {
      requests.push({ address, options });
      return Response.json({ id: "test-message-id" });
    },
  );
  const email = new EmailService();
  await email.sendRegistrationCode("client@example.invalid", "1234");
  await email.sendPasswordResetLink(
    "client@example.invalid",
    "https://example.invalid/reset-password#token=test",
  );
  await email.sendBookingNotification(
    "client@example.invalid",
    "Potvrda",
    "Testni termin",
    "outbox-test-id",
  );
  await email.sendBookingNotification(
    "client@example.invalid",
    "Potvrda",
    "Testni termin",
    "outbox-test-id",
  );
  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.address, "https://api.resend.com/emails");
    assert.equal(request.options.method, "POST");
    assert.equal(
      request.options.headers &&
        new Headers(request.options.headers).get("Authorization"),
      "Bearer re_test_only_never_sent",
    );
    assert.ok(request.options.signal instanceof AbortSignal);
    const body = JSON.parse(String(request.options.body));
    assert.equal(body.from, process.env.RESEND_FROM);
    assert.deepEqual(body.to, ["client@example.invalid"]);
  }
  assert.match(JSON.parse(String(requests[0].options.body)).text, /1234/);
  assert.match(
    JSON.parse(String(requests[1].options.body)).text,
    /reset-password#token=test/,
  );
  assert.equal(
    new Headers(requests[0].options.headers).get("Idempotency-Key"),
    null,
  );
  assert.equal(
    new Headers(requests[1].options.headers).get("Idempotency-Key"),
    null,
  );
  assert.equal(
    new Headers(requests[2].options.headers).get("Idempotency-Key"),
    "booking/outbox-test-id",
  );
  assert.deepEqual(requests[2].options.body, requests[3].options.body);
  assert.deepEqual(requests[2].options.headers, requests[3].options.headers);
});

test("Resend greške, neispravan odgovor i timeout ne postaju uspjeh niti otkrivaju sadržaj", async (context) => {
  const replies = [
    () =>
      Response.json({ message: "private-provider-details" }, { status: 401 }),
    () =>
      Response.json({ message: "private-provider-details" }, { status: 429 }),
    () =>
      Response.json({ message: "private-provider-details" }, { status: 500 }),
    () => Response.json({}),
    () => Response.json({ id: "" }),
    () => new Response("not-json", { status: 200 }),
    () => {
      throw new Error("private-provider-details");
    },
    () => {
      throw new DOMException("private-provider-details", "TimeoutError");
    },
  ];
  let replyIndex = 0;
  context.mock.method(globalThis, "fetch", async () => replies[replyIndex]());
  const email = new EmailService();
  for (replyIndex = 0; replyIndex < replies.length; replyIndex += 1) {
    await assert.rejects(
      email.sendRegistrationCode("client@example.invalid", "1234"),
      (failure: unknown) => {
        assert.ok(failure instanceof Error);
        assert.ok("code" in failure);
        assert.equal(failure.code, "RESEND_SEND_FAILED");
        assert.equal(
          failure.message.includes("private-provider-details"),
          false,
        );
        assert.equal(failure.message.includes("1234"), false);
        return true;
      },
    );
  }
});

test("disabled ne šalje email, ne čuva registraciju/reset i ne obrađuje outbox", async (context) => {
  process.env.AUTH_EMAIL_MODE = "disabled";
  let databaseCalls = 0;
  let networkCalls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    networkCalls += 1;
    throw new Error("Mreža ne smije biti pozvana.");
  });
  const database = {
    pool: {
      /** Test prekida svaki pokušaj SQL pristupa da disabled režim ne pravi privremene podatke. */
      async query() {
        databaseCalls += 1;
        throw new Error("SQL ne smije biti pozvan.");
      },
      /** Test prekida svaki pokušaj otvaranja transakcije. */
      async connect() {
        databaseCalls += 1;
        throw new Error("SQL ne smije biti pozvan.");
      },
    },
  } as unknown as DatabaseService;
  const email = new EmailService();
  const auth = new AuthService(database, email);
  const reset = new PasswordResetService(database, auth, email);
  await assert.rejects(
    auth.startRegistration({
      firstName: "Test",
      lastName: "Klijent",
      email: "client@example.invalid",
      dateOfBirth: "1990-01-01",
      password: "Testna lozinka 123!",
    }),
    /Slanje emaila još nije uključeno/,
  );
  await assert.rejects(
    auth.resendCode("test-challenge"),
    /Slanje emaila još nije uključeno/,
  );
  await assert.rejects(
    reset.requestReset("client@example.invalid", "https://example.invalid"),
    /Slanje emaila još nije uključeno/,
  );
  await assert.rejects(
    email.sendRegistrationCode("client@example.invalid", "1234"),
    /Slanje emaila još nije uključeno/,
  );
  await assert.rejects(
    email.sendPasswordResetLink(
      "client@example.invalid",
      "https://example.invalid",
    ),
    /Slanje emaila još nije uključeno/,
  );
  await assert.rejects(
    email.sendBookingNotification(
      "client@example.invalid",
      "Test",
      "Test",
      "test-id",
    ),
    /Slanje emaila još nije uključeno/,
  );
  await new BookingNotificationService(database, email).processPending();
  assert.equal(databaseCalls, 0);
  assert.equal(networkCalls, 0);
});

test("SES šalje kod, reset i booking HTTPS komandom sa UTF-8 sadržajem i povratnom adresom", async (context) => {
  process.env.AUTH_EMAIL_MODE = "ses";
  process.env.AWS_REGION = "eu-central-1";
  process.env.AWS_ACCESS_KEY_ID = "test-key-never-sent";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-never-sent";
  process.env.SES_FROM = "Terapeut.me <obavjestenja@mail.example.invalid>";
  process.env.SES_FEEDBACK_EMAIL = "operator@example.invalid";
  process.env.SES_CONFIGURATION_SET = "terapeut-transactional";
  const requests: SendEmailCommand[] = [];
  context.mock.method(
    SESv2Client.prototype,
    "send",
    async function (
      this: SESv2Client,
      command: SendEmailCommand,
      options: { abortSignal: AbortSignal },
    ) {
      requests.push(command);
      assert.ok(options.abortSignal instanceof AbortSignal);
      assert.equal(await this.config.region(), "eu-central-1");
      assert.equal(await this.config.maxAttempts(), 1);
      return { MessageId: "ses-test-message-id" };
    },
  );
  let closed = 0;
  context.mock.method(SESv2Client.prototype, "destroy", () => {
    closed += 1;
  });
  const email = new EmailService();
  await email.sendRegistrationCode("client@example.invalid", "1234");
  await email.sendPasswordResetLink(
    "client@example.invalid",
    "https://example.invalid/reset-password#token=test",
  );
  await email.sendBookingNotification(
    "client@example.invalid",
    "Potvrda",
    "Testni termin",
    "outbox-test-id",
  );
  assert.equal(requests.length, 3);
  for (const command of requests) {
    assert.ok(command instanceof SendEmailCommand);
    assert.equal(command.input.FromEmailAddress, process.env.SES_FROM);
    assert.deepEqual(command.input.Destination?.ToAddresses, [
      "client@example.invalid",
    ]);
    assert.equal(
      command.input.FeedbackForwardingEmailAddress,
      process.env.SES_FEEDBACK_EMAIL,
    );
    assert.equal(command.input.ConfigurationSetName, "terapeut-transactional");
    assert.equal(command.input.Content?.Simple?.Subject?.Charset, "UTF-8");
    assert.equal(command.input.Content?.Simple?.Body?.Text?.Charset, "UTF-8");
  }
  assert.match(requests[0].input.Content!.Simple!.Body!.Text!.Data!, /1234/);
  assert.match(
    requests[1].input.Content!.Simple!.Body!.Text!.Data!,
    /reset-password#token=test/,
  );
  assert.equal(requests[0].input.EmailTags, undefined);
  assert.deepEqual(requests[2].input.EmailTags, [
    { Name: "outbox_id", Value: "outbox-test-id" },
  ]);
  email.onModuleDestroy();
  assert.equal(closed, 1);
});

test("SES odbijanje, timeout ili nedostajući MessageId ostaju neuspjeh bez privatnih detalja", async (context) => {
  process.env.AUTH_EMAIL_MODE = "ses";
  process.env.AWS_REGION = "eu-central-1";
  process.env.AWS_ACCESS_KEY_ID = "test-key-never-sent";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-never-sent";
  process.env.SES_FROM = "sender@example.invalid";
  process.env.SES_FEEDBACK_EMAIL = "operator@example.invalid";
  const replies = [
    () => {
      throw Object.assign(new Error("private-aws-details"), {
        name: "MessageRejected",
      });
    },
    () => {
      throw Object.assign(new Error("private-aws-details"), {
        name: "TooManyRequestsException",
      });
    },
    () => {
      throw new DOMException("private-aws-details", "AbortError");
    },
    () => ({}),
    () => ({ MessageId: "  " }),
  ];
  let replyIndex = 0;
  context.mock.method(SESv2Client.prototype, "send", async () =>
    replies[replyIndex](),
  );
  const email = new EmailService();
  try {
    for (replyIndex = 0; replyIndex < replies.length; replyIndex++) {
      await assert.rejects(
        email.sendRegistrationCode("client@example.invalid", "1234"),
        (failure: unknown) => {
          assert.ok(failure instanceof Error && "code" in failure);
          assert.equal(failure.code, "SES_SEND_FAILED");
          assert.equal(failure.message.includes("private-aws-details"), false);
          assert.equal(failure.message.includes("1234"), false);
          return true;
        },
      );
    }
  } finally {
    email.onModuleDestroy();
  }
});
