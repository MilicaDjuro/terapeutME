// Izbor datuma i vremena. Računanje slobodnih intervala ostaje u packages/domain, ne u HTML-u.
"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, CalendarDays } from "lucide-react";
import {
  availableStarts,
  addDays,
  dateKey,
  timeLabel,
  Therapist,
} from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { formatDate } from "@/lib/format";
/** Prikazuje mjesečni kalendar i dostupna vremena za trajanje izabrane usluge. */
export function CalendarPicker({
  therapist,
  duration,
  selectedDate,
  onDate,
  selectedStart,
  onStart,
  ignoreBookingId,
}: {
  therapist: Therapist;
  duration: number;
  selectedDate: string;
  onDate: (date: string) => void;
  selectedStart: number | null;
  onStart: (start: number) => void;
  ignoreBookingId?: string;
}) {
  const { state, translate, locale } = useDemo();
  const today = dateKey();
  const lastDay = addDays(today, 90);
  const [month, setMonth] = useState(selectedDate.slice(0, 7));
  const first = new Date(`${month}-01T12:00:00Z`);
  const days = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const title = new Intl.DateTimeFormat(
    locale === "mne" ? "sr-Latn-ME" : "en-GB",
    { month: "long", year: "numeric", timeZone: "UTC" },
  ).format(first);
  /** Računa slobodne početke za jedan datum koristeći zajednička pravila iz domain paketa. */
  function getStartsForDate(date: string): number[] {
    return availableStarts(
      therapist,
      date,
      duration,
      state?.bookings || [],
      new Date(),
      ignoreBookingId,
    );
  }
  /** Pomjera prikazani mjesec; izbor datuma i vremena ostaje odgovornost roditeljske komponente. */
  function move(amount: number) {
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + amount);
    setMonth(next.toISOString().slice(0, 7));
  }
  const times = getStartsForDate(selectedDate);
  // Pripremamo dane prije HTML-a: prikaz samo koristi gotove podatke.
  const calendarDays = [];
  for (let dayNumber = 1; dayNumber <= days; dayNumber++) {
    const date = `${month}-${String(dayNumber).padStart(2, "0")}`;
    const enabled =
      date >= today && date <= lastDay && getStartsForDate(date).length > 0;
    calendarDays.push({ date, dayNumber, enabled });
  }
  return (
    <div className="calendar-picker">
      <div className="date-panel">
        <div className="calendar-heading">
          <h3 className="capitalize">{title}</h3>
          <div>
            <button
              className="icon-button"
              aria-label={translate("Prethodni mjesec", "Previous month")}
              disabled={month <= today.slice(0, 7)}
              onClick={() => move(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
              aria-label={translate("Sljedeći mjesec", "Next month")}
              disabled={month >= lastDay.slice(0, 7)}
              onClick={() => move(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="calendar-weekdays">
          {(locale === "mne"
            ? ["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"]
            : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
          ).map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-days">
          {Array.from({ length: offset }, (_, i) => (
            <span key={`empty-${i}`} />
          ))}
          {calendarDays.map((calendarDay) => {
            const day = calendarDay.date;
            const enabled = calendarDay.enabled;
            return (
              <button
                key={day}
                type="button"
                disabled={!enabled}
                aria-label={`${formatDate(day, locale, true)}${enabled ? "" : translate(" — nema termina", " — no times available")}`}
                aria-pressed={selectedDate === day}
                onClick={() => onDate(day)}
                className={`${selectedDate === day ? "selected" : ""} ${day === today ? "today" : ""}`}
              >
                <span>{calendarDay.dayNumber}</span>
                {enabled && <i />}
              </button>
            );
          })}
        </div>
        <div className="calendar-legend">
          <span className="legend-dot" />
          {translate("Dan sa dostupnim terminima", "Day with available times")}
        </div>
        <p className="calendar-zone">
          {translate(
            "Vrijeme u Crnoj Gori · narednih 90 dana",
            "Montenegro time · next 90 days",
          )}
        </p>
      </div>
      <div className="times-panel">
        <div className="times-heading">
          <span className="tiny-label">
            {translate("SLOBODNI TERMINI", "AVAILABLE TIMES")}
          </span>
          <h3 className="capitalize">{formatDate(selectedDate, locale)}</h3>
          <p>
            <Clock3 size={13} />
            {duration} min · {translate("Uživo", "In person")}
          </p>
        </div>
        {times.length ? (
          <div className="time-options">
            {times.map((start) => (
              <button
                key={start}
                className={selectedStart === start ? "selected" : ""}
                onClick={() => onStart(start)}
                aria-pressed={selectedStart === start}
              >
                {timeLabel(start)}
                <span>– {timeLabel(start + duration)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="no-times">
            <CalendarDays size={25} />
            <p>
              {translate(
                "Nema slobodnih termina ovog dana. Izaberite drugi datum.",
                "No times available on this day. Please choose another date.",
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
