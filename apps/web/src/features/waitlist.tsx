"use client";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { addDays, dateKey, timeLabel, weekday } from "@terapeut/domain";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { authErrorMessage } from "@/lib/auth-client";
import { requestBookingApi, type WaitlistEntry } from "@/lib/booking-client";
import { formatDate, getWeekdayNames, timeToMinutes } from "@/lib/format";
import { TimeField, readTimeField } from "@/components/time-field";
import { ActionButton, Price, SaveFeedback } from "@/components/ui";

/** Čuva jednu saglasnost: tačan termin ili prvi odgovarajući termin u odabranim danima i satima. */
export function WaitlistForm({
  therapistId,
  serviceId,
  duration,
  price,
  date,
  selectedStart,
}: {
  therapistId: string;
  serviceId: string;
  duration: number;
  price: number | null;
  date: string;
  selectedStart: number | null;
}) {
  const { user } = useAuth();
  const { translate, locale } = useDemo();
  const [mode, setMode] = useState("exact");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<WaitlistEntry | null>(null);
  // Isti formular zadržava oznaku kroz ponovni pokušaj, da izgubljen odgovor ne napravi novu dodjelu.
  const [requestId] = useState(() => crypto.randomUUID());
  const pending = useRef<AbortController | null>(null);
  const dayNames = getWeekdayNames(locale);
  useEffect(() => {
    /** Zatvaranje formulara prekida čekanje; već potvrđen SQL upis ostaje sačuvan. */
    function stopWaiting() {
      pending.current?.abort();
    }
    return stopWaiting;
  }, []);

  /** Šalje izbor i saglasnost; server određuje identitet, mjesto u redu i konačnu dostupnost. */
  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const values = new FormData(event.currentTarget);
    const firstDate = String(values.get("firstDate") || "");
    const start = timeToMinutes(readTimeField(values, "start"));
    let end = start + duration;
    if (mode === "flexible") {
      end = timeToMinutes(readTimeField(values, "end"));
      if (end === 0) end = 1440;
    }
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    try {
      const response = await requestBookingApi(
        "waitlist",
        {
          therapistId,
          requestId,
          serviceId,
          duration: String(duration),
          price: String(price),
          mode,
          firstDate,
          lastDate:
            mode === "exact" ? firstDate : String(values.get("lastDate") || ""),
          start: String(start),
          end: String(end),
          weekdays:
            mode === "exact"
              ? String(weekday(firstDate))
              : values.getAll("weekdays").join(","),
          phone: String(values.get("phone") || ""),
          consent: values.get("consent") === "on" ? "true" : "false",
        },
        controller.signal,
      );
      if (!controller.signal.aborted && response.waitlistEntry)
        setSaved(response.waitlistEntry);
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }

  /** Promjena načina čekanja uklanja staru grešku, a sačuvana prijava ostaje u nalogu. */
  function handleModeChange(event: ChangeEvent<HTMLSelectElement>) {
    setMode(event.target.value);
    setError("");
  }

  if (user?.role !== "CLIENT") return null;
  return (
    <details
      className="waitlist-form booking-section"
      open={selectedStart !== null || undefined}
    >
      <summary>
        {translate(
          "Željeni termin je zauzet? Pridružite se listi čekanja",
          "Preferred time is busy? Join the waiting list",
        )}
      </summary>
      {saved ? (
        <div className="waitlist-result" role="status">
          <h3>
            {saved.status === "ASSIGNED"
              ? translate(
                  "Termin vam je dodijeljen i potvrđen.",
                  "Your session has been assigned and confirmed.",
                )
              : translate(
                  "Na listi ste čekanja.",
                  "You are on the waiting list.",
                )}
          </h3>
          <p>
            {translate(
              "Prvi odgovarajući slobodan termin automatski se potvrđuje prema redosljedu prijava. Pratite prijavu i odustanite u svom nalogu.",
              "The first matching free time is automatically confirmed in signup order. View or withdraw your entry in your account.",
            )}
          </p>
          <Link href="/account#my-bookings" className="text-link">
            {translate(
              "Moji termini i lista čekanja",
              "My sessions and waiting list",
            )}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleJoin} aria-busy={saving}>
          <p>
            {translate(
              "Jedna prijava donosi jednu seansu. Kada se oslobodi odgovarajuće vrijeme, seansa se odmah potvrđuje i vama i terapeutu stiže email.",
              "Each entry books one session. When a matching time becomes free, it is immediately confirmed and both you and the therapist receive an email.",
            )}
          </p>
          <p>
            {duration} min · <Price value={price} /> ·{" "}
            {translate("Vrijeme u Crnoj Gori", "Montenegro time")}
          </p>
          <fieldset disabled={saving} className="waitlist-fields">
            <label className="field">
              <span>{translate("Želim da čekam", "I want to wait for")}</span>
              <select value={mode} onChange={handleModeChange} name="mode">
                <option value="exact">
                  {translate("Tačan datum i vrijeme", "An exact date and time")}
                </option>
                <option value="flexible">
                  {translate(
                    "Odgovarajuće dane i raspon vremena",
                    "Preferred days and a time range",
                  )}
                </option>
              </select>
            </label>
            <div className="waitlist-grid">
              <label className="field">
                <span>
                  {mode === "exact"
                    ? translate("Željeni datum", "Preferred date")
                    : translate("Od datuma", "From date")}
                </span>
                <input
                  type="date"
                  name="firstDate"
                  required
                  min={dateKey()}
                  max={addDays(dateKey(), 90)}
                  defaultValue={date}
                />
              </label>
              {mode === "flexible" && (
                <label className="field">
                  <span>{translate("Do datuma", "Until date")}</span>
                  <input
                    type="date"
                    name="lastDate"
                    required
                    min={dateKey()}
                    max={addDays(dateKey(), 90)}
                    defaultValue={addDays(dateKey(), 90)}
                  />
                </label>
              )}
            </div>
            {mode === "flexible" && (
              <fieldset className="waitlist-days">
                <legend>
                  {translate("Odgovarajući dani", "Preferred days")}
                </legend>
                {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                  <label key={day} className="checkbox-label">
                    <input
                      type="checkbox"
                      name="weekdays"
                      value={day}
                      defaultChecked={day === weekday(date)}
                    />
                    <span>{dayNames[day]}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className="waitlist-grid">
              <TimeField
                name="start"
                label={
                  mode === "exact"
                    ? translate("Željeno vrijeme", "Preferred time")
                    : translate("Najraniji početak", "Earliest start")
                }
                defaultValue={timeLabel(selectedStart ?? 540)}
              />
              {mode === "flexible" && (
                <TimeField
                  name="end"
                  label={translate("Najkasniji završetak", "Latest finish")}
                  defaultValue="17:00"
                />
              )}
            </div>
            <label className="field">
              <span>
                {translate(
                  "Telefon za listu čekanja",
                  "Waiting list phone number",
                )}
              </span>
              <input
                type="tel"
                name="phone"
                autoComplete="tel"
                required
                maxLength={30}
                defaultValue={user.phone || ""}
              />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" name="consent" required />
              <span>
                {translate(
                  "Saglasan/na sam da mi se prvi odgovarajući termin automatski dodijeli i potvrdi, uz prikazano trajanje i cijenu. Terapeut dobija moje kontakt podatke.",
                  "I agree to automatic assignment and confirmation of the first matching time at the displayed duration and price. The therapist receives my contact details.",
                )}
              </span>
            </label>
          </fieldset>
          <ActionButton
            type="submit"
            className="button button-primary"
            pending={saving}
            pendingText={translate("Čuvanje prijave…", "Saving entry…")}
          >
            {translate("Pridruži se listi čekanja", "Join waiting list")}
          </ActionButton>
          {saving && (
            <SaveFeedback
              kind="pending"
              title={translate(
                "Čuvanje liste čekanja…",
                "Saving waiting list entry…",
              )}
            />
          )}
          {error && <SaveFeedback kind="error" title={error} />}
        </form>
      )}
    </details>
  );
}

/** Prikazuje privatne prijave uz termine; terapeutu je lista informativna i ne omogućava preskakanje reda. */
export function WaitlistOverview({
  entries,
  therapistView,
  onChanged,
}: {
  entries: WaitlistEntry[];
  therapistView: boolean;
  onChanged: () => void;
}) {
  const { translate } = useDemo();
  if (!entries.length) return null;
  const waitingCount = entries.filter(
    (entry) => entry.status === "WAITING",
  ).length;
  return (
    <details className="recurring-overview waitlist-overview">
      <summary>
        {translate("Lista čekanja", "Waiting list")} ({waitingCount})
      </summary>
      <p className="waitlist-explanation">
        {translate(
          "Termin dobija prva prijavljena osoba čiji izbor odgovara oslobođenom terminu. Svaka prijava važi za jednu seansu.",
          "A free time goes to the first signup whose preferences match. Each entry covers one session.",
        )}
      </p>
      {entries.map((entry) => (
        <WaitlistCard
          key={entry.id}
          entry={entry}
          therapistView={therapistView}
          onChanged={onChanged}
        />
      ))}
    </details>
  );
}

/** Prikazuje sačuvani izbor i status; povlačenje je dostupno samo vlasniku aktivne prijave. */
function WaitlistCard({
  entry,
  therapistView,
  onChanged,
}: {
  entry: WaitlistEntry;
  therapistView: boolean;
  onChanged: () => void;
}) {
  const { translate, locale } = useDemo();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    /** Uklanja čekanje na stari odgovor pri odjavi ili promjeni naloga. */
    function stopWaiting() {
      pending.current?.abort();
    }
    return stopWaiting;
  }, []);
  /** Povlači prijavu; ako je server već dodijelio termin, osvježavanje prikazuje potvrđenu seansu. */
  async function handleCancel() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    try {
      await requestBookingApi(
        `waitlist/${entry.id}/cancel`,
        {},
        controller.signal,
      );
      if (!controller.signal.aborted) onChanged();
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }
  const labels = {
    WAITING: translate("Čeka oslobađanje termina", "Waiting for a free time"),
    ASSIGNED: translate("Termin je dodijeljen", "Session assigned"),
    CANCELLED: translate("Prijava je povučena", "Entry withdrawn"),
    EXPIRED: translate("Period čekanja je istekao", "Waiting period expired"),
    UNAVAILABLE: translate(
      "Seansa ili nalog su izmijenjeni — napravite novu prijavu ako i dalje želite termin",
      "Session or account changed — sign up again if you still want a time",
    ),
  };
  return (
    <section className="recurring-rule" data-waitlist-id={entry.id}>
      <h3>{therapistView ? entry.clientName : entry.therapistName}</h3>
      <p>
        {entry.serviceName} · {entry.duration} min ·{" "}
        <Price value={entry.price} />
      </p>
      <p>
        {formatDate(entry.firstDate, locale, true)}
        {entry.firstDate !== entry.lastDate && (
          <> — {formatDate(entry.lastDate, locale, true)}</>
        )}{" "}
        · {timeLabel(entry.start)}
        {!entry.exact && <>–{timeLabel(entry.end)}</>}
      </p>
      {!entry.exact && (
        <p>
          {entry.weekdays.map((day) => getWeekdayNames(locale)[day]).join(", ")}
        </p>
      )}
      <p>
        <strong>{labels[entry.status]}</strong>
      </p>
      <p className="muted small">
        {translate("Prijava", "Signed up")}:{" "}
        {new Intl.DateTimeFormat(locale === "mne" ? "sr-Latn-ME" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Europe/Podgorica",
        }).format(new Date(entry.createdAt))}
      </p>
      {entry.bookingId && (
        <a className="text-link" href={`#booking-${entry.bookingId}`}>
          {translate(
            "Pogledaj dodijeljenu seansu i njeno trenutno stanje",
            "View assigned session and its current status",
          )}
        </a>
      )}
      {!therapistView && entry.status === "WAITING" && (
        <ActionButton
          type="button"
          className="button button-outline button-sm"
          onClick={handleCancel}
          pending={saving}
          pendingText={translate("Povlačenje…", "Withdrawing…")}
        >
          {translate("Napusti listu čekanja", "Leave waiting list")}
        </ActionButton>
      )}
      {error && <SaveFeedback kind="error" title={error} />}
    </section>
  );
}
