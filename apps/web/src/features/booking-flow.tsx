"use client";
import { useCallback, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  dateKey,
  timeLabel,
  availableStarts,
  addDays,
  type Booking,
} from "@terapeut/domain";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { useDirectory } from "@/lib/directory-context";
import { authErrorMessage } from "@/lib/auth-client";
import { requestBookingApi } from "@/lib/booking-client";
import {
  ActionButton,
  Avatar,
  Loading,
  Price,
  PendingStatus,
} from "@/components/ui";
import { DirectoryError } from "@/components/directory-error";
import { ServerCalendar } from "@/components/server-calendar";
import { WaitlistForm } from "./waitlist";

/** Vodi prijavljenog pacijenta kroz seansu i živi kalendar; konačnu dostupnost provjerava server. */
export function BookingFlow({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { translate } = useDemo();
  const {
    therapists,
    loading,
    error: directoryError,
    refresh,
  } = useDirectory();
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(dateKey());
  const [start, setStart] = useState<number | null>(null);
  const [waitlistStart, setWaitlistStart] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<Booking | null>(null);
  const inProgress = useRef(false);
  const handleUnavailable = useCallback(
    /** Briše izbor koji je drugi klijent u međuvremenu zauzeo. */
    function handleUnavailable() {
      setStart(null);
    },
    [],
  );
  const therapist = therapists.find((therapist) => therapist.id === id);
  const services =
    therapist?.services.filter((service) => service.active) || [];
  const service = services.find((service) => service.id === serviceId);
  /** Bira prvi budući početak iz radnog vremena; stvarnu zauzetost zatim učitava API. */
  function handleChooseService(serviceId: string) {
    setServiceId(serviceId);
    setWaitlistStart(null);
    setStart(null);
    setError("");
    const selectedService = services.find(
      (service) => service.id === serviceId,
    );
    if (!therapist || !selectedService) return;
    for (let day = 0; day <= 90; day++) {
      const candidate = addDays(dateKey(), day);
      if (
        availableStarts(therapist, candidate, selectedService.duration, [])
          .length
      ) {
        setDate(candidate);
        break;
      }
    }
  }
  /** Promjena dana poništava prethodni izbor vremena. */
  function handleChooseDate(date: string) {
    setDate(date);
    setWaitlistStart(null);
    setStart(null);
    setError("");
  }
  /** Šalje kontakt i izbor; ime, email, cijenu i trajanje server uzima iz provjerenih podataka. */
  async function handleSubmitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inProgress.current || !service || start === null) return;
    const form = new FormData(event.currentTarget);
    inProgress.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await requestBookingApi("bookings", {
        therapistId: id,
        serviceId: service.id,
        duration: String(service.duration),
        date,
        start: String(start),
        phone: String(form.get("phone") || ""),
      });
      if (!response.booking) throw new Error("Nedostaje rezervacija.");
      setSuccess(response.booking);
    } catch (failure) {
      setError(authErrorMessage(failure));
      setStart(null);
      void refresh();
    } finally {
      inProgress.current = false;
      setSubmitting(false);
    }
  }
  if (directoryError) return <DirectoryError />;
  if (loading || authLoading) return <Loading />;
  if (!therapist || !therapist.acceptingClients)
    return (
      <div className="container page-space">
        <h1>
          {translate("Zakazivanje nije dostupno.", "Booking unavailable.")}
        </h1>
      </div>
    );
  if (success)
    return (
      <div className="container page-space">
        <div className="success-card">
          <h1>{translate("Zahtjev je poslat.", "Request submitted.")}</h1>
          <p>
            {translate(
              "Termin je zauzet za druge klijente i čeka odgovor terapeuta.",
              "The time is held for you and awaits the therapist’s response.",
            )}
          </p>
          <div className="success-details">
            <strong>{therapist.name}</strong>
            <span>{success.date}</span>
            <strong>
              {timeLabel(success.start)}–{timeLabel(success.end)}
            </strong>
            <Price value={success.price} />
          </div>
          <Link href="/account#my-bookings" className="button button-primary">
            {translate("Pogledaj moje zahtjeve", "View my requests")}
          </Link>
        </div>
      </div>
    );
  return (
    <div className="container page-space">
      <Link className="back-link" href={`/therapist/${id}`}>
        {translate("Nazad na profil", "Back to profile")}
      </Link>
      <div className="booking-layout">
        <div className="booking-main">
          <h1>
            {translate(
              "Vrijeme za vaš razgovor.",
              "Time for your conversation.",
            )}
          </h1>
          <p>
            {translate(
              "Izaberite vrstu seanse, datum i slobodno vrijeme. Trajanje određuje terapeut.",
              "Choose a session type, date and available time. The therapist sets the duration.",
            )}
          </p>
          <section className="booking-section">
            <h2>{translate("Vrsta seanse", "Session type")}</h2>
            <div className="service-options">
              {services.map((service) => (
                <button
                  type="button"
                  key={service.id}
                  className={`service-option ${serviceId === service.id ? "selected" : ""}`}
                  onClick={() => handleChooseService(service.id)}
                  aria-pressed={serviceId === service.id}
                >
                  <span className="radio-mark">
                    {serviceId === service.id ? "✓" : ""}
                  </span>
                  <div>
                    <strong>
                      {service.name} · {service.duration} min
                    </strong>
                    <span>{translate("Uživo", "In person")}</span>
                  </div>
                  <strong>
                    <Price value={service.price} />
                  </strong>
                </button>
              ))}
            </div>
          </section>
          {service && (
            <ServerCalendar
              therapistId={id}
              duration={service.duration}
              date={date}
              onDate={handleChooseDate}
              start={start}
              onStart={setStart}
              onUnavailable={handleUnavailable}
              onWaitlistStart={
                user?.role === "CLIENT" ? setWaitlistStart : undefined
              }
            />
          )}
          {service && user?.role === "CLIENT" && (
            <WaitlistForm
              key={`${service.id}:${date}:${waitlistStart}`}
              therapistId={id}
              serviceId={service.id}
              duration={service.duration}
              price={service.price}
              date={date}
              selectedStart={waitlistStart}
            />
          )}
          {!user ? (
            <p>
              <Link href="/login" className="button button-primary">
                {translate("Prijavite se za zakazivanje", "Sign in to book")}
              </Link>
            </p>
          ) : user.role !== "CLIENT" ? (
            <p>
              {translate(
                "Termine zakazuju nalozi pacijenata.",
                "Patient accounts can book sessions.",
              )}
            </p>
          ) : (
            start !== null && (
              <section className="booking-section contact-section">
                <h2>{translate("Podaci za kontakt", "Contact details")}</h2>
                <form onSubmit={handleSubmitRequest}>
                  <label className="field">
                    <span>{translate("Ime i prezime", "Full name")}</span>
                    <input
                      value={`${user.firstName} ${user.lastName}`}
                      readOnly
                    />
                  </label>
                  <label className="field">
                    <span>Email</span>
                    <input value={user.email} readOnly />
                  </label>
                  <label className="field">
                    <span>{translate("Broj telefona", "Phone number")}</span>
                    <input
                      name="phone"
                      type="tel"
                      required
                      maxLength={30}
                      autoComplete="tel"
                      defaultValue={user.phone || ""}
                    />
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" required />
                    <span>
                      {translate(
                        "Razumijem da zahtjev čeka potvrdu i da terapeut vidi moje kontakt podatke.",
                        "I understand the request awaits confirmation and the therapist sees my contact details.",
                      )}
                    </span>
                  </label>
                  <ActionButton
                    pending={submitting}
                    className="button button-primary"
                    disabled={submitting}
                  >
                    {submitting
                      ? translate("Slanje…", "Sending…")
                      : translate("Pošalji zahtjev", "Send request")}
                  </ActionButton>
                  {submitting && (
                    <PendingStatus>
                      {translate(
                        "Slanje zahtjeva za termin…",
                        "Sending your booking request…",
                      )}
                    </PendingStatus>
                  )}
                </form>
              </section>
            )
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
        <aside className="booking-sidebar">
          <div className="booking-summary">
            <Avatar therapist={therapist} />
            <h2>{therapist.name}</h2>
            <p>{therapist.city}</p>
            <p>
              {translate(
                "Nema online plaćanja. Zahtjev odmah zauzima termin.",
                "No online payment. A request holds the time immediately.",
              )}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
