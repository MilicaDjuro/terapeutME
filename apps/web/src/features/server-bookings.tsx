"use client";
import { SessionRating } from "./session-rating";
import { useEffect, useState, useRef, type FormEvent } from "react";
import {
  dateKey,
  addDays,
  timeLabel,
  hasStarted,
  type Booking,
  type BookingEvent,
} from "@terapeut/domain";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { authErrorMessage } from "@/lib/auth-client";
import {
  requestBookingApi,
  type ServerBooking,
  type RecurringSeries,
  type WaitlistEntry,
} from "@/lib/booking-client";
import {
  RecurringBookingForm,
  RecurringSeriesOverview,
} from "./recurring-bookings";
import { timeToMinutes, formatDate } from "@/lib/format";
import { CalendarDays, Inbox, Mail, Phone, RefreshCw } from "lucide-react";
import { TimeField, readTimeField } from "@/components/time-field";
import { ClientBookingSummary } from "./client-booking-summary";
import { WaitlistOverview } from "./waitlist";
import {
  ActionButton,
  PendingStatus,
  StatusBadge,
  Price,
  SaveFeedback,
} from "@/components/ui";

/** Prikazuje samo rezervacije naloga iz baze i osvježava odgovor terapeuta ili drugog taba. */
export function ServerBookings() {
  const { user } = useAuth();
  const { translate, locale } = useDemo();
  const [bookings, setBookings] = useState<ServerBooking[]>([]);
  const [series, setSeries] = useState<RecurringSeries[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const therapistView = user?.role === "THERAPIST";
  const waitingBookings = bookings.filter(
    (booking) =>
      booking.status === "REQUESTED" ||
      booking.status === "ALTERNATIVE_PROPOSED",
  );
  const confirmedBookings = bookings.filter(
    (booking) => booking.status === "CONFIRMED",
  );
  const historicalBookings = bookings.filter(
    (booking) =>
      !["REQUESTED", "ALTERNATIVE_PROPOSED", "CONFIRMED"].includes(
        booking.status,
      ),
  );
  // API provjerava kraj seanse na serveru; lista se sama osvježava svakih pet sekundi.
  const ratingBookings = bookings.filter((booking) => booking.canRate);
  let visibleBookings = bookings;
  if (filter === "waiting") visibleBookings = waitingBookings;
  if (filter === "confirmed") visibleBookings = confirmedBookings;
  if (filter === "history") visibleBookings = historicalBookings;
  if (filter === "rating") visibleBookings = ratingBookings;
  const currentTime = new Date();
  // Budući aktivni termini idu od najbližeg datuma i sata, bez prednosti određenog statusa.
  const sortedBookings = [...visibleBookings].sort(compareBookings);
  // Najbliži potvrđeni budući termin biramo iz cijele liste, nezavisno od izabranog filtera.
  const nextBooking = [...confirmedBookings]
    .filter((booking) => !hasStarted(booking, currentTime))
    .sort(compareBookings)[0];

  /** Poredi kopiju liste, bez izmjene odgovora servera ili istorije rezervacija. */
  function compareBookings(
    first: ServerBooking,
    second: ServerBooking,
  ): number {
    const firstActive = [
      "REQUESTED",
      "ALTERNATIVE_PROPOSED",
      "CONFIRMED",
    ].includes(first.status);
    const secondActive = [
      "REQUESTED",
      "ALTERNATIVE_PROPOSED",
      "CONFIRMED",
    ].includes(second.status);
    if (firstActive !== secondActive) return firstActive ? -1 : 1;

    // ISO datum se poredi po datumu, a broj minuta razrješava termine istog dana.
    const byDate =
      first.date.localeCompare(second.date) || first.start - second.start;
    if (firstActive) {
      // Seanse iz prošlosti bez upisanog ishoda ne smiju zakloniti buduće; zona je Europe/Podgorica.
      const firstStarted = hasStarted(first, currentTime);
      const secondStarted = hasStarted(second, currentTime);
      if (firstStarted !== secondStarted) return firstStarted ? 1 : -1;
      return byDate;
    }
    // Završene, odbijene i otkazane rezervacije ostaju na kraju, od najnovije.
    return -byDate;
  }
  useEffect(() => {
    let stopped = false;
    let pending: AbortController | undefined;
    /** Učitava privatnu listu; ID i ulogu korisnika servis izvodi iz JWT sesije. */
    async function loadBookings() {
      if (document.visibilityState !== "visible") return;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await requestBookingApi(
          "bookings",
          undefined,
          controller.signal,
        );
        if (!stopped && !controller.signal.aborted) {
          setBookings(response.bookings || []);
          setSeries(response.series || []);
          setWaitlist(response.waitlist || []);
          setError("");
        }
      } catch (failure) {
        if (!stopped && !controller.signal.aborted)
          setError(authErrorMessage(failure));
      } finally {
        if (!stopped && !controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void loadBookings();
    const timer = setInterval(() => {
      void loadBookings();
    }, 5000);
    /** Provjerava promjene kad se korisnik vrati u tab. */
    function handleVisibility() {
      void loadBookings();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    /** Uklanja mrežne zahtjeve i lifecycle radnje pri odjavi. */
    function stopLoading() {
      stopped = true;
      pending?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    return stopLoading;
  }, [reload, user?.id]);
  // Početno učitani termini povećavaju visinu stranice i mogu pomjeriti ranije otvoreni #my-materials.
  // Pomjeramo pregled samo jednom poslije tog učitavanja; polling i ručno osvježavanje ne otimaju skrol.
  useEffect(() => {
    if (loading || window.location.hash !== "#my-materials") return;
    document
      .getElementById("my-materials")
      ?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [loading]);
  /** Ponovo čita rezervacije nakon uspješne izmjene ili mrežne greške. */
  function handleReload() {
    setRefreshing(true);
    setReload((previousReload) => previousReload + 1);
  }
  /** Odmah prikazuje potvrđen serverski status, pa ponovo čita listu i istoriju iz baze. */
  function handleBookingChanged(updatedBooking: Booking) {
    setBookings((currentBookings) =>
      currentBookings.map((booking) =>
        booking.id === updatedBooking.id
          ? { ...booking, ...updatedBooking }
          : booking,
      ),
    );
    handleReload();
  }
  return (
    <section
      id="my-bookings"
      className={`server-bookings${!therapistView ? " client-bookings" : ""}`}
    >
      <div className="requests-heading">
        <div>
          <h2>
            {therapistView
              ? translate("Moji zahtjevi i termini", "My requests and sessions")
              : translate("Moji termini", "My sessions")}
          </h2>
          <p className="muted small">
            {therapistView
              ? translate(
                  "Budući termini su poređani po datumu i vremenu, od najbližeg. Podaci se automatski osvježavaju.",
                  "Upcoming sessions are ordered by date and time, earliest first. Updates arrive automatically.",
                )
              : translate(
                  "Pratite dogovorene seanse i odgovore svojih terapeuta.",
                  "Keep track of your sessions and replies from your therapists.",
                )}
          </p>
        </div>
        <ActionButton
          pending={refreshing}
          pendingText={translate("Osvježavanje…", "Refreshing…")}
          type="button"
          className="button button-outline button-sm"
          onClick={handleReload}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {translate("Osvježi zahtjeve", "Refresh requests")}
        </ActionButton>
      </div>
      <RecurringSeriesOverview
        series={series}
        therapistView={therapistView}
        onChanged={handleReload}
      />
      <WaitlistOverview
        entries={waitlist}
        therapistView={therapistView}
        onChanged={handleReload}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!therapistView && !loading && nextBooking && (
        <aside
          className="client-next-session"
          aria-label={translate(
            "Sljedeći potvrđeni termin",
            "Next confirmed session",
          )}
        >
          <CalendarDays size={24} aria-hidden="true" />
          <div>
            <span>{translate("VAŠ SLJEDEĆI TERMIN", "YOUR NEXT SESSION")}</span>
            <strong>{nextBooking.therapistName}</strong>
            <p>
              {formatDate(nextBooking.date, locale, true)} ·{" "}
              {timeLabel(nextBooking.start)}–{timeLabel(nextBooking.end)}
            </p>
          </div>
          <a
            href={`#booking-${nextBooking.id}`}
            className="text-link"
            onClick={() => setFilter("all")}
          >
            {translate("Detalji termina", "Session details")}
          </a>
        </aside>
      )}
      {!loading && (
        <div
          className="request-filters"
          role="group"
          aria-label={translate("Prikaz zahtjeva", "Filter requests")}
        >
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            <span>
              {therapistView
                ? translate("Svi zahtjevi", "All requests")
                : translate("Svi termini", "All sessions")}
            </span>
            <strong>{bookings.length}</strong>
          </button>
          <button
            type="button"
            aria-pressed={filter === "waiting"}
            onClick={() => setFilter("waiting")}
          >
            <span>{translate("Na čekanju", "Waiting")}</span>
            <strong>{waitingBookings.length}</strong>
          </button>
          <button
            type="button"
            aria-pressed={filter === "confirmed"}
            onClick={() => setFilter("confirmed")}
          >
            <span>{translate("Potvrđeni termini", "Confirmed")}</span>
            <strong>{confirmedBookings.length}</strong>
          </button>
          <button
            type="button"
            aria-pressed={filter === "history"}
            onClick={() => setFilter("history")}
          >
            <span>{translate("Istorija", "History")}</span>
            <strong>{historicalBookings.length}</strong>
          </button>
          {!therapistView && (
            <button
              type="button"
              className="rating-filter"
              aria-pressed={filter === "rating"}
              onClick={() => setFilter("rating")}
            >
              <span>{translate("Za ocjenjivanje", "To rate")}</span>
              <strong>{ratingBookings.length}</strong>
            </button>
          )}
        </div>
      )}
      {loading ? (
        <PendingStatus>
          {translate("Učitavanje zahtjeva…", "Loading requests…")}
        </PendingStatus>
      ) : error && !bookings.length ? null : !sortedBookings.length ? (
        <div className="requests-empty">
          <Inbox size={28} aria-hidden="true" />
          <h3>
            {therapistView
              ? translate("Nema zahtjeva za prikaz.", "No requests to show.")
              : translate(
                  "Nema termina u ovom prikazu.",
                  "No sessions in this view.",
                )}
          </h3>
          <p>
            {bookings.length
              ? translate(
                  "Ovdje će se prikazati zahtjevi za izabranu grupu.",
                  "Requests in this group will appear here.",
                )
              : translate(
                  "Pronađite terapeuta i izaberite termin koji vam odgovara.",
                  "Find a therapist and choose a time that suits you.",
                )}
          </p>
          {!therapistView && !bookings.length && (
            <Link className="button button-primary" href="/psychotherapy">
              {translate("Pronađi terapeuta", "Find a therapist")}
            </Link>
          )}
        </div>
      ) : (
        sortedBookings.map((booking) => (
          <ServerBookingCard
            key={booking.id}
            booking={booking}
            therapistView={therapistView}
            onChanged={handleBookingChanged}
          />
        ))
      )}
    </section>
  );
}

/** Obrađuje jedan zahtjev; svaki status i predlog server ponovo provjerava uz istoriju. */
function ServerBookingCard({
  booking,
  therapistView,
  onChanged,
}: {
  booking: ServerBooking;
  therapistView: boolean;
  onChanged: (booking: Booking) => void;
}) {
  const { translate, locale } = useDemo();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [proposing, setProposing] = useState(false);
  const [seriesSaved, setSeriesSaved] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    /** Prekida čekanje odgovora kada korisnik odjavi nalog ili zatvori karticu. */
    function stopSaving() {
      pending.current?.abort();
    }
    return stopSaving;
  }, []);
  /** Šalje samo radnju i opcione podatke predloga; uloga se ne šalje iz browsera. */
  async function handleRespond(
    action: string,
    details: Record<string, string> = {},
  ) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    // Samo izabrana radnja dobija spinner; ostale su zaključane do odgovora servera.
    setPendingAction(action);
    setSubmitting(true);
    setError("");
    try {
      const response = await requestBookingApi(
        `bookings/${booking.id}/respond`,
        { action, ...details },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        if (!response.booking) throw new Error("Nedostaje ažurirani termin.");
        setProposing(false);
        onChanged(response.booking);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSubmitting(false);
        setPendingAction("");
      }
    }
  }
  /** Predlaže drugi termin; neuspješan predlog ostavlja prvobitno vrijeme zauzetim. */
  function handlePropose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void handleRespond("propose", {
      date: String(form.get("date")),
      start: String(timeToMinutes(readTimeField(form, "time"))),
    });
  }
  /** Potvrđuje čuvanje serije tek kada server vrati polaznu seansu sa pripadajućim pravilom. */
  function handleSeriesSaved(updated: Booking) {
    setSeriesSaved(true);
    onChanged(updated);
  }
  /** Daje razumljiv naslov sačuvanog događaja; ne mijenja serversku istoriju ni statuse. */
  function getHistoryLabel(event: BookingEvent): string {
    if (event.action === "WAITLIST_ASSIGNED")
      return translate(
        "Oslobođeni termin je automatski dodijeljen sa liste čekanja",
        "Free time automatically assigned from the waiting list",
      );
    if (event.action === "RECURRING_CREATED")
      return translate(
        "Automatski je zakazana seansa iz stalne serije",
        "Recurring session booked automatically",
      );
    if (event.action === "SERIES_STARTED")
      return translate(
        "Terapeut je uključio stalni termin",
        "Therapist started recurring sessions",
      );
    if (event.action === "REQUEST_CREATED")
      return translate("Zahtjev je poslat", "Request sent");
    if (event.action === "CONFIRM")
      return translate(
        "Terapeut je potvrdio termin",
        "Therapist confirmed the session",
      );
    if (event.action === "DECLINE")
      return translate(
        "Terapeut je odbio zahtjev",
        "Therapist declined the request",
      );
    if (event.action === "ALTERNATIVE_PROPOSED")
      return translate(
        "Terapeut je predložio novi termin",
        "Therapist proposed another time",
      );
    if (event.action === "ACCEPT_ALTERNATIVE")
      return translate("Novi termin je prihvaćen", "New time accepted");
    if (event.action === "REJECT_ALTERNATIVE")
      return translate("Novi termin je odbijen", "New time declined");
    if (event.action === "CLIENT_CANCELLED")
      return translate(
        "Klijent je otkazao termin",
        "Client cancelled the session",
      );
    if (event.action === "THERAPIST_CANCELLED")
      return translate(
        "Terapeut je otkazao termin",
        "Therapist cancelled the session",
      );
    if (event.to === "COMPLETED")
      return translate("Seansa je završena", "Session completed");
    if (event.to === "NO_SHOW")
      return translate("Zabilježen je nedolazak", "No-show recorded");
    if (event.to === "EXPIRED_PROVIDER")
      return translate(
        "Terapeut nije odgovorio na vrijeme",
        "Therapist did not respond in time",
      );
    if (event.to === "EXPIRED_CLIENT")
      return translate(
        "Klijent nije odgovorio na vrijeme",
        "Client did not respond in time",
      );
    return translate("Podaci termina su ažurirani", "Session details updated");
  }

  /** Objašnjava sačuvani datum prema radnji; previousDate nije uvijek datum prije pomjeranja. */
  function getHistoryTimeLabel(event: BookingEvent): string {
    // Kod predloga je sačuvan stari termin A, a kod prihvatanja već predloženi termin B.
    if (event.action === "ALTERNATIVE_PROPOSED")
      return translate("Prethodni termin", "Previous time");
    if (event.action === "ACCEPT_ALTERNATIVE")
      return translate("Prihvaćeni termin", "Accepted time");
    if (event.action === "CONFIRM")
      return translate("Potvrđeni termin", "Confirmed time");
    if (event.action === "DECLINE" || event.action === "REJECT_ALTERNATIVE")
      return translate("Odbijeni termin", "Declined time");
    if (
      event.action === "CLIENT_CANCELLED" ||
      event.action === "THERAPIST_CANCELLED"
    )
      return translate("Otkazani termin", "Cancelled time");
    return translate("Termin seanse", "Session time");
  }

  const waiting = ["REQUESTED", "ALTERNATIVE_PROPOSED"].includes(
    booking.status,
  );
  const cancellable = waiting || booking.status === "CONFIRMED";
  return (
    <article
      id={`booking-${booking.id}`}
      data-booking-id={booking.id}
      className={`booking-card server-booking-card${!therapistView ? " client-booking-card" : ""}${booking.status === "REQUESTED" ? " booking-needs-response" : ""}`}
    >
      {therapistView ? (
        <>
          <div className="booking-card-head">
            <h3>
              {therapistView ? booking.clientName : booking.therapistName}
            </h3>
            <StatusBadge status={booking.status} />
          </div>
          <p className="muted small">
            {locale === "en" ? booking.serviceNameEn : booking.serviceName}
          </p>
          <p className="booking-time-summary">
            <CalendarDays size={17} aria-hidden="true" />
            <time dateTime={booking.date}>
              {formatDate(booking.date, locale)}
            </time>{" "}
            · {timeLabel(booking.start)}–{timeLabel(booking.end)} ·{" "}
            {booking.duration} min · <Price value={booking.price} />
          </p>
          {therapistView && (
            <div className="booking-client-contact">
              <a href={`mailto:${booking.clientEmail}`}>
                <Mail size={14} aria-hidden="true" />
                {booking.clientEmail}
              </a>
              <a href={`tel:${booking.clientPhone}`}>
                <Phone size={14} aria-hidden="true" />
                {booking.clientPhone}
              </a>
              {booking.clientUserId && (
                <Link
                  href={`/dashboard/notes?client=${encodeURIComponent(booking.clientUserId)}`}
                >
                  {translate(
                    "Privatne bilješke za klijenta",
                    "Private notes for this client",
                  )}
                </Link>
              )}
            </div>
          )}
        </>
      ) : (
        <ClientBookingSummary booking={booking} />
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {booking.online && (
        <div className="online-booking-access">
          <p className="muted small">
            {translate(
              "Online seansa · pristup iz potvrđenog termina, 10 minuta prije početka.",
              "Online session · join from a confirmed booking, 10 minutes before the start.",
            )}
          </p>
          {booking.status === "CONFIRMED" && (
            <Link
              className="button button-primary button-sm"
              href={`/session/${encodeURIComponent(booking.id)}`}
            >
              {translate("Otvori online seansu", "Open online session")}
            </Link>
          )}
        </div>
      )}
      <div className="booking-actions">
        {therapistView && booking.status === "REQUESTED" && (
          <>
            <ActionButton
              pending={submitting && pendingAction === "confirm"}
              disabled={submitting}
              className="button button-primary"
              onClick={() => {
                void handleRespond("confirm");
              }}
            >
              {translate("Potvrdi", "Confirm")}
            </ActionButton>
            <ActionButton
              pending={submitting && pendingAction === "decline"}
              disabled={submitting}
              className="button button-outline"
              onClick={() => {
                void handleRespond("decline");
              }}
            >
              {translate("Odbij", "Decline")}
            </ActionButton>
          </>
        )}
        {therapistView &&
          (waiting ||
            (booking.status === "CONFIRMED" &&
              booking.series &&
              !hasStarted(booking))) && (
            <button
              disabled={submitting}
              className="button button-outline"
              onClick={() => setProposing(!proposing)}
            >
              {translate("Predloži drugi termin", "Propose another time")}
            </button>
          )}
        {!therapistView && booking.status === "ALTERNATIVE_PROPOSED" && (
          <>
            <ActionButton
              pending={submitting && pendingAction === "accept-alternative"}
              disabled={submitting}
              className="button button-primary"
              onClick={() => {
                void handleRespond("accept-alternative");
              }}
            >
              {translate("Prihvati termin", "Accept time")}
            </ActionButton>
            <ActionButton
              pending={submitting && pendingAction === "reject-alternative"}
              disabled={submitting}
              className="button button-outline"
              onClick={() => {
                void handleRespond("reject-alternative");
              }}
            >
              {translate("Odbij termin", "Reject time")}
            </ActionButton>
          </>
        )}
        {cancellable && (
          <ActionButton
            pending={submitting && pendingAction === "cancel"}
            disabled={submitting}
            className="button button-outline"
            onClick={() => {
              void handleRespond("cancel");
            }}
          >
            {translate("Otkaži termin", "Cancel session")}
          </ActionButton>
        )}
        {therapistView &&
          ["CONFIRMED", "COMPLETED", "NO_SHOW"].includes(booking.status) && (
            <>
              <ActionButton
                pending={submitting && pendingAction === "complete"}
                disabled={submitting}
                className="button button-outline"
                onClick={() => {
                  void handleRespond("complete");
                }}
              >
                {translate("Završena seansa", "Completed session")}
              </ActionButton>
              <ActionButton
                pending={submitting && pendingAction === "no-show"}
                disabled={submitting}
                className="button button-outline"
                onClick={() => {
                  void handleRespond("no-show");
                }}
              >
                {translate("Nedolazak", "No-show")}
              </ActionButton>
            </>
          )}
      </div>
      {booking.series && (
        <p className="recurring-booking-note">
          {booking.series.intervalDays === 7
            ? translate(
                "Stalni termin — svake sedmice",
                "Recurring — every week",
              )
            : translate(
                "Stalni termin — svake druge sedmice",
                "Recurring — every other week",
              )}
          {(booking.date !== booking.series.originalDate ||
            booking.start !== booking.series.originalStart) && (
            <>
              {" "}
              ·{" "}
              {translate(
                "Izmijenjena je samo ova seansa",
                "Only this session was changed",
              )}
            </>
          )}
          {!booking.series.active && (
            <> · {translate("Serija je zaustavljena", "Series stopped")}</>
          )}
        </p>
      )}
      {therapistView &&
        booking.status === "CONFIRMED" &&
        !hasStarted(booking) &&
        !booking.series && (
          <RecurringBookingForm booking={booking} onSaved={handleSeriesSaved} />
        )}
      {seriesSaved && (
        <SaveFeedback
          kind="success"
          title={translate(
            "Stalni termin je sačuvan.",
            "Recurring sessions saved.",
          )}
        />
      )}
      {submitting && (
        <PendingStatus>
          {translate("Čuvanje izmjene termina…", "Saving session changes…")}
        </PendingStatus>
      )}
      {proposing && (
        <form onSubmit={handlePropose} className="booking-action-panel">
          <label className="field">
            <span>{translate("Novi datum", "New date")}</span>
            <input
              name="date"
              type="date"
              min={dateKey()}
              max={addDays(dateKey(), 90)}
              defaultValue={booking.date}
              required
            />
          </label>
          <TimeField
            name="time"
            label={translate("Novo vrijeme", "New time")}
            defaultValue={timeLabel(booking.start)}
          />
          <ActionButton
            pending={submitting && pendingAction === "propose"}
            disabled={submitting}
            className="button button-primary"
          >
            {translate("Pošalji predlog", "Send proposal")}
          </ActionButton>
        </form>
      )}
      <details>
        <summary>{translate("Istorija zahtjeva", "Request history")}</summary>
        <ul className="booking-history-list">
          {booking.events.map((event, index) => (
            <li key={index}>
              <strong>{getHistoryLabel(event)}</strong>
              <time dateTime={event.at}>
                {new Intl.DateTimeFormat(
                  locale === "mne" ? "sr-Latn-ME" : "en-GB",
                  {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Podgorica",
                  },
                ).format(new Date(event.at))}
              </time>
              {event.previousDate && (
                <span>
                  {getHistoryTimeLabel(event)}:{" "}
                  {formatDate(event.previousDate, locale, true)} ·{" "}
                  {timeLabel(event.previousStart || 0)}
                </span>
              )}
              {event.reason && <span>{event.reason}</span>}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
