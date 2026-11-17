import { AuthRequestError } from "./auth-client";
import type { ProfileAnalytics } from "@terapeut/domain";
export type { ProfileAnalytics } from "@terapeut/domain";

/** Čita privatni izvještaj uz JWT kolačić; prekid zahtjeva štiti od zastarjelog izbora perioda. */
export async function requestAnalytics(
  days: number,
  signal: AbortSignal,
  page: number = 1,
): Promise<ProfileAnalytics> {
  const response = await fetch(`/api/v1/analytics?days=${days}&page=${page}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new AuthRequestError(
      typeof data?.message === "string"
        ? data.message
        : "Analitika trenutno nije dostupna.",
      response.status,
    );
  return data;
}
