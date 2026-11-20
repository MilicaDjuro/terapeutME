import assert from "node:assert/strict";
import { test } from "node:test";
import type { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import {
  attachDailyConnection,
  type VideoParticipant,
  type VideoStatus,
} from "../../web/src/lib/video-connection";

// Adapter se provjerava bez mreže; browser test dodatno provjerava stvarne lokalne MediaStream trake.
test("video adapter maps real participant tracks, controls and lifecycle without leaking SDK errors", async () => {
  const listeners = new Map<string, (event?: unknown) => void>();
  const videoTrack = { id: "local-video" } as MediaStreamTrack;
  const audioTrack = { id: "remote-audio" } as MediaStreamTrack;
  const participant = {
    session_id: "local-session",
    local: true,
    tracks: {
      audio: { state: "off" },
      video: { state: "playable", track: videoTrack },
      screenVideo: {},
      screenAudio: {},
    },
  } as unknown as DailyParticipant;
  let currentParticipants: Record<string, DailyParticipant> = {
    local: participant,
  };
  const actions: { name: string; value?: unknown }[] = [];
  const call = {
    /** Zadržava SDK oblik ulančavanja događaja da test obuhvati iste registracije kao browser. */
    on(name: string, handler: (event?: unknown) => void) {
      listeners.set(name, handler);
      return call;
    },
    /** Vraća trenutno stanje SDK učesnika bez izmišljenog drugog učesnika. */
    participants() {
      return currentParticipants;
    },
    /** Predstavlja već uspostavljenu SDK vezu poslije connected događaja. */
    meetingState() {
      return "joined-meeting";
    },
    /** Pamti privatne argumente samo u ovom testu. */
    async join(value: unknown) {
      actions.push({ name: "join", value });
    },
    /** Bilježi promjenu mikrofona bez mijenjanja drugog učesnika. */
    setLocalAudio(value: unknown) {
      actions.push({ name: "microphone", value });
    },
    /** Bilježi promjenu kamere. */
    setLocalVideo(value: unknown) {
      actions.push({ name: "camera", value });
    },
    /** Bilježi izbor uređaja. */
    async setInputDevicesAsync(value: unknown) {
      actions.push({ name: "devices", value });
    },
    /** Predstavlja korisnički početak dijeljenja. */
    startScreenShare() {
      actions.push({ name: "screen-on" });
    },
    /** Predstavlja korisnički prekid dijeljenja. */
    stopScreenShare() {
      actions.push({ name: "screen-off" });
    },
    /** Predstavlja SDK oslobađanje medija i slušalaca. */
    async destroy() {
      actions.push({ name: "destroy" });
    },
  };
  let people: VideoParticipant[] = [];
  const statuses: VideoStatus[] = [];
  const errors: string[] = [];
  const connection = attachDailyConnection(call as unknown as DailyCall, {
    participants: (value) => {
      people = value;
    },
    status: (value) => statuses.push(value),
    error: (value) => errors.push(value),
  });
  await connection.join(
    {
      provider: "daily",
      roomUrl: "https://test-only.daily.co/test-room",
      token: "test-only-credential",
      expiresAt: "2030-01-01T00:00:00Z",
    },
    { microphoneId: "mic1", cameraId: "cam1" },
    true,
    false,
  );
  assert.deepEqual(actions[0].value, {
    url: "https://test-only.daily.co/test-room",
    token: "test-only-credential",
    audioSource: "mic1",
    videoSource: false,
  });
  assert.deepEqual(statuses, []);
  listeners.get("joined-meeting")!();
  assert.deepEqual(statuses, ["connected"]);
  assert.equal(people.length, 1);
  assert.equal(people[0].video, videoTrack);
  assert.equal(people[0].microphoneOn, false);
  currentParticipants.remote = {
    ...participant,
    local: false,
    session_id: "remote-session",
    tracks: {
      ...participant.tracks,
      audio: { state: "playable", track: audioTrack },
    },
  };
  listeners.get("participant-joined")!();
  assert.equal(people.length, 2);
  assert.equal(people[1].audio, audioTrack);
  delete currentParticipants.remote;
  listeners.get("participant-left")!();
  assert.equal(people.length, 1);
  listeners.get("network-connection")!({ type: "sfu", event: "interrupted" });
  assert.equal(statuses.at(-1), "reconnecting");
  listeners.get("network-connection")!({
    type: "signaling",
    event: "connected",
  });
  assert.equal(statuses.at(-1), "reconnecting");
  listeners.get("network-connection")!({ type: "sfu", event: "connected" });
  assert.equal(statuses.at(-1), "connected");
  listeners.get("error")!({ message: "secret provider URL and token" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].includes("secret"), false);
  connection.microphone(false);
  connection.camera(true);
  await connection.devices({ microphoneId: "mic2", cameraId: "cam2" });
  connection.screen(true);
  connection.screen(false);
  assert.ok(actions.some((action) => action.name === "screen-off"));
  listeners.get("left-meeting")!();
  assert.equal(statuses.at(-1), "left");
  assert.equal(people.length, 0);
  await Promise.all([connection.close(), connection.close()]);
  assert.equal(actions.filter((action) => action.name === "destroy").length, 1);
  const previousCount = statuses.length;
  listeners.get("joined-meeting")!();
  listeners.get("camera-error")!();
  assert.equal(statuses.length, previousCount);
  assert.equal(errors.length, 1);
  await assert.rejects(
    connection.join(
      {
        provider: "daily",
        roomUrl: "unused",
        token: "unused",
        expiresAt: "unused",
      },
      { microphoneId: "", cameraId: "" },
      true,
      true,
    ),
  );
});
