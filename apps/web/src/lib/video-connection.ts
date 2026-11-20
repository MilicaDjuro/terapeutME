import type { VideoCredentials } from "./online-session-client";
import type { DailyCall } from "@daily-co/daily-js";

// UI koristi ove tipove; Daily tipovi i događaji ostaju u jednom adapteru radi buduće zamjene servisa.
export interface VideoParticipant {
  id: string;
  local: boolean;
  video: MediaStreamTrack | null;
  audio: MediaStreamTrack | null;
  screenVideo: MediaStreamTrack | null;
  screenAudio: MediaStreamTrack | null;
  microphoneOn: boolean;
  cameraOn: boolean;
}
export type VideoStatus = "joining" | "connected" | "reconnecting" | "left";
export interface VideoCallbacks {
  participants: (participants: VideoParticipant[]) => void;
  status: (status: VideoStatus) => void;
  error: (message: string) => void;
}
export interface VideoDevices {
  microphoneId: string;
  cameraId: string;
}
export interface VideoConnection {
  join: (
    credentials: VideoCredentials,
    devices: VideoDevices,
    microphone: boolean,
    camera: boolean,
  ) => Promise<void>;
  microphone: (enabled: boolean) => void;
  camera: (enabled: boolean) => void;
  devices: (devices: VideoDevices) => Promise<void>;
  screen: (enabled: boolean) => void;
  close: () => Promise<void>;
}

/** Učitava browser SDK tek pri ulasku; promjena video servisa ne mijenja prikaz seanse. */
export async function createVideoConnection(
  callbacks: VideoCallbacks,
  signal?: AbortSignal,
): Promise<VideoConnection> {
  const Daily = (await import("@daily-co/daily-js")).default;
  if (signal?.aborted)
    throw new DOMException("Ulazak je prekinut.", "AbortError");
  return attachDailyConnection(Daily.createCallObject(), callbacks);
}

/** Prevodi postojeći Daily call object u naše kontrole i događaje; odvojeno se provjerava bez video naloga. */
export function attachDailyConnection(
  call: DailyCall,
  callbacks: VideoCallbacks,
): VideoConnection {
  let closed = false;
  let closing: Promise<void> | null = null;
  const interruptedConnections = new Set<string>();

  /** Prenosi samo trenutno dostupne medijske trake, bez provider identiteta i pristupnih tokena. */
  function updateParticipants() {
    if (closed) return;
    const participants: VideoParticipant[] = [];
    for (const person of Object.values(call.participants())) {
      participants.push({
        id: person.session_id,
        local: person.local,
        video: person.tracks.video.track || null,
        audio: person.tracks.audio.track || null,
        screenVideo: person.tracks.screenVideo.track || null,
        screenAudio: person.tracks.screenAudio.track || null,
        microphoneOn: person.tracks.audio.state === "playable",
        cameraOn: person.tracks.video.state === "playable",
      });
    }
    callbacks.participants(participants);
  }
  /** Potvrđuje vezu tek poslije Daily događaja, a ne poslije izdavanja API tokena. */
  function handleJoined() {
    if (!closed) {
      callbacks.status("connected");
      updateParticipants();
    }
  }
  /** Razlikuje stvarni izlazak od privremenog ponovnog povezivanja. */
  function handleLeft() {
    if (!closed) {
      callbacks.participants([]);
      callbacks.status("left");
    }
  }
  /** Ne prikazuje sirovi SDK odgovor jer može sadržati tehničke podatke sobe. */
  function handleError() {
    if (!closed)
      callbacks.error(
        "Poziv je prekinut ili nije dostupan. Izađite i pokušajte ponovo.",
      );
  }
  /** Blokirana kamera ne prekida zvuk; korisnik može promijeniti browser dozvole i ponoviti ulazak. */
  function handleCameraError() {
    if (!closed)
      callbacks.error(
        "Kamera ili mikrofon nijesu dostupni. Provjerite dozvole browsera i izabrane uređaje.",
      );
  }
  /** Signalizuje gubitak veze dok SDK pokušava ponovno povezivanje. */
  function handleReconnecting() {
    if (!closed) callbacks.status("reconnecting");
  }
  /** Ne proglašava medije povezanim samo zato što se zasebni signalni kanal oporavio. */
  function handleNetworkConnection(event?: { type: string; event: string }) {
    if (!event || closed) return;
    if (event.event === "interrupted") {
      interruptedConnections.add(event.type);
      handleReconnecting();
    }
    if (event.event === "connected") {
      interruptedConnections.delete(event.type);
      if (
        !interruptedConnections.size &&
        call.meetingState() === "joined-meeting"
      )
        handleJoined();
    }
  }
  call
    .on("joined-meeting", handleJoined)
    .on("left-meeting", handleLeft)
    .on("participant-joined", updateParticipants)
    .on("participant-updated", updateParticipants)
    .on("participant-left", updateParticipants)
    .on("track-started", updateParticipants)
    .on("track-stopped", updateParticipants)
    .on("error", handleError)
    .on("camera-error", handleCameraError)
    .on("network-connection", handleNetworkConnection);

  /** Zaustavlja medije i uklanja sve SDK slušaoce čak i kad ulazak još traje. */
  async function close(): Promise<void> {
    if (closing) return closing;
    closed = true;
    closing = call
      .destroy()
      .then(() => undefined)
      .catch(() => undefined);
    return closing;
  }
  /** Ulazi sa privatnim tokenom i izborom uređaja; URL i token ne upisuje u browser istoriju. */
  async function join(
    credentials: VideoCredentials,
    devices: VideoDevices,
    microphone: boolean,
    camera: boolean,
  ) {
    if (closed || credentials.provider !== "daily")
      throw new Error("Poziv nije spreman.");
    await call.join({
      url: credentials.roomUrl,
      token: credentials.token,
      audioSource: microphone ? devices.microphoneId || true : false,
      videoSource: camera ? devices.cameraId || true : false,
    });
  }
  /** Mijenja mikrofon bez ponovnog izdavanja pristupa sobi. */
  function microphone(enabled: boolean) {
    if (!closed) call.setLocalAudio(enabled);
  }
  /** Mijenja kameru; poziv može nastaviti samo sa zvukom. */
  function camera(enabled: boolean) {
    if (!closed) call.setLocalVideo(enabled);
  }
  /** Primjenjuje izbor browser uređaja; dostupnost provjerava SDK. */
  async function devices(selection: VideoDevices) {
    if (!closed)
      await call.setInputDevicesAsync({
        audioDeviceId: selection.microphoneId || null,
        videoDeviceId: selection.cameraId || null,
      });
  }
  /** Dijeli ekran samo poslije korisničkog klika i browser potvrde izbora ekrana. */
  function screen(enabled: boolean) {
    if (!closed) {
      if (enabled) call.startScreenShare();
      else call.stopScreenShare();
    }
  }
  return { join, microphone, camera, devices, screen, close };
}
