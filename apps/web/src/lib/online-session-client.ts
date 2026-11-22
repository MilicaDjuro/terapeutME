import { AuthRequestError } from "./auth-client";

export interface OnlineSessionInfo {
  bookingId: string;
  serviceName: string;
  therapistName: string;
  role: "CLIENT" | "THERAPIST";
  online: boolean;
  bookingStatus: string;
  startAt: string;
  endAt: string;
  opensAt: string;
  closesAt: string;
  configured: boolean;
  canJoin: boolean;
  canWait: boolean;
  reason: string;
  lobby: {
    id: string | null;
    startedAt: string | null;
    therapistReady: boolean;
    clientReady: boolean;
  };
}
export interface VideoCredentials {
  provider: "daily";
  roomUrl: string;
  token: string;
  expiresAt: string;
}

/** Zajednički HTTP korak za privatnu seansu; tajne ne upisuje u URL ili browser skladište. */
async function sessionRequest(
  bookingId: string,
  suffix: string,
  body?: Record<string, string>,
  signal?: AbortSignal,
  keepalive = false,
) {
  const response = await fetch(
    `/api/v1/bookings/${encodeURIComponent(bookingId)}/online-session${suffix}`,
    {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      keepalive,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new AuthRequestError(
      typeof data?.message === "string"
        ? data.message
        : "Priprema poziva nije uspjela.",
      response.status,
    );
  return data;
}

/** Čita pripremu i našu čekaonicu; samo čitanje nikad ne povezuje Daily. */
export async function requestOnlineSession(
  bookingId: string,
  signal?: AbortSignal,
): Promise<OnlineSessionInfo> {
  return sessionRequest(bookingId, "", undefined, signal);
}

/** Spremnost i početak koriste samo naš API i bazu, bez učesničkih video minuta. */
export async function requestLobbyAction(
  bookingId: string,
  action: "ready" | "heartbeat" | "start",
  presenceId: string,
  signal?: AbortSignal,
): Promise<OnlineSessionInfo> {
  return sessionRequest(bookingId, `/lobby/${action}`, { presenceId }, signal);
}

/** Video token traži tek nakon terapeutovog početka za isti browser i isti razgovor. */
export async function joinOnlineSession(
  bookingId: string,
  presenceId: string,
  lobbyId: string,
  signal?: AbortSignal,
): Promise<VideoCredentials> {
  return sessionRequest(bookingId, "/join", { presenceId, lobbyId }, signal);
}

/** Keepalive omogućava odjavu pri odlasku sa stranice; istek prisustva je rezervni mehanizam. */
export async function leaveOnlineLobby(
  bookingId: string,
  presenceId: string,
): Promise<void> {
  await sessionRequest(
    bookingId,
    "/lobby/leave",
    { presenceId },
    undefined,
    true,
  );
}
