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
  reason: string;
}
export interface VideoCredentials {
  provider: "daily";
  roomUrl: string;
  token: string;
  expiresAt: string;
}

/** Čita pripremu ili traži ulazak preko HttpOnly sesije; token ostaje samo u memoriji pozivaoca. */
export async function requestOnlineSession(
  bookingId: string,
  join: false,
  signal?: AbortSignal,
): Promise<OnlineSessionInfo>;
export async function requestOnlineSession(
  bookingId: string,
  join: true,
  signal?: AbortSignal,
): Promise<VideoCredentials>;
export async function requestOnlineSession(
  bookingId: string,
  join: boolean,
  signal?: AbortSignal,
): Promise<OnlineSessionInfo | VideoCredentials> {
  const response = await fetch(
    `/api/v1/bookings/${encodeURIComponent(bookingId)}/online-session${join ? "/join" : ""}`,
    {
      method: join ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: join ? { "Content-Type": "application/json" } : undefined,
      body: join ? "{}" : undefined,
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
