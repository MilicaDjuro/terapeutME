"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addDays,
  dateKey,
  timeLabel,
  weekday,
  type Booking,
  type Locale,
} from "@terapeut/domain";
import { Repeat2 } from "lucide-react";
import { ActionButton, SaveFeedback } from "@/components/ui";
import { TimeField, readTimeField } from "@/components/time-field";
import { useDemo } from "@/lib/demo-context";
import { authErrorMessage } from "@/lib/auth-client";
import { requestBookingApi, type RecurringSeries } from "@/lib/booking-client";
import { formatDate, getWeekdayNames, timeToMinutes } from "@/lib/format";

/** Prikazuje dan i sat izvornog pravila; pomjeranje jedne seanse ne mijenja ovaj opis. */
function formatRecurringSchedule(rule: RecurringSeries, locale: Locale) {
  const day = weekday(rule.firstDate);
  const time = timeLabel(rule.start);
  if (locale === "en") {
    const repeat = rule.intervalDays === 7 ? "Every" : "Every other";
    return `${repeat} ${getWeekdayNames(locale)[day]} at ${time}`;
  }

  const dayNames = [
    "nedjelje",
    "ponedjeljka",
    "utorka",
    "srijede",
    "četvrtka",
    "petka",
    "subote",
  ];
  // Nedjelja, srijeda i subota koriste oblik „svake“, a ostali dani „svakog“.
  const feminineDay = day === 0 || day === 3 || day === 6;
  let repeat = feminineDay ? "Svake" : "Svakog";
  if (rule.intervalDays === 14) {
    repeat += feminineDay ? " druge" : " drugog";
  }
  return `${repeat} ${dayNames[day]} u ${time}`;
}

/** Checkbox otvara pravilo za ovog klijenta; serija nastaje tek poslije potvrđenog API upisa. */
export function RecurringBookingForm({
  booking,
  onSaved,
}: {
  booking: Booking;
  onSaved: (booking: Booking) => void;
}) {
  const { translate } = useDemo();
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    /** Prekida lokalno čekanje pri odjavi; server i dalje atomski čuva cijelu seriju. */
    function stopWaiting() {
      pending.current?.abort();
    }
    return stopWaiting;
  }, []);

  /** Šalje samo potvrđeni termin i razmak; klijenta i vlasništvo bira server. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = new FormData(event.currentTarget);
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    try {
      const response = await requestBookingApi(
        "booking-series",
        {
          bookingId: booking.id,
          intervalDays: String(form.get("intervalDays")),
        },
        controller.signal,
      );
      if (!controller.signal.aborted && response.booking)
        onSaved(response.booking);
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }

  return (
    <div className="recurring-create">
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(event) => {
            setEnabled(event.target.checked);
            setError("");
          }}
        />
        <span>
          {translate(
            "Stalni termin za ovog klijenta",
            "Recurring sessions for this client",
          )}
        </span>
      </label>
      {enabled && (
        <form onSubmit={handleSave} aria-busy={saving}>
          <label className="field">
            <span>{translate("Ponavljanje", "Repeat")}</span>
            <select name="intervalDays" disabled={saving} defaultValue="7">
              <option value="7">
                {translate("Svake sedmice — 7 dana", "Every week — 7 days")}
              </option>
              <option value="14">
                {translate(
                  "Svake druge sedmice — 14 dana",
                  "Every other week — 14 days",
                )}
              </option>
            </select>
          </label>
          <p className="muted">
            {translate(
              `Ponavlja se u ${timeLabel(booking.start)}, od ovog termina. Potvrđene seanse se prave za narednih 90 dana i automatski dopunjavaju dok ne zaustavite seriju. Klijent dobija email za svaku novu seansu.`,
              `Repeats at ${timeLabel(booking.start)}, starting with this session. Confirmed sessions are maintained for the next 90 days until you stop the series. The client receives an email for each new session.`,
            )}
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <ActionButton
            pending={saving}
            disabled={saving}
            pendingText={translate("Čuvanje serije…", "Saving series…")}
            className="button button-primary"
          >
            {translate("Sačuvaj stalni termin", "Save recurring sessions")}
          </ActionButton>
        </form>
      )}
    </div>
  );
}

/** Prikazuje pravila i neriješene datume obje uloge; samo terapeut dobija radnje čuvanja. */
export function RecurringSeriesOverview({
  series,
  therapistView,
  onChanged,
}: {
  series: RecurringSeries[];
  therapistView: boolean;
  onChanged: () => void;
}) {
  const { translate } = useDemo();
  if (!series.length) return null;
  return (
    <details className="recurring-overview">
      <summary>
        <Repeat2 size={18} aria-hidden="true" />
        {translate("Stalni termini", "Recurring sessions")} (
        {series.filter((rule) => rule.active).length})
        {series.some((rule) => rule.issues.length > 0) && (
          <strong>
            {translate("Potrebna provjera datuma", "Dates need attention")}
          </strong>
        )}
      </summary>
      {series.map((rule) => (
        <RecurringSeriesCard
          key={rule.id}
          rule={rule}
          therapistView={therapistView}
          onChanged={onChanged}
        />
      ))}
    </details>
  );
}

/** Zaustavlja tačno jednu seriju i nudi zamjenu samo za datum koji nije automatski zakazan. */
function RecurringSeriesCard({
  rule,
  therapistView,
  onChanged,
}: {
  rule: RecurringSeries;
  therapistView: boolean;
  onChanged: () => void;
}) {
  const { translate, locale } = useDemo();
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    /** Uklanja aktivno browser čekanje kada kartica više nije vidljiva. */
    function stopWaiting() {
      pending.current?.abort();
    }
    return stopWaiting;
  }, []);

  /** Jedna mrežna radnja zaključava povezane kontrole; uspjeh se prikazuje tek nakon COMMIT-a. */
  async function saveChange(
    action: "stop" | "resolve",
    body: Record<string, string>,
  ) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await requestBookingApi(
        `booking-series/${rule.id}/${action}`,
        body,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setConfirmingStop(false);
        setSuccess(
          action === "stop"
            ? translate("Serija je zaustavljena.", "Series stopped.")
            : translate("Termin je sačuvan.", "Session saved."),
        );
        onChanged();
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }

  /** Otkazuje buduće termine tek poslije jasnog koraka potvrde u prikazu. */
  function handleStop() {
    void saveChange("stop", {});
  }

  /** Čita novi datum i sat za jedan problem; ritam drugih seansi se ne šalje na izmjenu. */
  function handleResolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void saveChange("resolve", {
      occurrenceDate: String(form.get("occurrenceDate")),
      date: String(form.get("date")),
      start: String(timeToMinutes(readTimeField(form, "time"))),
    });
  }

  return (
    <section className="recurring-rule" data-series-id={rule.id}>
      <h3>{therapistView ? rule.clientName : rule.therapistName}</h3>
      <p>
        {formatRecurringSchedule(rule, locale)} · {rule.duration} min ·{" "}
        {rule.active
          ? translate("Aktivna serija", "Active series")
          : translate("Zaustavljena serija", "Stopped series")}
      </p>
      <p className="muted">
        {translate(
          "Svaki zakazani termin je prikazan pojedinačno u listi. Promjena jedne seanse ne pomjera ostale.",
          "Each booked session appears separately below. Changing one session does not move the others.",
        )}
      </p>
      {rule.issues.map((issue) => (
        <div className="recurring-issue" key={issue.date}>
          <strong>
            {formatDate(issue.date, locale)} —{" "}
            {translate("nije zakazano", "not booked")}
          </strong>
          <p>{issue.reason}</p>
          {therapistView && rule.active && (
            <details>
              <summary>
                {translate("Izaberi zamjenski termin", "Choose a replacement")}
              </summary>
              <form onSubmit={handleResolve} aria-busy={saving}>
                <input type="hidden" name="occurrenceDate" value={issue.date} />
                <label className="field">
                  <span>
                    {translate("Zamjenski datum", "Replacement date")}
                  </span>
                  <input
                    name="date"
                    type="date"
                    min={dateKey()}
                    max={addDays(dateKey(), 90)}
                    defaultValue={
                      issue.date < dateKey() ? dateKey() : issue.date
                    }
                    required
                    disabled={saving}
                  />
                </label>
                <TimeField
                  name="time"
                  label={translate("Zamjensko vrijeme", "Replacement time")}
                  defaultValue={timeLabel(rule.start)}
                  disabled={saving}
                />
                <ActionButton
                  pending={saving}
                  disabled={saving}
                  className="button button-primary"
                >
                  {translate("Sačuvaj zamjenski termin", "Save replacement")}
                </ActionButton>
              </form>
            </details>
          )}
        </div>
      ))}
      {error && <SaveFeedback kind="error" title={error} />}
      {success && <SaveFeedback kind="success" title={success} />}
      {therapistView &&
        rule.active &&
        (confirmingStop ? (
          <div className="recurring-stop-confirmation">
            <p>
              {translate(
                "Zaustavljanje otkazuje sve buduće seanse ove serije i šalje obavještenja klijentu. Prošle seanse i istorija ostaju sačuvani.",
                "Stopping cancels every upcoming session in this series and notifies the client. Past sessions and history are preserved.",
              )}
            </p>
            <ActionButton
              pending={saving}
              disabled={saving}
              onClick={handleStop}
              className="button button-outline"
            >
              {translate(
                "Potvrdi zaustavljanje serije",
                "Confirm stopping series",
              )}
            </ActionButton>
            <button
              disabled={saving}
              type="button"
              className="button button-ghost"
              onClick={() => setConfirmingStop(false)}
            >
              {translate("Odustani", "Cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button button-outline"
            disabled={saving}
            onClick={() => setConfirmingStop(true)}
          >
            {translate("Zaustavi seriju", "Stop series")}
          </button>
        ))}
    </section>
  );
}
