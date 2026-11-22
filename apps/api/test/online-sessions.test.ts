import "../src/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { DatabaseService } from "../src/database.service";
import { AuthService } from "../src/auth/auth.service";
import type { AccountUser } from "../src/auth/auth.types";
import { DailyService } from "../src/online-sessions/daily.service";
import { OnlineSessionsService } from "../src/online-sessions/online-sessions.service";
import { configuredVideoProvider } from "../src/config";
import { OnlineLobbyService } from "../src/online-sessions/online-lobby.service";

// Nijedan test ne kontaktira Daily nalog ili stvarnu bazu korisnika.
test("video configuration stays disabled until explicitly configured", () => {
  const previous = process.env.ONLINE_SESSIONS_PROVIDER;
  delete process.env.ONLINE_SESSIONS_PROVIDER;
  assert.equal(configuredVideoProvider(), "disabled");
  process.env.ONLINE_SESSIONS_PROVIDER = "unexpected";
  assert.throws(() => configuredVideoProvider());
  if (previous === undefined) delete process.env.ONLINE_SESSIONS_PROVIDER;
  else process.env.ONLINE_SESSIONS_PROVIDER = previous;
});

test(
  "Daily sessions enforce booking ownership, snapshots, time windows and room revocation",
  { skip: !process.env.AUTH_TEST_DATABASE_URL },
  async (context) => {
    const previousEnvironment = {
      ONLINE_SESSIONS_PROVIDER: process.env.ONLINE_SESSIONS_PROVIDER,
      DAILY_API_KEY: process.env.DAILY_API_KEY,
      DAILY_DOMAIN: process.env.DAILY_DOMAIN,
    };
    process.env.ONLINE_SESSIONS_PROVIDER = "daily";
    process.env.DAILY_API_KEY = "test-only-never-a-real-key";
    process.env.DAILY_DOMAIN = "test-only";
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
      /** Predstavlja već provjerenu JWT sesiju; nepoznat token nema učesnika. */
      async getAccount(token: string) {
        const account = accounts.get(token);
        if (!account) throw new Error("NO_TEST_SESSION");
        return account;
      },
      /** Rate limit je zasebno pokriven stvarnim auth testovima. */
      async limitAttempts() {},
    } as unknown as AuthService;
    const daily = new DailyService();
    const sessions = new OnlineSessionsService(
      database,
      auth,
      daily,
      new OnlineLobbyService(database),
    );
    context.after(async () => {
      await sessions.onModuleDestroy();
      await database.pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
    const root = resolve(__dirname, "../../../db");
    await database.pool.query(
      await readFile(resolve(root, "schema.sql"), "utf8"),
    );
    for (const filename of (await readdir(resolve(root, "migrations")))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort())
      await database.pool.query(
        await readFile(resolve(root, "migrations", filename), "utf8"),
      );

    const roles = [
      "THERAPIST",
      "THERAPIST",
      "CLIENT",
      "CLIENT",
      "ADMIN",
    ] as const;
    const userIds: string[] = [];
    for (const role of roles) {
      const id = randomUUID();
      userIds.push(id);
      await database.pool.query(
        "INSERT INTO users(id,email,password_hash,full_name,role,verified_at) VALUES($1,$2,'unused','Video Test',$3,now())",
        [id, `${id}@example.test`, role],
      );
      accounts.set(id, {
        id,
        role,
        firstName: "Video",
        lastName: "Test",
      } as AccountUser);
    }
    const therapist = (
      await database.pool.query(
        "INSERT INTO therapists(linked_user_id,full_name,title_mne,title_en,city) VALUES($1,'Video Terapeut','Terapeut','Therapist','Podgorica') RETURNING id",
        [userIds[0]],
      )
    ).rows[0].id;
    const service = (
      await database.pool.query(
        "INSERT INTO services(therapist_id,name_mne,name_en,duration_minutes,online) VALUES($1,'Online test','Online test',50,true) RETURNING id",
        [therapist],
      )
    ).rows[0].id;
    const bookingId = (
      await database.pool.query(
        `INSERT INTO booking_requests(client_user_id,therapist_id,service_id,service_name_snapshot,duration_minutes,client_name_snapshot,client_email_snapshot,client_phone_snapshot,start_at,end_at,status,online)
    VALUES($1,$2,$3,'Online test',50,'Video Test','client@example.test','+38267123456',now()+interval '5 minutes',now()+interval '55 minutes','CONFIRMED',true) RETURNING id`,
        [userIds[2], therapist, service],
      )
    ).rows[0].id;

    const requests: {
      path: string;
      method: string;
      body: Record<string, any>;
    }[] = [];
    const rooms = new Map<string, Record<string, unknown>>();
    let failProvider = false;
    let cancelDuringToken = false;
    // Zamjenjuje samo HTTPS transport; sav SQL, autorizacija i konkurencija ostaju stvarni.
    context.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, options?: RequestInit) => {
        const path = String(input).replace("https://api.daily.co/v1/", "");
        const method = options?.method || "GET";
        const body = JSON.parse(String(options?.body || "{}"));
        requests.push({ path, method, body });
        if (failProvider)
          return Response.json(
            { error: "private-provider-response-with-token" },
            { status: 503 },
          );
        if (path === "rooms" && method === "POST") {
          if (rooms.has(body.name)) return Response.json({}, { status: 409 });
          const room = {
            name: body.name,
            privacy: body.privacy,
            config: body.properties,
            url: `https://test-only.daily.co/${body.name}`,
          };
          rooms.set(body.name, room);
          return Response.json(room);
        }
        if (path === "meeting-tokens") {
          if (cancelDuringToken)
            await database.pool.query(
              "UPDATE booking_requests SET status='CANCELLED',state_version=state_version+1 WHERE id=$1",
              [bookingId],
            );
          return Response.json({
            token: "not-a-real-token-just-a-test-credential",
          });
        }
        const roomName = path.split("/")[1];
        if (method === "DELETE") {
          rooms.delete(roomName);
          return Response.json({ deleted: true });
        }
        if (path.endsWith("/eject")) return Response.json({ ejectedIds: [] });
        return rooms.has(roomName)
          ? Response.json(rooms.get(roomName))
          : Response.json({}, { status: 404 });
      },
    );

    const presence = new Map<string, string>();
    let lobbyId = randomUUID();
    /** Svaki video pokušaj nosi stvarnu browser oznaku i trenutno odobreni početak. */
    function join(token: string | undefined, identifier = bookingId) {
      return sessions.join(token, identifier, {
        presenceId: presence.get(token || "") || randomUUID(),
        lobbyId,
      });
    }
    /** Održava dva testna učesnika spremnim bez kontaktiranja video servisa. */
    async function startLobby() {
      const previous = await sessions.info(userIds[0], bookingId);
      for (const index of [2, 0]) {
        const ready =
          index === 0
            ? previous.lobby.therapistReady
            : previous.lobby.clientReady;
        if (!ready || !presence.has(userIds[index]))
          presence.set(userIds[index], randomUUID());
        await sessions.lobbyAction(userIds[index], bookingId, "ready", {
          presenceId: presence.get(userIds[index]),
        });
      }
      const result = await sessions.lobbyAction(
        userIds[0],
        bookingId,
        "start",
        { presenceId: presence.get(userIds[0]) },
      );
      lobbyId = result.lobby.id!;
    }

    await context.test(
      "only the booked client and owning therapist can read preparation or obtain credentials",
      async () => {
        for (const token of [undefined, userIds[1], userIds[3], userIds[4]]) {
          await assert.rejects(sessions.info(token, bookingId));
          await assert.rejects(join(token, bookingId));
        }
        assert.equal(requests.length, 0);
        const info = await sessions.info(userIds[2], bookingId);
        assert.equal(info.canWait, true);
        assert.equal(info.canJoin, false);
        assert.equal("roomUrl" in info, false);
        assert.equal("token" in info, false);
        assert.equal("clientEmail" in info, false);
        await assert.rejects(join(userIds[2], "bad-id' OR TRUE--"));
      },
    );

    await context.test(
      "waiting, previews and readiness never create Daily rooms or tokens; only the therapist starts",
      async () => {
        for (const token of [undefined, userIds[1], userIds[3], userIds[4]])
          await assert.rejects(
            sessions.lobbyAction(token, bookingId, "ready", {
              presenceId: randomUUID(),
            }),
          );
        await assert.rejects(join(userIds[2]), /čekaonicu/);
        const clientPresence = randomUUID();
        presence.set(userIds[2], clientPresence);
        const waiting = await sessions.lobbyAction(
          userIds[2],
          bookingId,
          "ready",
          { presenceId: clientPresence },
        );
        assert.equal(waiting.lobby.clientReady, true);
        assert.equal(waiting.lobby.therapistReady, false);
        assert.equal(waiting.canJoin, false);
        await assert.rejects(
          sessions.lobbyAction(userIds[2], bookingId, "start", {
            presenceId: clientPresence,
          }),
          /pokreće terapeut/,
        );
        await assert.rejects(
          sessions.lobbyAction(userIds[0], bookingId, "start", {
            presenceId: randomUUID(),
          }),
          /oba učesnika/,
        );
        assert.equal(requests.length, 0);
        presence.set(userIds[0], randomUUID());
        const both = await sessions.lobbyAction(
          userIds[0],
          bookingId,
          "ready",
          { presenceId: presence.get(userIds[0]) },
        );
        assert.equal(both.lobby.therapistReady, true);
        assert.equal(both.canJoin, false);
        await assert.rejects(join(userIds[0]), /čekaonicu/);
        await startLobby();
        assert.equal(
          (await sessions.info(userIds[2], bookingId)).canJoin,
          true,
        );
        assert.equal(requests.length, 0);
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*)::int AS count FROM online_session_rooms",
            )
          ).rows[0].count,
          0,
        );
      },
    );

    await context.test(
      "one private two-person room is reused with separate, non-owner room-bound tokens",
      async () => {
        const clientAccess = await join(userIds[2], bookingId);
        const therapistAccess = await join(userIds[0], bookingId);
        assert.equal(clientAccess.roomUrl, therapistAccess.roomUrl);
        assert.equal(rooms.size, 1);
        const properties = requests.find(
          (request) => request.path === "rooms" && request.method === "POST",
        )!.body.properties;
        assert.equal(properties.max_participants, 2);
        assert.equal(properties.enforce_unique_user_ids, true);
        assert.equal(properties.enable_recording, false);
        assert.equal(properties.enable_transcription_storage, false);
        assert.equal(properties.eject_at_room_exp, true);
        const tokens = requests.filter(
          (request) => request.path === "meeting-tokens",
        );
        assert.equal(tokens.length, 2);
        assert.notEqual(
          tokens[0].body.properties.user_id,
          tokens[1].body.properties.user_id,
        );
        assert.equal(
          tokens[0].body.properties.room_name,
          tokens[1].body.properties.room_name,
        );
        for (const request of tokens) {
          assert.equal(request.body.properties.is_owner, false);
          assert.equal(request.body.properties.permissions.canAdmin, false);
          assert.equal(request.body.properties.eject_at_token_exp, true);
          assert.equal(request.body.properties.exp, properties.exp);
          assert.equal(
            JSON.stringify(request.body).includes("@example.test"),
            false,
          );
        }
        const stored = (
          await database.pool.query("SELECT * FROM online_session_rooms")
        ).rows[0];
        assert.equal("token" in stored, false);
        assert.equal("room_url" in stored, false);
        assert.equal(
          (
            await database.pool.query(
              "SELECT count(*)::int AS count FROM online_session_rooms",
            )
          ).rows[0].count,
          1,
        );
      },
    );

    await context.test(
      "parallel joins cannot provision a second room or race room deletion",
      async () => {
        const results = await Promise.allSettled([
          join(userIds[2], bookingId),
          join(userIds[0], bookingId),
        ]);
        assert.ok(results.some((result) => result.status === "fulfilled"));
        for (const result of results)
          if (result.status === "rejected")
            assert.match(String(result.reason), /priprema sobu/);
        assert.equal(rooms.size, 1);
      },
    );

    await context.test(
      "leaving revokes the old call and a delayed heartbeat cannot revive it",
      async () => {
        const oldLobbyId = lobbyId;
        const oldPresence = presence.get(userIds[2]);
        await sessions.lobbyAction(userIds[2], bookingId, "leave", {
          presenceId: oldPresence,
        });
        await sessions.onModuleDestroy();
        await sessions.closeRevokedRooms();
        assert.equal(rooms.size, 0);
        await assert.rejects(join(userIds[2]), /čekaonicu/);
        await assert.rejects(
          sessions.lobbyAction(userIds[2], bookingId, "heartbeat", {
            presenceId: oldPresence,
          }),
          /isteklo/,
        );
        await assert.rejects(
          sessions.lobbyAction(userIds[2], bookingId, "ready", {
            presenceId: oldPresence,
          }),
          /isteklo/,
        );
        await startLobby();
        assert.notEqual(lobbyId, oldLobbyId);
        const before = requests.length;
        await assert.rejects(
          sessions.join(userIds[2], bookingId, {
            presenceId: presence.get(userIds[2]),
            lobbyId: oldLobbyId,
          }),
          /čekaonicu/,
        );
        assert.equal(requests.length, before);
        await join(userIds[2]);
        assert.equal(rooms.size, 1);
      },
    );

    await context.test(
      "stale presence and another browser cannot silently start a paid connection",
      async () => {
        await assert.rejects(
          sessions.lobbyAction(userIds[2], bookingId, "ready", {
            presenceId: randomUUID(),
          }),
          /drugom prozoru/,
        );
        await database.pool.query(
          "UPDATE online_session_lobbies SET client_ready_at=now()-interval '31 seconds' WHERE booking_id=$1",
          [bookingId],
        );
        await assert.rejects(join(userIds[0]), /čekaonicu/);
        assert.equal(
          (await sessions.info(userIds[0], bookingId)).canJoin,
          false,
        );
        await sessions.closeRevokedRooms();
        assert.equal(rooms.size, 0);
        await assert.rejects(
          sessions.lobbyAction(userIds[2], bookingId, "heartbeat", {
            presenceId: presence.get(userIds[2]),
          }),
          /isteklo/,
        );
        await startLobby();
      },
    );

    await context.test(
      "changing the offered service does not convert an existing online booking",
      async () => {
        await database.pool.query(
          "UPDATE services SET online=false WHERE id=$1",
          [service],
        );
        assert.equal((await sessions.info(userIds[2], bookingId)).online, true);
      },
    );

    await context.test(
      "disabled configuration, out-of-window and suspended participants never call the provider",
      async () => {
        const previousCount = requests.length;
        process.env.ONLINE_SESSIONS_PROVIDER = "disabled";
        assert.equal(
          (await sessions.info(userIds[2], bookingId)).configured,
          false,
        );
        await assert.rejects(join(userIds[2], bookingId), /nijesu uključeni/);
        process.env.ONLINE_SESSIONS_PROVIDER = "daily";
        await database.pool.query(
          "UPDATE users SET suspended_at=now() WHERE id=$1",
          [userIds[0]],
        );
        await assert.rejects(join(userIds[2], bookingId), /nije dostupan/);
        await database.pool.query(
          "UPDATE users SET suspended_at=NULL WHERE id=$1",
          [userIds[0]],
        );
        await database.pool.query(
          "UPDATE booking_requests SET start_at=start_at+interval '1 day',end_at=end_at+interval '1 day',state_version=state_version+1 WHERE id=$1",
          [bookingId],
        );
        await assert.rejects(join(userIds[2], bookingId), /10 minuta prije/);
        assert.equal(requests.length, previousCount);
        await sessions.closeRevokedRooms();
        assert.equal(rooms.size, 0);
        const eject = requests.find((request) =>
          request.path.endsWith("/eject"),
        )!;
        assert.equal(eject.body.ban, true);
        assert.equal(eject.body.user_ids.length, 2);
        await database.pool.query(
          "UPDATE booking_requests SET start_at=start_at-interval '1 day',end_at=end_at-interval '1 day',state_version=state_version+1 WHERE id=$1",
          [bookingId],
        );
      },
    );

    await context.test(
      "provider failure is redacted and retry does not create a different room",
      async () => {
        await startLobby();
        failProvider = true;
        await assert.rejects(
          join(userIds[2], bookingId),
          (failure: Error) =>
            !failure.message.includes("private-provider-response") &&
            /Priprema video/.test(failure.message),
        );
        failProvider = false;
        await join(userIds[2], bookingId);
        assert.equal(rooms.size, 1);
      },
    );

    await context.test(
      "a cancellation committed during token issuance prevents release of the token and queues ejection",
      async () => {
        cancelDuringToken = true;
        await assert.rejects(
          join(userIds[2], bookingId),
          /Termin je promijenjen/,
        );
        // Sazvano čišćenje iz join-a završava prije eksplicitne naredne provjere.
        await sessions.onModuleDestroy();
        await sessions.closeRevokedRooms();
        assert.equal(rooms.size, 0);
        await assert.rejects(join(userIds[2], bookingId), /potvrđen termin/);
        const openRooms = await database.pool.query(
          "SELECT id FROM online_session_rooms WHERE closed_at IS NULL",
        );
        assert.equal(openRooms.rowCount, 0);
      },
    );
  },
);
