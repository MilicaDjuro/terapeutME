import type { Booking, Therapist } from "@terapeut/domain";
import { AuthRequestError } from "./auth-client";

export interface ServerBooking extends Booking {
  therapistName: string;
}
export interface ServerSlot {
  start: number;
  end: number;
  available: boolean;
}
export interface BookingResponse {
  waitlist?: WaitlistEntry[];
  waitlistEntry?: WaitlistEntry;
  series?: RecurringSeries[];
  notice?: "window-already-exists";
  therapist?: Therapist;
  slots?: ServerSlot[];
  dayOff?: boolean;
  booking?: Booking;
  bookings?: ServerBooking[];
}

export interface WaitlistEntry {
  id: string;
  status: "WAITING" | "ASSIGNED" | "CANCELLED" | "EXPIRED" | "UNAVAILABLE";
  exact: boolean;
  weekdays: number[];
  firstDate: string;
  lastDate: string;
  start: number;
  end: number;
  duration: number;
  price: number | null;
  serviceName: string;
  therapistName: string;
  clientName: string;
  bookingId: string | null;
  createdAt: string;
}

export interface RecurringSeries {
  id: string;
  intervalDays: number;
  active: boolean;
  firstDate: string;
  nextDate: string;
  start: number;
  duration: number;
  clientName: string;
  therapistName: string;
  issues: { date: string; reason: string }[];
}

// Rezultat formulara sadrži poruku za konkretan unos, čak i kada je pri dnu rasporeda.
export interface ScheduleSaveResult {
  saved: boolean;
  message: string;
}

/** Poziva API sa JWT kolačićem; rezervacije i raspored se ne upisuju u localStorage. */
export async function requestBookingApi(
  path: string,
  body?: Record<string, string>,
  signal?: AbortSignal,
): Promise<BookingResponse> {
  const response = await fetch(`/api/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new AuthRequestError(
      typeof data?.message === "string"
        ? data.message
        : "Podaci trenutno nijesu dostupni.",
      response.status,
    );
  return data;
}
