export interface AccountUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  role: "CLIENT" | "THERAPIST" | "ADMIN";
}

/** Bira početni ekran iz uloge koju je potvrdio API; ne čita demo parametre ni localStorage. */
export function accountHome(user: AccountUser): string {
  if (user.role === "THERAPIST") return "/dashboard";
  if (user.role === "ADMIN") return "/account";
  return "/psychotherapy";
}

export interface TherapistAccountProfile {
  id: string;
  name: string;
  title: string;
  biography: string;
  city: string;
  address: string | null;
  phone: string | null;
  verified: boolean;
  publicId: string;
  photos: { id: string; url: string; primary: boolean }[];
  services: {
    id: string;
    name: string;
    durationMinutes: number;
    priceEur: number | null;
  }[];
}

export type EmailDelivery = "smtp" | "local" | "resend" | "disabled";

export interface AuthResponse {
  user?: AccountUser;
  challengeId?: string;
  delivery?: EmailDelivery;
  resendAfterSeconds?: number;
  therapistProfile?: TherapistAccountProfile;
}

/** Razlikuje neprijavljen nalog od nedostupnog API-ja, bez čuvanja tajni u browseru. */
export class AuthRequestError extends Error {
  /** Čuva HTTP status radi prikaza prijave ili greške konekcije. */
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Poziva auth API preko Next.js proxy-ja; browser sam šalje HttpOnly kolačić. */
export async function requestAuth(
  path: string,
  body?: Record<string, string>,
  signal?: AbortSignal,
): Promise<AuthResponse> {
  const response = await fetch(`/api/v1/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof data?.message === "string"
        ? data.message
        : "Server nije dostupan. Pokušajte ponovo.";
    throw new AuthRequestError(message, response.status);
  }
  return data;
}

/** Daje čitljivu poruku kod serverske ili mrežne greške. */
export function authErrorMessage(error: unknown): string {
  return error instanceof AuthRequestError
    ? error.message
    : "Nije moguće povezati se sa serverom. Pokušajte ponovo.";
}
