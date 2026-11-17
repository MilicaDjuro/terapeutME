// Testovi poslovnih pravila. Datum je fiksiran da rezultat ne zavisi od dana pokretanja.
import { test } from "node:test";
import assert from "node:assert/strict";
import { therapists } from "./seed";
import {
  availableStarts,
  freeRanges,
  overlaps,
  validateWindows,
  dateKey,
  localMinute,
} from "./scheduling";
import {
  requestBooking,
  respondBooking,
  proposeAlternative,
  cancelByTherapist,
  expireUnanswered,
  pendingReminders,
} from "./bookings";
import type { Booking, Therapist } from "./types";
const now = new Date("2026-10-05T08:00:00Z");
const day = "2026-10-06";
/** Pravi nezavisnu kopiju probnog terapeuta da jedan test ne mijenja podatke drugog testa. */
function professional(): Therapist {
  return structuredClone(therapists[0]);
}
const contact = {
  clientName: "Test User",
  clientEmail: "test@example.test",
  clientPhone: "+382 67 123 456",
};
/** Pravi početni zahtjev za domenske testove, sa kontrolisanim datumom i vremenom. */
function booking(t = professional(), start = 960, date = day): Booking {
  return requestBooking(
    t,
    { ...contact, serviceId: "ana-individual", date, start },
    [],
    now,
    "test-booking",
  );
}
test("60-minute services fit completely inside 16–20 availability, with 15-minute starts", () => {
  const starts = availableStarts(professional(), day, 60, [], now);
  assert.equal(starts.length, 13);
  assert.equal(starts[0], 960);
  assert.equal(starts.at(-1), 1140);
});
test("a specific date replaces weekly hours without changing following weeks", () => {
  const therapist = professional();
  therapist.dateAvailability = [
    { id: "date", date: day, working: true, start: 540, end: 720 },
  ];
  const starts = availableStarts(therapist, day, 50, [], now);
  assert.equal(starts[0], 540);
  assert.ok(!starts.includes(960));
  assert.equal(availableStarts(therapist, "2026-10-13", 60, [], now)[0], 960);
});
test("a specific working date can open a closed weekday or mark a whole date closed", () => {
  const therapist = professional();
  therapist.availability = [];
  therapist.dateAvailability = [
    { id: "date", date: day, working: true, start: 540, end: 720 },
  ];
  assert.equal(availableStarts(therapist, day, 40, [], now)[0], 540);
  therapist.dateAvailability[0].working = false;
  assert.deepEqual(availableStarts(therapist, day, 40, [], now), []);
});
test("date hours still subtract bookings and preserve starts immediately after the previous session", () => {
  const therapist = professional();
  therapist.dateAvailability = [
    { id: "date", date: day, working: true, start: 540, end: 720 },
  ];
  const existing = { ...booking(therapist, 540), duration: 50, end: 590 };
  const starts = availableStarts(therapist, day, 40, [existing], now);
  assert.equal(starts[0], 590);
  assert.ok(!starts.includes(570));
});
test("the next free interval starts at 16:15 when an appointment ends at 16:15", () => {
  const t = professional();
  const short = { ...booking(t), start: 960, end: 975, duration: 15 };
  const starts = availableStarts(t, day, 60, [short], now);
  assert.equal(starts[0], 975);
  assert.ok(starts.includes(990));
});
test("a free interval shorter than the selected service offers no appointments", () => {
  const t = professional();
  t.availability = [{ id: "window", weekday: 2, start: 975, end: 1020 }];
  assert.deepEqual(availableStarts(t, day, 60, [], now), []);
});
test("endpoints are adjacent, not overlapping", () => {
  assert.equal(
    overlaps({ start: 960, end: 975 }, { start: 975, end: 1035 }),
    false,
  );
});
test("pending requests block every service of the same therapist", () => {
  const t = professional();
  const pending = booking(t);
  assert.throws(
    () =>
      requestBooking(
        t,
        { ...contact, serviceId: "ana-intro", date: day, start: 975 },
        [pending],
        now,
      ),
    /SLOT_UNAVAILABLE/,
  );
  assert.ok(availableStarts(t, day, 30, [pending], now).includes(1020));
});
test("a second request cannot occupy the same or a partially overlapping interval", () => {
  const t = professional();
  const pending = booking(t);
  for (const start of [960, 975, 990, 1005])
    assert.throws(
      () =>
        requestBooking(
          t,
          { ...contact, serviceId: "ana-individual", date: day, start },
          [pending],
          now,
        ),
      /SLOT_UNAVAILABLE/,
    );
});
test("bookings for a different therapist do not block availability", () => {
  const t = professional();
  const other = { ...booking(t), therapistId: "other" };
  assert.ok(availableStarts(t, day, 60, [other], now).includes(960));
});
test("a cancellation releases the future interval, with an optional reason", () => {
  const t = professional();
  const pending = booking(t);
  const cancelled = respondBooking(pending, "cancel", now);
  assert.equal(cancelled.events.at(-1)?.reason, undefined);
  assert.ok(availableStarts(t, day, 60, [cancelled], now).includes(960));
});
test("declining releases the interval but preserves the original request", () => {
  const t = professional();
  const declined = respondBooking(booking(t), "decline", now);
  assert.equal(declined.status, "DECLINED");
  assert.equal(declined.date, day);
  assert.ok(availableStarts(t, day, 60, [declined], now).includes(960));
});
test("proposing B immediately releases A and holds B", () => {
  const t = professional();
  const original = booking(t);
  const proposed = proposeAlternative(original, t, day, 1080, [original], now);
  const starts = availableStarts(t, day, 60, [proposed], now);
  assert.equal(proposed.status, "ALTERNATIVE_PROPOSED");
  assert.ok(starts.includes(960));
  assert.ok(!starts.includes(1080));
  assert.equal(proposed.events.at(-1)?.previousStart, 960);
  assert.equal(original.start, 960);
});
test("an unavailable B leaves the original A unchanged", () => {
  const t = professional();
  const original = booking(t);
  const occupied = { ...booking(t, 1080), id: "other" };
  assert.throws(
    () => proposeAlternative(original, t, day, 1080, [original, occupied], now),
    /SLOT_UNAVAILABLE/,
  );
  assert.equal(original.start, 960);
  assert.equal(original.status, "REQUESTED");
});
test("the client accepts a held proposal, which remains unavailable to others", () => {
  const t = professional();
  const original = booking(t);
  const proposed = proposeAlternative(original, t, day, 1080, [original], now);
  const confirmed = respondBooking(proposed, "accept-alternative", now);
  assert.equal(confirmed.status, "CONFIRMED");
  assert.ok(!availableStarts(t, day, 60, [confirmed], now).includes(1080));
});
test("rejecting an alternative releases B", () => {
  const t = professional();
  const original = booking(t);
  const proposed = proposeAlternative(original, t, day, 1080, [original], now);
  const declined = respondBooking(proposed, "reject-alternative", now);
  assert.ok(availableStarts(t, day, 60, [declined], now).includes(1080));
});
test("confirmed appointments can be cancelled by either party, with actor history", () => {
  const confirmed = respondBooking(booking(), "confirm", now);
  const client = respondBooking(confirmed, "cancel", now, "Changed plans");
  const therapist = cancelByTherapist(confirmed, now);
  assert.equal(client.events.at(-1)?.from, "CONFIRMED");
  assert.equal(client.events.at(-1)?.actor, "client");
  assert.equal(therapist.events.at(-1)?.actor, "therapist");
});
test("no response at start is recorded distinctly from no-show", () => {
  const expired = expireUnanswered(
    [booking()],
    new Date("2026-10-06T14:00:00Z"),
  )[0];
  assert.equal(expired.status, "EXPIRED_PROVIDER");
  assert.equal(expired.events.at(-1)?.actor, "system");
  assert.throws(
    () => respondBooking(expired, "no-show", new Date("2026-10-06T15:00:00Z")),
    /INVALID_TRANSITION/,
  );
});
test("a client-unanswered proposal is not counted as therapist nonresponse", () => {
  const t = professional();
  const original = booking(t);
  const proposed = proposeAlternative(original, t, day, 1080, [original], now);
  assert.equal(
    expireUnanswered([proposed], new Date("2026-10-06T16:00:00Z"))[0].status,
    "EXPIRED_CLIENT",
  );
});
test("outcomes can be corrected after the session starts; the history is preserved", () => {
  const confirmed = respondBooking(booking(), "confirm", now);
  assert.throws(
    () => respondBooking(confirmed, "no-show", now),
    /INVALID_TRANSITION/,
  );
  const later = new Date("2026-10-06T15:00:00Z");
  const noShow = respondBooking(confirmed, "no-show", later);
  const corrected = respondBooking(noShow, "complete", later);
  assert.equal(corrected.status, "COMPLETED");
  assert.equal(corrected.events.at(-1)?.from, "NO_SHOW");
});
test("changing a service later does not modify the booking duration or price snapshot", () => {
  const t = professional();
  const original = booking(t);
  t.services[0].duration = 90;
  t.services[0].price = 80;
  assert.equal(original.duration, 60);
  assert.equal(original.price, 45);
});
test("missing price remains null instead of becoming a free session", () => {
  const t = professional();
  const b = requestBooking(
    t,
    { ...contact, serviceId: "ana-intro", date: day, start: 960 },
    [],
    now,
  );
  assert.equal(b.price, null);
});
test("archived profiles, disabled services and invalid contacts cannot receive requests", () => {
  const t = professional();
  t.active = false;
  assert.throws(() => booking(t), /SLOT_UNAVAILABLE/);
  t.active = true;
  t.services[0].active = false;
  assert.throws(() => booking(t), /SERVICE_UNAVAILABLE/);
  t.services[0].active = true;
  assert.throws(
    () =>
      requestBooking(
        t,
        {
          ...contact,
          clientPhone: "invalid",
          serviceId: "ana-individual",
          date: day,
          start: 960,
        },
        [],
        now,
      ),
    /INVALID_CONTACT/,
  );
});
test("blocked periods are subtracted and invalid dates return no candidates", () => {
  const t = professional();
  t.blocked = [{ id: "blocked", date: day, start: 960, end: 1020 }];
  assert.equal(freeRanges(t, day, [])[0].start, 1020);
  assert.deepEqual(availableStarts(t, "2026-02-30", 60, [], now), []);
});
test("recurring availability rejects overlaps but permits adjacent windows", () => {
  assert.throws(
    () =>
      validateWindows([
        { id: "1", weekday: 1, start: 960, end: 1020 },
        { id: "2", weekday: 1, start: 990, end: 1080 },
      ]),
    /OVERLAPPING_AVAILABILITY/,
  );
  assert.doesNotThrow(() =>
    validateWindows([
      { id: "1", weekday: 1, start: 960, end: 1020 },
      { id: "2", weekday: 1, start: 1020, end: 1080 },
    ]),
  );
});
test("08:00 reminder eligibility uses Montenegro time and excludes client-pending proposals", () => {
  const b = booking();
  const before = new Date("2026-10-06T05:59:00Z");
  const morning = new Date("2026-10-06T06:00:00Z");
  assert.equal(localMinute(morning), 480);
  assert.equal(dateKey(morning), day);
  assert.equal(pendingReminders([b], before).length, 0);
  assert.equal(pendingReminders([b], morning).length, 1);
  assert.equal(
    pendingReminders([{ ...b, status: "ALTERNATIVE_PROPOSED" }], morning)
      .length,
    0,
  );
});
