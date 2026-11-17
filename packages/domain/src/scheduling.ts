// Čista pravila dostupnosti: ne koriste React, browser ni bazu i mogu se ponovo koristiti u API-ju.
import {
  Booking,
  BookingStatus,
  DomainError,
  Therapist,
  TimeRange,
} from "./types";
export const TIMEZONE = "Europe/Podgorica";
export const START_INTERVAL = 15;
const BUSY: BookingStatus[] = [
  "REQUESTED",
  "ALTERNATIVE_PROPOSED",
  "CONFIRMED",
  "COMPLETED",
  "NO_SHOW",
];
/** Određuje da li zahtjev zauzima vrijeme, bez obzira na trajanje izabrane seanse. */
export function blocksTime(booking: Pick<Booking, "status">): boolean {
  return BUSY.includes(booking.status);
}
/** Vraća datum YYYY-MM-DD u Crnoj Gori, nezavisno od vremenske zone računara. */
export function dateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}
/** Vraća vrijeme kao broj minuta od ponoći u Crnoj Gori. */
export function localMinute(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return (
    Number(parts.find((p) => p.type === "hour")!.value) * 60 +
    Number(parts.find((p) => p.type === "minute")!.value)
  );
}
/** Provjerava format i postojanje datuma; 2026-02-30 nije ispravan datum. */
export function isDateKey(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}
/** Pomjera kalendarski datum; UTC podne izbjegava pomjeranje datuma zbog promjene sata. */
export function addDays(date: string, count: number): string {
  const nextDate = new Date(`${date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + count);
  return nextDate.toISOString().slice(0, 10);
}
/** Vraća dan u nedjelji: 0 = nedjelja, 1 = ponedjeljak, ... 6 = subota. */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
/** Pretvara broj minuta u vrijeme za prikaz: 975 postaje 16:15. */
export function timeLabel(minute: number): string {
  return `${Math.floor(minute / 60)
    .toString()
    .padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
}
/** Provjerava preklapanje; jedna seansa smije početi tačno kada prethodna završi. */
export function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}
/** Provjerava da li je došao početak termina, radi isticanja zahtjeva i oznake ishoda. */
export function hasStarted(
  booking: Pick<Booking, "date" | "start">,
  now = new Date(),
): boolean {
  return (
    booking.date < dateKey(now) ||
    (booking.date === dateKey(now) && booking.start <= localMinute(now))
  );
}
/** Oduzima zauzete i blokirane intervale iz dostupnosti i vraća slobodne djelove dana. */
export function freeRanges(
  therapist: Therapist,
  date: string,
  bookings: Booking[],
  ignoreBookingId?: string,
): TimeRange[] {
  if (!isDateKey(date) || !therapist.active || !therapist.acceptingClients) {
    return [];
  }

  // 1. Svi zahtjevi ovog terapeuta koriste zajedničku zauzetost, bez obzira na uslugu.
  const busyRanges: TimeRange[] = [];
  for (const booking of bookings) {
    const belongsToDay =
      booking.therapistId === therapist.id && booking.date === date;
    const isBusy = blocksTime(booking);
    // Kod A → B postojeći zahtjev ne smije sam sebe blokirati.
    if (belongsToDay && isBusy && booking.id !== ignoreBookingId) {
      busyRanges.push({ start: booking.start, end: booking.end });
    }
  }
  for (const block of therapist.blocked) {
    if (block.date === date) {
      busyRanges.push({ start: block.start, end: block.end });
    }
  }
  busyRanges.sort((first, second) => first.start - second.start);

  // 2. Konkretan datum zamjenjuje sedmične sate. Ostali datumi i dalje koriste redovan raspored.
  let freeIntervals: TimeRange[] = [];
  const specificDay = therapist.dateAvailability?.find(
    (day) => day.date === date,
  );
  if (specificDay) {
    if (specificDay.working)
      freeIntervals.push({ start: specificDay.start, end: specificDay.end });
  } else {
    for (const window of therapist.availability) {
      if (window.weekday === weekday(date)) {
        freeIntervals.push({ start: window.start, end: window.end });
      }
    }
  }

  // 3. Oduzimamo svaku zauzetost. Primjer: 16–20 minus 17–18 daje 16–17 i 18–20.
  for (const busyRange of busyRanges) {
    const remainingIntervals: TimeRange[] = [];
    for (const interval of freeIntervals) {
      if (!overlaps(interval, busyRange)) {
        remainingIntervals.push(interval);
        continue;
      }
      if (interval.start < busyRange.start) {
        remainingIntervals.push({
          start: interval.start,
          end: busyRange.start,
        });
      }
      if (busyRange.end < interval.end) {
        remainingIntervals.push({ start: busyRange.end, end: interval.end });
      }
    }
    freeIntervals = remainingIntervals;
  }
  return freeIntervals.sort((first, second) => first.start - second.start);
}
/** Nudi početke na 15 minuta unutar slobodnih intervala, samo kada cijela usluga staje. */
export function availableStarts(
  therapist: Therapist,
  date: string,
  duration: number,
  bookings: Booking[],
  now = new Date(),
  ignoreBookingId?: string,
): number[] {
  if (
    !Number.isInteger(duration) ||
    duration <= 0 ||
    !isDateKey(date) ||
    date < dateKey(now)
  )
    return [];
  const starts: number[] = [];
  for (const range of freeRanges(therapist, date, bookings, ignoreBookingId)) {
    for (
      let start = range.start;
      start + duration <= range.end;
      start += START_INTERVAL
    ) {
      // Cijela seansa mora stati; prošli početci se ne nude.
      const isFuture = date !== dateKey(now) || start > localMinute(now);
      if (isFuture && !starts.includes(start)) {
        starts.push(start);
      }
    }
  }
  return starts.sort((first, second) => first - second);
}
/** Ponovo provjerava dostupnost pri slanju ili promjeni; prikazani termin može biti zauzet u međuvremenu. */
export function assertReservable(
  therapist: Therapist,
  date: string,
  start: number,
  duration: number,
  bookings: Booking[],
  now = new Date(),
  ignoreBookingId?: string,
) {
  if (
    !availableStarts(
      therapist,
      date,
      duration,
      bookings,
      now,
      ignoreBookingId,
    ).includes(start)
  )
    throw new DomainError("SLOT_UNAVAILABLE");
}
/** Prije čuvanja odbija neispravna vremena i preklopljene periode dostupnosti istog dana. */
export function validateWindows(windows: Therapist["availability"]): void {
  for (const window of windows) {
    const validDay =
      Number.isInteger(window.weekday) &&
      window.weekday >= 0 &&
      window.weekday <= 6;
    const validTime =
      Number.isInteger(window.start) &&
      Number.isInteger(window.end) &&
      window.start >= 0 &&
      window.end <= 1440 &&
      window.end > window.start;
    if (!validDay || !validTime) {
      throw new DomainError("INVALID_AVAILABILITY");
    }
  }
  for (let firstIndex = 0; firstIndex < windows.length; firstIndex++) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < windows.length;
      secondIndex++
    ) {
      const firstWindow = windows[firstIndex];
      const secondWindow = windows[secondIndex];
      if (
        firstWindow.weekday === secondWindow.weekday &&
        overlaps(firstWindow, secondWindow)
      ) {
        throw new DomainError("OVERLAPPING_AVAILABILITY");
      }
    }
  }
}
