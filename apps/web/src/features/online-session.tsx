"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Headphones,
  LockKeyhole,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ShieldCheck,
  Video,
  VideoOff,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { authErrorMessage } from "@/lib/auth-client";
import {
  requestOnlineSession,
  type OnlineSessionInfo,
} from "@/lib/online-session-client";
import {
  createVideoConnection,
  type VideoConnection,
  type VideoParticipant,
  type VideoStatus,
} from "@/lib/video-connection";
import { ActionButton, PendingStatus } from "@/components/ui";
import { SessionMedia } from "@/components/session-media";
import { Brand } from "@/components/shell";
import "./online-session.css";

/** Prikazuje pripremu i privatni razgovor; token, soba i mediji se ne čuvaju u localStorage. */
export function OnlineSession({ bookingId }: { bookingId: string }) {
  const { user, loading: authLoading } = useAuth();
  const { translate } = useDemo();
  const [information, setInformation] = useState<OnlineSessionInfo | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [status, setStatus] = useState<VideoStatus | "preparing">("preparing");
  const [participants, setParticipants] = useState<VideoParticipant[]>([]);
  const [preview, setPreview] = useState<VideoParticipant | null>(null);
  const [microphone, setMicrophone] = useState(true);
  const [camera, setCamera] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [mediaPending, setMediaPending] = useState(false);
  const [reload, setReload] = useState(0);
  const connection = useRef<VideoConnection | null>(null);
  const closingConnection = useRef<Promise<void> | null>(null);
  const previewStream = useRef<MediaStream | null>(null);
  const operation = useRef(0);
  const joinRequest = useRef<AbortController | null>(null);
  const mediaOperation = useRef(0);
  const joining = useRef(false);
  const active =
    status === "connected" || status === "reconnecting" || status === "joining";
  const backUrl = user?.role === "THERAPIST" ? "/dashboard" : "/account";
  const local = participants.find((participant) => participant.local);
  const remote = participants.find((participant) => !participant.local);
  const screen = participants.find((participant) => participant.screenVideo);

  /** Zaustavlja samo naš lokalni pregled; stvarnim pozivom i njegovim trakama upravlja adapter. */
  function stopPreview() {
    mediaOperation.current += 1;
    for (const track of previewStream.current?.getTracks() || []) track.stop();
    previewStream.current = null;
  }

  /** Novi ulazak čeka završeno gašenje prethodnog SDK-a, da kamera ne ostane u dvije instance. */
  function closeConnection() {
    const previous = connection.current;
    connection.current = null;
    if (previous) closingConnection.current = previous.close();
    return closingConnection.current;
  }

  // Identitet/rezervacija određuju lifecycle. Odjava ili navigacija gase kameru i stari asinhroni ulazak.
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setInformation(null);
    setError("");
    setLoading(true);
    setParticipants([]);
    setPreview(null);
    setStatus("preparing");
    /** Periodično čita dozvole; otkazivanje, odjava i istek zatvaraju i već otvoreni ekran poziva. */
    async function loadInformation() {
      if (!user) {
        if (!authLoading) setLoading(false);
        return;
      }
      try {
        const result = await requestOnlineSession(
          bookingId,
          false,
          controller.signal,
        );
        if (disposed) return;
        setInformation(result);
        setError("");
        if (!result.canJoin && connection.current) {
          operation.current += 1;
          joinRequest.current?.abort();
          joining.current = false;
          void closeConnection();
          setParticipants([]);
          setStatus("left");
        }
      } catch (failure) {
        if (!disposed) {
          setError(authErrorMessage(failure));
          // Ne zadržavamo kameru u privatnoj sesiji ako server više ne potvrđuje pristup.
          if (connection.current) {
            operation.current += 1;
            joinRequest.current?.abort();
            joining.current = false;
            void closeConnection();
            setStatus("left");
            setParticipants([]);
          }
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void loadInformation();
    const timer = setInterval(() => {
      void loadInformation();
    }, 15000);
    /** Uklanja timer, prekida mrežu i gasi medije čak i dok traje zahtjev za browser dozvolu. */
    function cleanupSession() {
      disposed = true;
      controller.abort();
      clearInterval(timer);
      operation.current += 1;
      joinRequest.current?.abort();
      joining.current = false;
      stopPreview();
      void closeConnection();
    }
    return cleanupSession;
  }, [bookingId, user?.id, authLoading, reload]);

  /** Traži browser dozvolu tek na klik; pregled se ne šalje terapeutu niti Daily-ju. */
  async function handlePreview() {
    if (mediaPending || active) return;
    stopPreview();
    setPreview(null);
    setMediaError("");
    if (!microphone && !camera) return;
    const current = mediaOperation.current;
    setMediaPending(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("MEDIA_UNAVAILABLE");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: microphone
          ? microphoneId
            ? { deviceId: { exact: microphoneId } }
            : true
          : false,
        video: camera
          ? cameraId
            ? { deviceId: { exact: cameraId } }
            : { facingMode: "user" }
          : false,
      });
      if (current !== mediaOperation.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      previewStream.current = stream;
      setPreview({
        id: "preview",
        local: true,
        video: stream.getVideoTracks()[0] || null,
        audio: null,
        screenVideo: null,
        screenAudio: null,
        microphoneOn: microphone,
        cameraOn: camera,
      });
      const availableDevices = await navigator.mediaDevices.enumerateDevices();
      if (current === mediaOperation.current) setDevices(availableDevices);
    } catch {
      if (current === mediaOperation.current)
        setMediaError(
          translate(
            "Kamera ili mikrofon nijesu dostupni. Dozvolite pristup u browseru, zatvorite druge pozive i pokušajte ponovo. Možete isključiti kameru i koristiti samo zvuk.",
            "Camera or microphone unavailable. Check browser permissions, close other calls and try again. You can turn off the camera and use audio only.",
          ),
        );
    } finally {
      if (current === mediaOperation.current) setMediaPending(false);
    }
  }

  /** Traži serverski pristup i povezuje poziv; zakašnjeli odgovor poslije izlaska odmah se odbacuje. */
  async function handleJoin() {
    if (joining.current || connection.current || !information?.canJoin) return;
    joining.current = true;
    const current = ++operation.current;
    const controller = new AbortController();
    joinRequest.current = controller;
    stopPreview();
    setPreview(null);
    setMediaPending(false);
    setError("");
    setMediaError("");
    setStatus("joining");
    let opened: VideoConnection | null = null;
    try {
      await closingConnection.current;
      if (current !== operation.current) return;
      const credentials = await requestOnlineSession(
        bookingId,
        true,
        controller.signal,
      );
      if (current !== operation.current) return;
      opened = await createVideoConnection(
        {
          participants: (people) => {
            if (current === operation.current) setParticipants(people);
          },
          status: (nextStatus) => {
            if (current === operation.current) {
              setStatus(nextStatus);
              if (nextStatus === "left") {
                joining.current = false;
                void closeConnection();
                setParticipants([]);
              }
            }
          },
          error: (message) => {
            if (current === operation.current) setMediaError(message);
          },
        },
        controller.signal,
      );
      if (current !== operation.current) {
        await opened.close();
        return;
      }
      connection.current = opened;
      await opened.join(
        credentials,
        { microphoneId, cameraId },
        microphone,
        camera,
      );
    } catch (failure) {
      await opened?.close();
      if (current === operation.current) {
        connection.current = null;
        setStatus("preparing");
        setParticipants([]);
        setError(authErrorMessage(failure));
      }
    } finally {
      if (current === operation.current) joining.current = false;
    }
  }

  /** Koči dvostruki ulazak i oslobađa kameru; izlazak ne mijenja ishod terapeutske rezervacije. */
  async function handleLeave() {
    operation.current += 1;
    joining.current = false;
    joinRequest.current?.abort();
    stopPreview();
    setPreview(null);
    setMediaPending(false);
    setParticipants([]);
    setStatus("left");
    await closeConnection();
  }

  /** Gasi/uključuje naš mikrofon u pregledu i pozivu; tuđi zvuk se ne mijenja. */
  function handleMicrophone() {
    const enabled = local ? !local.microphoneOn : !microphone;
    try {
      connection.current?.microphone(enabled);
      if (
        previewStream.current &&
        enabled &&
        !previewStream.current.getAudioTracks().length
      ) {
        stopPreview();
        setPreview(null);
        setMediaPending(false);
        setMicrophone(enabled);
        return;
      }
      for (const track of previewStream.current?.getAudioTracks() || [])
        track.enabled = enabled;
      setMicrophone(enabled);
      if (preview) setPreview({ ...preview, microphoneOn: enabled });
    } catch {
      setMediaError("Promjena mikrofona nije uspjela. Pokušajte ponovo.");
    }
  }

  /** Isključivanje kamere zadržava zvuk i vezu, bez automatskog izlaska iz seanse. */
  function handleCamera() {
    const enabled = local ? !local.cameraOn : !camera;
    try {
      connection.current?.camera(enabled);
      if (
        previewStream.current &&
        enabled &&
        !previewStream.current.getVideoTracks().length
      ) {
        stopPreview();
        setPreview(null);
        setMediaPending(false);
        setCamera(enabled);
        return;
      }
      for (const track of previewStream.current?.getVideoTracks() || [])
        track.enabled = enabled;
      setCamera(enabled);
      if (preview)
        setPreview({
          ...preview,
          video: enabled
            ? previewStream.current?.getVideoTracks()[0] || null
            : null,
          cameraOn: enabled,
        });
    } catch {
      setMediaError("Promjena kamere nije uspjela. Pokušajte ponovo.");
    }
  }

  /** Promjena uređaja tokom poziva ide preko adaptera; prije poziva traži novi lokalni pregled. */
  async function handleDeviceChange(
    kind: "microphone" | "camera",
    value: string,
  ) {
    if (kind === "microphone") setMicrophoneId(value);
    else setCameraId(value);
    setMediaError("");
    if (!connection.current) {
      stopPreview();
      setPreview(null);
      setMediaPending(false);
      return;
    }
    try {
      await connection.current.devices({
        microphoneId: kind === "microphone" ? value : microphoneId,
        cameraId: kind === "camera" ? value : cameraId,
      });
    } catch {
      setMediaError("Izabrani uređaj nije dostupan. Izaberite drugi uređaj.");
    }
  }

  /** Browser sam traži saglasnost i izbor ekrana; prekid dijeljenja ne prekida poziv. */
  function handleScreen() {
    try {
      connection.current?.screen(!local?.screenVideo);
    } catch {
      setMediaError("Dijeljenje ekrana nije dostupno u ovom browseru.");
    }
  }

  if (authLoading || loading)
    return (
      <div className="page-container session-loading">
        <PendingStatus>
          {translate("Priprema seanse…", "Preparing your session…")}
        </PendingStatus>
      </div>
    );
  if (!user)
    return (
      <div className="page-container session-loading">
        <h1>{translate("Online seansa", "Online session")}</h1>
        <p>
          {translate(
            "Prijavite se nalogom na kojem je rezervacija.",
            "Sign in with the account used for this booking.",
          )}
        </p>
        <Link href="/login" className="button button-primary">
          {translate("Prijavi se", "Sign in")}
        </Link>
      </div>
    );
  if (!information)
    return (
      <div className="page-container session-loading">
        <h1>{translate("Online seansa", "Online session")}</h1>
        <p role="alert" className="form-error">
          {error}
        </p>
        <button
          className="button button-outline"
          onClick={() => setReload(reload + 1)}
        >
          {translate("Pokušaj ponovo", "Try again")}
        </button>
        <Link href={backUrl} className="text-link">
          {translate("Moji termini", "My sessions")}
        </Link>
      </div>
    );
  const otherLabel =
    information.role === "CLIENT"
      ? information.therapistName
      : translate("Vaš klijent", "Your client");
  const time = new Intl.DateTimeFormat("sr-Latn-ME", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Podgorica",
  }).format(new Date(information.startAt));
  const statusLabel =
    status === "connected"
      ? translate("U pozivu", "In call")
      : status === "joining"
        ? translate("Povezivanje…", "Connecting…")
        : status === "reconnecting"
          ? translate("Ponovno povezivanje…", "Reconnecting…")
          : translate("Priprema za razgovor", "Prepare for your session");
  return (
    <div className="session-page">
      <div className="session-topbar">
        <Brand />
        <Link href={backUrl} className="text-link">
          <ArrowLeft size={17} />
          {translate("Moji termini", "My sessions")}
        </Link>
        <span>
          <LockKeyhole size={14} />
          {translate("Privatna online seansa", "Private online session")}
        </span>
      </div>
      <header className="session-heading">
        <div>
          <span className="eyebrow">
            {translate("Prostor za vaš razgovor", "Your space to talk")}
          </span>
          <h1>{information.serviceName}</h1>
          <p>
            {information.role === "CLIENT"
              ? information.therapistName
              : translate(
                  "Vaš dogovoreni termin",
                  "Your scheduled session",
                )}{" "}
            · {time} <span className="muted small">(Crna Gora)</span>
          </p>
        </div>
        <span
          className={`session-connection-status${status === "connected" ? " connected" : ""}`}
          role="status"
        >
          {statusLabel}
        </span>
      </header>
      <div
        className={`session-workspace${active ? " session-workspace-active" : ""}`}
      >
        <section
          className="session-stage"
          aria-label={translate("Video poziv", "Video call")}
        >
          {active ? (
            <>
              {screen && (
                <SessionMedia
                  participant={screen}
                  label={translate("Dijeljeni ekran", "Shared screen")}
                  screen
                />
              )}
              {remote ? (
                <SessionMedia participant={remote} label={otherLabel} />
              ) : (
                <div className="session-waiting">
                  <span className="session-waiting-icon">
                    <Headphones size={36} />
                  </span>
                  <h2>
                    {status === "joining"
                      ? translate("Povezujemo vas…", "Connecting you…")
                      : translate(
                          "Čekamo drugog učesnika",
                          "Waiting for the other participant",
                        )}
                  </h2>
                  <p>
                    {translate(
                      "Druga osoba ulazi kroz svoju potvrđenu rezervaciju.",
                      "The other participant joins from their confirmed booking.",
                    )}
                  </p>
                </div>
              )}
              {local && (
                <SessionMedia
                  participant={local}
                  label={translate("Vi", "You")}
                />
              )}
            </>
          ) : preview ? (
            <SessionMedia
              participant={preview}
              label={translate(
                "Vaš pregled — vidljiv samo vama",
                "Your preview — visible only to you",
              )}
            />
          ) : (
            <div className="session-waiting">
              <span className="session-waiting-icon">
                <Camera size={38} />
              </span>
              <h2>
                {status === "left"
                  ? translate("Izašli ste iz poziva", "You left the call")
                  : translate(
                      "Pripremite se za razgovor",
                      "Get ready for your session",
                    )}
              </h2>
              <p>
                {translate(
                  "Provjerite kameru i mikrofon. Lokalni pregled vidite samo vi.",
                  "Check your camera and microphone. Only you can see the local preview.",
                )}
              </p>
            </div>
          )}
          <div className="session-controls">
            <button
              type="button"
              className="session-control"
              disabled={status === "joining" || mediaPending}
              onClick={handleMicrophone}
              aria-pressed={local?.microphoneOn ?? microphone}
              aria-label={translate("Mikrofon", "Microphone")}
            >
              {(local?.microphoneOn ?? microphone) ? (
                <Mic size={21} />
              ) : (
                <MicOff size={21} />
              )}
              <span>{translate("Mikrofon", "Microphone")}</span>
            </button>
            <button
              type="button"
              className="session-control"
              disabled={status === "joining" || mediaPending}
              onClick={handleCamera}
              aria-pressed={local?.cameraOn ?? camera}
              aria-label={translate("Kamera", "Camera")}
            >
              {(local?.cameraOn ?? camera) ? (
                <Video size={21} />
              ) : (
                <VideoOff size={21} />
              )}
              <span>{translate("Kamera", "Camera")}</span>
            </button>
            {active && (
              <>
                <button
                  type="button"
                  className="session-control session-share-control"
                  disabled={status !== "connected"}
                  aria-pressed={!!local?.screenVideo}
                  onClick={handleScreen}
                >
                  <MonitorUp size={21} />
                  <span>{translate("Ekran", "Screen")}</span>
                </button>
                <button
                  type="button"
                  className="session-control session-leave"
                  onClick={handleLeave}
                >
                  <PhoneOff size={21} />
                  <span>{translate("Izađi", "Leave")}</span>
                </button>
              </>
            )}
          </div>
        </section>
        <aside className="session-sidebar">
          <div className="session-checklist">
            <ShieldCheck size={25} />
            <h2>
              {active
                ? translate("Vrijeme za vas", "Time for you")
                : translate("Prije nego počnemo", "Before you begin")}
            </h2>
            <p>
              {translate(
                "Izaberite mirno mjesto i koristite slušalice radi privatnosti i boljeg zvuka.",
                "Choose a quiet place and use headphones for privacy and better sound.",
              )}
            </p>
          </div>
          {!active && (
            <ActionButton
              type="button"
              className="button button-outline"
              pending={mediaPending}
              onClick={handlePreview}
              disabled={!information.online}
              pendingText={translate(
                "Čekamo dozvolu…",
                "Waiting for permission…",
              )}
            >
              {translate(
                "Provjeri kameru i mikrofon",
                "Check camera and microphone",
              )}
            </ActionButton>
          )}
          <label className="field">
            <span>{translate("Mikrofon", "Microphone")}</span>
            <select
              value={microphoneId}
              disabled={status === "joining" || mediaPending}
              onChange={(event) => {
                void handleDeviceChange("microphone", event.target.value);
              }}
            >
              <option value="">
                {translate("Podrazumijevani mikrofon", "Default microphone")}
              </option>
              {devices
                .filter((device) => device.kind === "audioinput")
                .map((device, index) => (
                  <option
                    key={device.deviceId || index}
                    value={device.deviceId}
                  >
                    {device.label || `Mikrofon ${index + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>{translate("Kamera", "Camera")}</span>
            <select
              value={cameraId}
              disabled={status === "joining" || mediaPending}
              onChange={(event) => {
                void handleDeviceChange("camera", event.target.value);
              }}
            >
              <option value="">
                {translate("Podrazumijevana kamera", "Default camera")}
              </option>
              {devices
                .filter((device) => device.kind === "videoinput")
                .map((device, index) => (
                  <option
                    key={device.deviceId || index}
                    value={device.deviceId}
                  >
                    {device.label || `Kamera ${index + 1}`}
                  </option>
                ))}
            </select>
          </label>
          {!active && (
            <ActionButton
              pending={false}
              type="button"
              className="button button-primary session-join"
              disabled={!information.canJoin || mediaPending}
              onClick={handleJoin}
            >
              <Video size={18} />
              {translate("Pridruži se seansi", "Join session")}
            </ActionButton>
          )}
          {!information.canJoin && (
            <p className="session-access-notice" role="status">
              {information.reason}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {mediaError && (
            <p className="form-error" role="alert">
              {mediaError}
            </p>
          )}
          <p className="session-privacy">
            <LockKeyhole size={15} />
            {translate(
              "Pristup imaju samo učesnici potvrđene rezervacije. Aplikacija ne snima razgovor i ne pravi transkript.",
              "Access is restricted to the confirmed booking participants. The app does not record or transcribe your conversation.",
            )}
          </p>
          <p className="muted small">
            {translate(
              "Ulazak: 10 minuta prije termina. Poziv se zatvara 10 minuta nakon zakazanog završetka. Izlazak ne označava seansu kao održanu.",
              "Join 10 minutes before your appointment. The call closes 10 minutes after the scheduled end. Leaving does not mark the session as completed.",
            )}
          </p>
        </aside>
      </div>
    </div>
  );
}
