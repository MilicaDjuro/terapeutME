// Jedan zahtjev. Ovdje su dugmad i poruke; dozvoljene promjene stanja provjerava domain paket.
"use client";
import { useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Clock3,
  MapPin,
  Mail,
  Phone,
  ArrowRight,
  X,
  History,
} from "lucide-react";
import {
  Booking,
  BookingAction,
  hasStarted,
  timeLabel,
} from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { errorText } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { StatusBadge, Price } from "@/components/ui";
import { CalendarPicker } from "@/components/calendar-picker";
/** Prikazuje jedan zahtjev i akcije koje odgovaraju njegovom stanju i demo ulozi. */
export function BookingCard({
  booking,
  therapistView = false,
}: {
  booking: Booking;
  therapistView?: boolean;
}) {
  const { state, translate, locale, respond, propose } = useDemo();
  const therapist = state?.therapists.find(
    (profile) => profile.id === booking.therapistId,
  );
  const [panel, setPanel] = useState<"cancel" | "decline" | "propose" | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState(false);
  const [date, setDate] = useState(booking.date);
  const [start, setStart] = useState<number | null>(null);
  /** Pokreće odgovor na zahtjev i prikazuje grešku ako promjena više nije dozvoljena. */
  function handleResponse(action: BookingAction) {
    try {
      const actor = therapistView ? "therapist" : "client";
      respond(booking.id, action, reason, actor);
      setPanel(null);
      setError("");
    } catch (error) {
      setError(errorText(error, translate));
    }
  }

  /** Otvara izbor drugog termina i uklanja prethodno izabrani početak. */
  function openProposal() {
    setPanel("propose");
    setStart(null);
    setError("");
  }

  /** Pamti datum predloga i briše vrijeme koje je pripadalo prethodnom datumu. */
  function chooseProposalDate(date: string) {
    setDate(date);
    setStart(null);
  }

  /** Šalje izabrani predlog B; tek provjeren rezultat zatvara formular. */
  function submitProposal() {
    if (start === null) {
      return;
    }
    try {
      propose(booking.id, date, start);
      setPanel(null);
      setError("");
    } catch (error) {
      setError(errorText(error, translate));
    }
  }

  /** Prema otvorenom panelu potvrđuje odbijanje ili otkazivanje, uz opcionalan razlog. */
  function confirmCancellationOrDecline() {
    if (panel === "decline") {
      handleResponse("decline");
    }
    if (panel === "cancel") {
      handleResponse("cancel");
    }
  }

  if (!therapist) {
    return null;
  }
  const cancellable = [
    "REQUESTED",
    "ALTERNATIVE_PROPOSED",
    "CONFIRMED",
  ].includes(booking.status);
  return (
    <article
      className={`booking-card ${booking.status.startsWith("EXPIRED") ? "unanswered-card" : ""}`}
    >
      <div className="booking-card-head">
        <div>
          <span className="tiny-label">
            {locale === "mne" ? booking.serviceName : booking.serviceNameEn}
          </span>
          <h3>{therapistView ? booking.clientName : therapist.name}</h3>
        </div>
        <StatusBadge status={booking.status} />
      </div>
      <div className="booking-meta">
        <span className="capitalize">
          <CalendarDays size={15} />
          {formatDate(booking.date, locale)}
        </span>
        <span>
          <Clock3 size={15} />
          {timeLabel(booking.start)}–{timeLabel(booking.end)}
        </span>
        <span>
          <MapPin size={15} />
          {therapist.city}
        </span>
        <span>
          <Price value={booking.price} />
        </span>
      </div>
      {therapistView && (
        <div className="client-contact">
          <a href={`mailto:${booking.clientEmail}`}>
            <Mail size={14} />
            {booking.clientEmail}
          </a>
          <a href={`tel:${booking.clientPhone.replace(/[^+\d]/g, "")}`}>
            <Phone size={14} />
            {booking.clientPhone}
          </a>
        </div>
      )}
      {booking.status === "ALTERNATIVE_PROPOSED" && (
        <p className="alternative-note">
          {therapistView
            ? translate(
                "Novi termin je zauzet i čeka prihvatanje klijenta. Prethodni termin je oslobođen.",
                "The new time is held and awaits client acceptance. The previous time has been released.",
              )
            : translate(
                "Terapeut je predložio ovaj novi termin i sačuvao ga za vas. Prihvatite ili odbijte predlog.",
                "Your therapist proposed this new time and is holding it for you. Accept or decline the proposal.",
              )}
        </p>
      )}
      {booking.status.startsWith("EXPIRED") && (
        <p className="alternative-note">
          {booking.status === "EXPIRED_PROVIDER"
            ? translate(
                "Vrijeme početka je prošlo bez odgovora terapeuta. Ovo nije nedolazak klijenta.",
                "The start time passed without a therapist response. This is not a client no-show.",
              )
            : translate(
                "Predlog nije prihvaćen do početka termina. Ovo nije nedolazak klijenta.",
                "The proposal was not accepted before the start time. This is not a client no-show.",
              )}
        </p>
      )}
      <div className="booking-actions">
        {therapistView && booking.status === "REQUESTED" && (
          <>
            <button
              className="button button-primary button-sm"
              onClick={() => handleResponse("confirm")}
            >
              {translate("Potvrdi", "Confirm")}
            </button>
            <button
              className="button button-outline button-sm"
              onClick={openProposal}
            >
              {translate("Predloži drugi termin", "Propose another time")}
            </button>
            <button
              className="button button-quiet button-sm"
              onClick={() => setPanel("decline")}
            >
              {translate("Odbij", "Decline")}
            </button>
          </>
        )}
        {therapistView && booking.status === "ALTERNATIVE_PROPOSED" && (
          <button
            className="button button-outline button-sm"
            onClick={openProposal}
          >
            {translate("Promijeni predlog", "Change proposal")}
          </button>
        )}
        {!therapistView && booking.status === "ALTERNATIVE_PROPOSED" && (
          <>
            <button
              className="button button-primary button-sm"
              onClick={() => handleResponse("accept-alternative")}
            >
              {translate("Prihvati termin", "Accept time")}
            </button>
            <button
              className="button button-outline button-sm"
              onClick={() => handleResponse("reject-alternative")}
            >
              {translate("Odbij predlog", "Decline proposal")}
            </button>
          </>
        )}
        {therapistView &&
          ["CONFIRMED", "COMPLETED", "NO_SHOW"].includes(booking.status) &&
          hasStarted(booking) && (
            <>
              <button
                className="button button-soft button-sm"
                disabled={booking.status === "COMPLETED"}
                onClick={() => handleResponse("complete")}
              >
                {translate("Seansa završena", "Session completed")}
              </button>
              <button
                className="button button-outline button-sm"
                disabled={booking.status === "NO_SHOW"}
                onClick={() => handleResponse("no-show")}
              >
                {translate("Nedolazak", "No-show")}
              </button>
            </>
          )}
        {cancellable && (
          <button
            className="button button-quiet button-sm cancel-button"
            onClick={() => setPanel("cancel")}
          >
            {booking.status === "CONFIRMED"
              ? translate("Otkaži termin", "Cancel appointment")
              : translate("Povuci zahtjev", "Withdraw request")}
          </button>
        )}
        {!therapistView && (
          <Link href={`/therapist/${therapist.id}`} className="text-link small">
            {translate("Profil", "Profile")}
            <ArrowRight size={13} />
          </Link>
        )}
        <button
          className="history-toggle"
          onClick={() => setHistory(!history)}
          aria-expanded={history}
        >
          <History size={14} />
          {translate("Istorija", "History")}
        </button>
      </div>
      {panel && (
        <div className="booking-action-panel">
          <div className="panel-heading">
            <h4>
              {panel === "propose"
                ? translate("Predložite drugo vrijeme", "Propose another time")
                : panel === "decline"
                  ? translate("Odbijanje zahtjeva", "Decline request")
                  : translate("Otkazivanje", "Cancellation")}
            </h4>
            <button
              className="icon-button"
              aria-label={translate("Zatvori", "Close")}
              onClick={() => setPanel(null)}
            >
              <X size={17} />
            </button>
          </div>
          {panel === "propose" ? (
            <>
              <p className="muted">
                {translate(
                  "Novi termin se zauzima odmah, a trenutni oslobađa. Klijent zatim prihvata ili odbija predlog.",
                  "The new time is held immediately and the current time released. The client then accepts or declines.",
                )}
              </p>
              <CalendarPicker
                therapist={therapist}
                duration={booking.duration}
                selectedDate={date}
                onDate={chooseProposalDate}
                selectedStart={start}
                onStart={setStart}
                ignoreBookingId={booking.id}
              />
              <button
                className="button button-primary button-sm"
                disabled={
                  start === null ||
                  (date === booking.date && start === booking.start)
                }
                onClick={submitProposal}
              >
                {translate("Pošalji predlog", "Send proposal")}
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span>
                  {translate("Razlog (opcionalno)", "Reason (optional)")}
                </span>
                <textarea
                  rows={2}
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <p className="muted">
                {translate(
                  "Termin će ponovo biti dostupan ako je još u budućnosti.",
                  "The time will become available again if it is still in the future.",
                )}
              </p>
              <button
                className="button button-danger button-sm"
                onClick={confirmCancellationOrDecline}
              >
                {translate("Potvrdi", "Confirm")}
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {history && (
        <ol className="event-history">
          {booking.events.map((event, i) => (
            <li key={i}>
              <span>
                {new Intl.DateTimeFormat(
                  locale === "mne" ? "sr-Latn-ME" : "en-GB",
                  {
                    timeZone: "Europe/Podgorica",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                ).format(new Date(event.at))}
              </span>
              <span>
                {event.actor === "client"
                  ? translate("Klijent", "Client")
                  : event.actor === "therapist"
                    ? translate("Terapeut", "Therapist")
                    : translate("Sistem", "System")}
              </span>
              <StatusBadge status={event.to} />
              {event.previousDate && (
                <small>
                  {translate("Prethodni termin:", "Previous time:")}{" "}
                  {formatDate(event.previousDate, locale)} ·{" "}
                  {timeLabel(event.previousStart!)}–
                  {timeLabel(event.previousStart! + booking.duration)}
                </small>
              )}
              {event.reason && <small>{event.reason}</small>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
