// Pravila promjena zahtjeva. Funkcije vraćaju nove podatke; čuvanje je odgovornost pozivaoca.
import {
  Booking,
  BookingAction,
  BookingEvent,
  BookingStatus,
  DomainError,
  Therapist,
} from "./types";
import {
  assertReservable,
  hasStarted,
  dateKey,
  localMinute,
} from "./scheduling";
export interface RequestInput {
  serviceId: string;
  date: string;
  start: number;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
}
/** Vraća novi zahtjev sa promijenjenim statusom i dodaje događaj istorije, bez izmjene originala. */
function append(
  booking: Booking,
  to: BookingStatus,
  actor: "client" | "therapist" | "system",
  action: string,
  now: Date,
  reason?: string,
): Booking {
  const event: BookingEvent = {
    at: now.toISOString(),
    actor,
    action,
    from: booking.status,
    to,
  };
  if (reason && reason.trim()) {
    event.reason = reason.trim();
  }
  return { ...booking, status: to, events: [...booking.events, event] };
}
/** Provjerava uslugu, kontakt i dostupnost i pravi zahtjev koji odmah zauzima termin. */
export function requestBooking(
  therapist: Therapist,
  input: RequestInput,
  bookings: Booking[],
  now = new Date(),
  id: string = crypto.randomUUID(),
): Booking {
  const service = therapist.services.find(
    (s) => s.id === input.serviceId && s.active,
  );
  if (!service) throw new DomainError("SERVICE_UNAVAILABLE");
  const name = input.clientName.trim();
  const phoneDigits = input.clientPhone.replace(/\D/g, "");
  const validName = name.length > 0 && name.length <= 120;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.clientEmail);
  const validPhone =
    /^[+\d\s()-]+$/.test(input.clientPhone) &&
    phoneDigits.length >= 6 &&
    phoneDigits.length <= 15;
  if (!validName || !validEmail || !validPhone) {
    throw new DomainError("INVALID_CONTACT");
  }
  assertReservable(
    therapist,
    input.date,
    input.start,
    service.duration,
    bookings,
    now,
  );
  return {
    id,
    therapistId: therapist.id,
    serviceId: service.id,
    serviceName: service.name,
    serviceNameEn: service.nameEn,
    online: service.online === true,
    duration: service.duration,
    price: service.price,
    date: input.date,
    start: input.start,
    end: input.start + service.duration,
    clientName: input.clientName.trim(),
    clientEmail: input.clientEmail.trim(),
    clientPhone: input.clientPhone.trim(),
    status: "REQUESTED",
    createdAt: now.toISOString(),
    events: [
      {
        at: now.toISOString(),
        actor: "client",
        action: "REQUEST_CREATED",
        from: null,
        to: "REQUESTED",
      },
    ],
  };
}
/** Obrađuje potvrdu, odbijanje, klijentovo otkazivanje i ispravku ishoda seanse. */
export function respondBooking(
  booking: Booking,
  action: BookingAction,
  now = new Date(),
  reason?: string,
): Booking {
  if (action === "cancel") {
    if (
      !["REQUESTED", "ALTERNATIVE_PROPOSED", "CONFIRMED"].includes(
        booking.status,
      )
    )
      throw new DomainError("INVALID_TRANSITION");
    return append(
      booking,
      "CANCELLED",
      "client",
      "CLIENT_CANCELLED",
      now,
      reason,
    );
  }
  if (action === "complete" || action === "no-show") {
    if (
      !["CONFIRMED", "COMPLETED", "NO_SHOW"].includes(booking.status) ||
      !hasStarted(booking, now)
    )
      throw new DomainError("INVALID_TRANSITION");
    return append(
      booking,
      action === "complete" ? "COMPLETED" : "NO_SHOW",
      "therapist",
      "OUTCOME_UPDATED",
      now,
      reason,
    );
  }
  let expectedStatus: BookingStatus = "REQUESTED";
  let actor: BookingEvent["actor"] = "therapist";
  if (action === "accept-alternative" || action === "reject-alternative") {
    expectedStatus = "ALTERNATIVE_PROPOSED";
    actor = "client";
  }
  if (booking.status !== expectedStatus || hasStarted(booking, now)) {
    throw new DomainError("INVALID_TRANSITION");
  }
  let nextStatus: BookingStatus = "DECLINED";
  if (action === "confirm" || action === "accept-alternative") {
    nextStatus = "CONFIRMED";
  }
  const eventAction = action.toUpperCase().replaceAll("-", "_");
  return append(booking, nextStatus, actor, eventAction, now, reason);
}
/** Otkazuje u ime terapeuta; istorija razlikuje terapeutsko i klijentsko otkazivanje. */
export function cancelByTherapist(
  booking: Booking,
  now = new Date(),
  reason?: string,
): Booking {
  if (
    !["REQUESTED", "ALTERNATIVE_PROPOSED", "CONFIRMED"].includes(booking.status)
  )
    throw new DomainError("INVALID_TRANSITION");
  return append(
    booking,
    "CANCELLED",
    "therapist",
    "THERAPIST_CANCELLED",
    now,
    reason,
  );
}
/** Provjerava B prije izmjene, zatim vraća zahtjev koji oslobađa A i odmah zauzima B. */
export function proposeAlternative(
  booking: Booking,
  therapist: Therapist,
  date: string,
  start: number,
  bookings: Booking[],
  now = new Date(),
): Booking {
  if (
    !(
      ["REQUESTED", "ALTERNATIVE_PROPOSED"].includes(booking.status) ||
      (booking.status === "CONFIRMED" && booking.series)
    ) ||
    booking.therapistId !== therapist.id ||
    hasStarted(booking, now)
  )
    throw new DomainError("INVALID_TRANSITION");
  if (booking.date === date && booking.start === start)
    throw new DomainError("SAME_SLOT");
  assertReservable(
    therapist,
    date,
    start,
    booking.duration,
    bookings,
    now,
    booking.id,
  );
  const next = append(
    booking,
    "ALTERNATIVE_PROPOSED",
    "therapist",
    "ALTERNATIVE_PROPOSED",
    now,
  );
  next.events[next.events.length - 1] = {
    ...next.events[next.events.length - 1],
    previousDate: booking.date,
    previousStart: booking.start,
  };
  return { ...next, date, start, end: start + booking.duration };
}
/** Bilježi zahtjeve bez odgovora pri početku, odvojeno od potvrđene seanse i nedolaska. */
export function expireUnanswered(
  bookings: Booking[],
  now = new Date(),
): Booking[] {
  const result: Booking[] = [];
  for (const booking of bookings) {
    const waiting = ["REQUESTED", "ALTERNATIVE_PROPOSED"].includes(
      booking.status,
    );
    if (!waiting || !hasStarted(booking, now)) {
      result.push(booking);
      continue;
    }
    let expiredStatus: BookingStatus = "EXPIRED_PROVIDER";
    if (booking.status === "ALTERNATIVE_PROPOSED") {
      expiredStatus = "EXPIRED_CLIENT";
    }
    result.push(
      append(booking, expiredStatus, "system", "UNANSWERED_AT_START", now),
    );
  }
  return result;
}

/** Vraća današnje zahtjeve pogodne za podsjetnik nakon 08:00; sama funkcija ne šalje email. */
export function pendingReminders(
  bookings: Booking[],
  now = new Date(),
): Booking[] {
  if (localMinute(now) < 480) {
    return [];
  }
  const today = dateKey(now);
  return bookings.filter(
    (booking) =>
      booking.status === "REQUESTED" &&
      booking.date === today &&
      !hasStarted(booking, now),
  );
}
