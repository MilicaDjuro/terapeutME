// Terapeutski sedmični pregled: raspored u pozadini, zahtjevi kao blokovi i detalji na klik.
"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Therapist,
  addDays,
  dateKey,
  weekday,
  timeLabel,
} from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { formatDate } from "@/lib/format";
import { BookingCard } from "./booking-card";
/** Prikazuje sedmični raspored terapeuta; klik na zauzeti blok otvara detalje zahtjeva. */
export function WeekCalendar({ therapist }: { therapist: Therapist }) {
  const { state, translate, locale } = useDemo();
  const today = dateKey();
  const [week, setWeek] = useState(addDays(today, -((weekday(today) + 6) % 7)));
  const [selected, setSelected] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const bookings = (state?.bookings || []).filter(
    (booking) =>
      booking.therapistId === therapist.id &&
      days.includes(booking.date) &&
      !["DECLINED", "CANCELLED"].includes(booking.status),
  );
  const intervals = [...therapist.availability, ...bookings];
  const startHour = Math.max(
    0,
    Math.floor(Math.min(480, ...intervals.map((item) => item.start)) / 60),
  );
  const endHour = Math.min(
    24,
    Math.ceil(Math.max(1320, ...intervals.map((item) => item.end)) / 60),
  );
  const hours = Array.from(
    { length: endHour - startHour },
    (_, i) => startHour + i,
  );
  const chosen = state?.bookings.find((booking) => booking.id === selected);
  return (
    <section className="week-section">
      <div className="week-toolbar">
        <div>
          <h2>{translate("Vaš kalendar", "Your calendar")}</h2>
          <p className="capitalize">
            {formatDate(week, locale)} — {formatDate(addDays(week, 6), locale)}
          </p>
        </div>
        <div>
          <button
            className="icon-button"
            onClick={() => setWeek(addDays(week, -7))}
            aria-label={translate("Prethodna nedjelja", "Previous week")}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="button button-outline button-sm"
            onClick={() => setWeek(addDays(today, -((weekday(today) + 6) % 7)))}
          >
            {translate("Danas", "Today")}
          </button>
          <button
            className="icon-button"
            onClick={() => setWeek(addDays(week, 7))}
            aria-label={translate("Sljedeća nedjelja", "Next week")}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="week-scroll">
        <div className="week-grid">
          <div className="week-hours">
            <div className="week-corner" />
            {hours.map((hour) => (
              <span key={hour}>{hour}:00</span>
            ))}
          </div>
          {days.map((day) => (
            <div className="week-day" key={day}>
              <div
                className={`week-day-title ${day === today ? "current" : ""}`}
              >
                <span>
                  {new Intl.DateTimeFormat(
                    locale === "mne" ? "sr-Latn-ME" : "en-GB",
                    { timeZone: "UTC", weekday: "short" },
                  ).format(new Date(`${day}T12:00:00Z`))}
                </span>
                <strong>{Number(day.slice(-2))}</strong>
              </div>
              <div
                className="week-day-body"
                style={{ height: `${hours.length * 52}px` }}
              >
                {hours.map((hour) => (
                  <div className="hour-line" key={hour} />
                ))}
                {therapist.availability
                  .filter(
                    (availabilityWindow) =>
                      availabilityWindow.weekday === weekday(day),
                  )
                  .map((availabilityWindow) => (
                    <div
                      className="availability-shade"
                      key={availabilityWindow.id}
                      style={{
                        top: `${((availabilityWindow.start - startHour * 60) / 60) * 52}px`,
                        height: `${((availabilityWindow.end - availabilityWindow.start) / 60) * 52}px`,
                      }}
                    >
                      <span>{translate("Dostupno", "Available")}</span>
                    </div>
                  ))}
                {bookings
                  .filter((booking) => booking.date === day)
                  .map((booking) => (
                    <button
                      key={booking.id}
                      className={`week-event ${booking.status.toLowerCase()}`}
                      style={{
                        top: `${((booking.start - startHour * 60) / 60) * 52}px`,
                        height: `${Math.max(28, (booking.duration / 60) * 52)}px`,
                      }}
                      onClick={() => setSelected(booking.id)}
                      aria-label={`${booking.clientName}, ${timeLabel(booking.start)}–${timeLabel(booking.end)}`}
                    >
                      <strong>{timeLabel(booking.start)}</strong>
                      <span>{booking.clientName}</span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="week-legend">
        <span>
          <i className="legend-confirmed" />
          {translate("Potvrđeno", "Confirmed")}
        </span>
        <span>
          <i className="legend-pending" />
          {translate("Čeka terapeuta", "Awaiting therapist")}
        </span>
        <span>
          <i className="legend-alternative" />
          {translate("Čeka klijenta", "Awaiting client")}
        </span>
        <span>
          <i className="legend-expired" />
          {translate("Bez odgovora", "No response")}
        </span>
      </div>
      {chosen && <BookingCard key={chosen.id} booking={chosen} therapistView />}
    </section>
  );
}
