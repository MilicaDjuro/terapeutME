import type {
  TherapistClientNote,
  TherapistNoteClient,
} from "@terapeut/domain";
import { AuthRequestError } from "./auth-client";

interface NotesResponse {
  clients?: TherapistNoteClient[];
  notes?: TherapistClientNote[];
  note?: TherapistClientNote;
  archived?: boolean;
}
interface NoteInput {
  clientUserId: string;
  title: string;
  content: string;
  version?: number;
}

/** Poziva privatni API uz HttpOnly JWT; sadržaj ne upisuje u localStorage ili URL. */
export async function requestTherapistNotes(
  path: string,
  body?: NoteInput | { version: number },
  signal?: AbortSignal,
): Promise<NotesResponse> {
  const response = await fetch(`/api/v1/therapist-notes${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new AuthRequestError(
      typeof data?.message === "string"
        ? data.message
        : "Bilješke trenutno nijesu dostupne.",
      response.status,
    );
  return data;
}
