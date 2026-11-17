"use client";
import { useEffect, useState } from "react";
import { addDays, dateKey, timeLabel } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { authErrorMessage } from "@/lib/auth-client";
import { requestBookingApi, type ServerSlot } from "@/lib/booking-client";
import { Spinner } from "./ui";

/** Čita živu zauzetost iz baze; zauzeti početci ostaju vidljivi i ne mogu se izabrati. */
export function ServerCalendar({
  therapistId,
  duration,
  date,
  onDate,
  start,
  onStart,
  onUnavailable,
  onWaitlistStart,
}: {
  therapistId: string;
  duration: number;
  date: string;
  onDate: (date: string) => void;
  start: number | null;
  onStart: (start: number) => void;
  onUnavailable: () => void;
  onWaitlistStart?: (start: number) => void;
}) {
  const { translate } = useDemo();
  const [slots, setSlots] = useState<ServerSlot[]>([]);
  const [dayOff, setDayOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Promjena datuma/trajanja pokreće novo čitanje; polling i povratak u tab provjeravaju tuđe rezervacije.
  useEffect(() => {
    let currentRequest: AbortController | undefined;
    let stopped = false;
    setSlots([]);
    setDayOff(false);
    setLoading(true);
    setError("");
    /** Prekida stariji zahtjev da spor odgovor ne vrati zastarjelu zauzetost. */
    async function loadSlots() {
      if (document.visibilityState !== "visible") return;
      currentRequest?.abort();
      const controller = new AbortController();
      currentRequest = controller;
      try {
        const response = await requestBookingApi(
          `therapists/${encodeURIComponent(therapistId)}/slots?duration=${duration}&date=${date}`,
          undefined,
          controller.signal,
        );
        if (stopped || controller.signal.aborted) return;
        const nextSlots = response.slots || [];
        setSlots(nextSlots);
        setDayOff(response.dayOff === true);
        setError("");
        if (
          start !== null &&
          !nextSlots.some((slot) => slot.start === start && slot.available)
        )
          onUnavailable();
      } catch (failure) {
        if (!stopped && !controller.signal.aborted) {
          setError(authErrorMessage(failure));
          setSlots([]);
          setDayOff(false);
          onUnavailable();
        }
      } finally {
        if (!stopped && !controller.signal.aborted) setLoading(false);
      }
    }
    void loadSlots();
    const timer = setInterval(() => {
      void loadSlots();
    }, 5000);
    /** Osvježava kalendar kad klijent vrati otvoreni tab. */
    function handleVisibility() {
      void loadSlots();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    /** Uklanja timer, slušač i mrežni zahtjev pri zatvaranju kalendara. */
    function stopLoading() {
      stopped = true;
      currentRequest?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    return stopLoading;
  }, [therapistId, duration, date, start, onUnavailable]);
  return (
    <div className="calendar-picker server-calendar">
      <div className="date-panel">
        <label className="field">
          <span>{translate("Datum seanse", "Session date")}</span>
          <input
            type="date"
            value={date}
            min={dateKey()}
            max={addDays(dateKey(), 90)}
            onChange={(event) => {
              if (event.target.value) onDate(event.target.value);
            }}
          />
        </label>
        <p>
          {translate(
            "Vrijeme u Crnoj Gori · narednih 90 dana",
            "Montenegro time · next 90 days",
          )}
        </p>
        <p>
          {translate(
            "Sivi termini su zauzeti za izabrano trajanje.",
            "Grey times are booked for the selected duration.",
          )}
        </p>
      </div>
      <div className="times-panel" aria-busy={loading}>
        <h3>
          {translate("Slobodni i zauzeti termini", "Available and busy times")}{" "}
          · {duration} min
        </h3>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">
            <Spinner /> {translate("Učitavanje termina…", "Loading times…")}
          </p>
        ) : (
          <>
            <div className="time-options">
              {slots.map((slot) => (
                <button
                  key={slot.start}
                  type="button"
                  disabled={!slot.available || !!error}
                  className={start === slot.start ? "selected" : ""}
                  aria-pressed={start === slot.start}
                  onClick={() => onStart(slot.start)}
                >
                  {timeLabel(slot.start)}
                  <span>– {timeLabel(slot.end)}</span>
                  <small>
                    {slot.available
                      ? translate("Slobodno", "Available")
                      : translate("Zauzet", "Busy")}
                  </small>
                </button>
              ))}
            </div>
            {onWaitlistStart && slots.some((slot) => !slot.available) && (
              <details className="waitlist-busy-times">
                <summary>
                  {translate(
                    "Čekaj određeni zauzeti termin",
                    "Wait for a specific busy time",
                  )}
                </summary>
                <div className="booking-actions">
                  {slots
                    .filter((slot) => !slot.available)
                    .map((slot) => (
                      <button
                        type="button"
                        key={slot.start}
                        className="button button-outline button-sm"
                        onClick={() => onWaitlistStart(slot.start)}
                      >
                        {translate("Čekaj", "Wait for")} {timeLabel(slot.start)}
                        –{timeLabel(slot.end)}
                      </button>
                    ))}
                </div>
              </details>
            )}
            {!slots.length && !error && (
              <p>
                {dayOff
                  ? translate(
                      "Terapeut ne radi ovog datuma. Izaberite drugi datum.",
                      "The therapist does not work on this date. Choose another date.",
                    )
                  : translate(
                      "Nema termina ovog dana. Izaberite drugi datum.",
                      "No times on this day. Choose another date.",
                    )}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
