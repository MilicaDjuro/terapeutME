// Klijentski tok: usluga → datum/vrijeme → kontakt → novi zahtjev na čekanju.
"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Info,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import {
  addDays,
  availableStarts,
  Booking,
  dateKey,
  timeLabel,
} from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { errorText } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Avatar, Loading, Price, Verified } from "@/components/ui";
import { CalendarPicker } from "@/components/calendar-picker";
/** Vodi klijenta kroz uslugu, kalendar i kontakt, pa prikazuje rezultat slanja. */
export function BookingFlow({ id }: { id: string }) {
  const { state, request, translate, locale } = useDemo();
  const [serviceId, setServiceId] = useState("");
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<Booking | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (!state) return <Loading />;
  const therapist = state.therapists.find(
    (candidateTherapist) =>
      candidateTherapist.id === id && candidateTherapist.active,
  );
  if (!therapist || !therapist.acceptingClients)
    return (
      <div className="container page-space empty-state">
        <h1>
          {translate("Zakazivanje nije dostupno.", "Booking unavailable.")}
        </h1>
        <Link className="button button-primary" href="/psychotherapy">
          {translate("Pronađi stručnjaka", "Find a professional")}
        </Link>
      </div>
    );
  const services = therapist.services.filter(
    (candidateService) => candidateService.active,
  );
  const service = services.find(
    (candidateService) => candidateService.id === serviceId,
  );
  /** Pamti uslugu, uklanja raniji izbor vremena i pronalazi prvi dan sa slobodnim terminom. */
  function chooseService(id: string) {
    setServiceId(id);
    setSelectedStart(null);
    setError("");
    const selectedService = services.find((service) => service.id === id);
    if (!selectedService || !therapist || !state) {
      return;
    }
    for (let i = 0; i <= 90; i++) {
      const date = addDays(dateKey(), i);
      if (
        availableStarts(
          therapist,
          date,
          selectedService.duration,
          state.bookings,
        ).length
      ) {
        setSelectedDate(date);
        break;
      }
    }
  }
  /** Pamti datum i briše vrijeme jer prethodno vrijeme pripada drugom danu. */
  function chooseDate(date: string) {
    setSelectedDate(date);
    setSelectedStart(null);
    setError("");
  }

  /** Pamti izabrani početak seanse i uklanja prethodnu poruku greške. */
  function chooseStart(start: number) {
    setSelectedStart(start);
    setError("");
  }

  /** Čita formular, poziva request iz demo omotača i prikazuje uspjeh ili grešku. */
  function handleSubmitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!service || selectedStart === null) {
      return;
    }
    setError("");
    setSubmitting(true);
    const data = new FormData(event.currentTarget);
    try {
      const booking = request(id, {
        serviceId: service.id,
        date: selectedDate,
        start: selectedStart,
        clientName: String(data.get("name")),
        clientEmail: String(data.get("email")),
        clientPhone: String(data.get("phone")),
      });
      setSuccess(booking);
    } catch (error) {
      setError(errorText(error, translate));
    } finally {
      setSubmitting(false);
    }
  }

  if (success)
    return (
      <div className="container page-space">
        <div className="success-card">
          <div className="success-icon">
            <Check size={30} />
          </div>
          <span className="eyebrow">
            {translate("PRVI KORAK JE NAPRAVLJEN", "YOUR FIRST STEP IS TAKEN")}
          </span>
          <h1>{translate("Zahtjev je poslat.", "Request submitted.")}</h1>
          <p>
            {translate(
              "Termin je zauzet i čeka odgovor terapeuta.",
              "Your time is held and awaits your therapist’s response.",
            )}
          </p>
          <div className="success-details">
            <strong>{therapist.name}</strong>
            <span>
              {locale === "mne" ? success.serviceName : success.serviceNameEn}
            </span>
            <span className="capitalize">
              {formatDate(success.date, locale, true)}
            </span>
            <strong>
              {timeLabel(success.start)}–{timeLabel(success.end)}
            </strong>
            <span>
              <Price value={success.price} />
            </span>
          </div>
          <p className="demo-explanation">
            {translate(
              "Demo: zahtjev je sačuvan samo u ovom browseru. Email nije poslat. Odgovor možete isprobati u pregledu za terapeuta.",
              "Demo: your request is saved only in this browser. No email was sent. Try responding in the therapist dashboard.",
            )}
          </p>
          <Link href="/dashboard" className="button button-primary">
            {translate("Pogledaj moje zahtjeve", "View my requests")}
            <ArrowRight size={17} />
          </Link>
          <Link href={`/therapist/${id}`} className="text-link">
            {translate("Nazad na profil", "Back to profile")}
          </Link>
        </div>
      </div>
    );
  return (
    <div className="container page-space">
      <Link href={`/therapist/${id}`} className="back-link">
        <ArrowLeft size={16} />
        {translate("Nazad na profil", "Back to profile")}
      </Link>
      <div className="booking-layout">
        <div className="booking-main">
          <div className="page-intro">
            <span className="eyebrow">
              {translate("VAŠ SLJEDEĆI KORAK", "YOUR NEXT STEP")}
            </span>
            <h1>
              {translate(
                "Vrijeme za vaš razgovor.",
                "Time for your conversation.",
              )}
            </h1>
            <p>
              {translate(
                "Izaberite uslugu i termin. Terapeut će potvrditi zahtjev ili predložiti drugo vrijeme.",
                "Choose a service and time. Your therapist will confirm or propose another time.",
              )}
            </p>
          </div>
          <div className="booking-steps">
            <span className="active">
              <i>1</i>
              {translate("Usluga", "Service")}
            </span>
            <div />
            <span className={service ? "active" : ""}>
              <i>2</i>
              {translate("Termin", "Time")}
            </span>
            <div />
            <span className={selectedStart !== null ? "active" : ""}>
              <i>3</i>
              {translate("Vaši podaci", "Your details")}
            </span>
          </div>
          <section className="booking-section">
            <div className="numbered-heading">
              <span>01</span>
              <h2>{translate("Izaberite uslugu", "Choose a service")}</h2>
            </div>
            <div className="service-options">
              {services.map((candidateService) => (
                <button
                  key={candidateService.id}
                  onClick={() => chooseService(candidateService.id)}
                  className={`service-option ${serviceId === candidateService.id ? "selected" : ""}`}
                  aria-pressed={serviceId === candidateService.id}
                >
                  <span className="radio-mark">
                    {serviceId === candidateService.id && <Check size={12} />}
                  </span>
                  <div>
                    <strong>
                      {locale === "mne"
                        ? candidateService.name
                        : candidateService.nameEn}
                    </strong>
                    <span>
                      <Clock3 size={13} />
                      {candidateService.duration} min ·{" "}
                      {translate("Uživo", "In person")}
                    </span>
                  </div>
                  <strong>
                    <Price value={candidateService.price} />
                  </strong>
                </button>
              ))}
            </div>
            {!services.length && (
              <p className="muted">
                {translate(
                  "Terapeut još nije dodao usluge.",
                  "This therapist has not added any services yet.",
                )}
              </p>
            )}
          </section>
          {service && (
            <section className="booking-section">
              <div className="numbered-heading">
                <span>02</span>
                <h2>
                  {translate(
                    "Izaberite datum i vrijeme",
                    "Choose a date and time",
                  )}
                </h2>
              </div>
              <CalendarPicker
                key={service.id}
                therapist={therapist}
                duration={service.duration}
                selectedDate={selectedDate}
                onDate={chooseDate}
                selectedStart={selectedStart}
                onStart={chooseStart}
              />
            </section>
          )}
          {service && selectedStart !== null && (
            <section className="booking-section contact-section">
              <div className="numbered-heading">
                <span>03</span>
                <h2>{translate("Podaci za kontakt", "Contact details")}</h2>
              </div>
              <div className="info-note">
                <Info size={17} />
                <span>
                  {translate(
                    "Terapeut vidi vaše ime i prezime, email i broj telefona. Detalje susreta dogovarate direktno, mimo platforme.",
                    "Your therapist sees your full name, email and phone number. Arrange session details directly, outside the platform.",
                  )}
                </span>
              </div>
              <form onSubmit={handleSubmitRequest}>
                <label className="field">
                  <span>{translate("Ime i prezime", "Full name")}</span>
                  <input
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                    defaultValue="Demo klijent"
                  />
                </label>
                <div className="form-row">
                  <label className="field">
                    <span>Email</span>
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      defaultValue="klijent@example.test"
                    />
                  </label>
                  <label className="field">
                    <span>{translate("Broj telefona", "Phone number")}</span>
                    <input
                      name="phone"
                      type="tel"
                      required
                      autoComplete="tel"
                      defaultValue="+382 67 000 000"
                    />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input type="checkbox" required />
                  <span>
                    {translate(
                      "Razumijem da zahtjev čeka potvrdu i da su kontakt podaci vidljivi terapeutu.",
                      "I understand this request awaits confirmation and my contact details are visible to the therapist.",
                    )}
                  </span>
                </label>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="submit-row">
                  <span>
                    <ShieldCheck size={14} />
                    {translate(
                      "Koristite probne podatke u demo verziji.",
                      "Use sample details in this demo.",
                    )}
                  </span>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="button button-primary"
                  >
                    {translate("Pošalji zahtjev", "Send request")}
                    <ArrowRight size={17} />
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
        <aside className="booking-sidebar">
          <div className="booking-summary">
            <Avatar therapist={therapist} />
            <h2>{therapist.name}</h2>
            <p>{locale === "mne" ? therapist.title : therapist.titleEn}</p>
            <Verified therapist={therapist} />
            <div className="summary-address">
              <MapPin size={16} />
              <div>
                <strong>{therapist.city}</strong>
                <p>{therapist.address}</p>
              </div>
            </div>
            {service && (
              <div className="selected-summary">
                <span className="tiny-label">
                  {translate("VAŠ IZBOR", "YOUR SELECTION")}
                </span>
                <strong>
                  {locale === "mne" ? service.name : service.nameEn}
                </strong>
                <span>
                  <Clock3 size={14} />
                  {service.duration} min
                </span>
                {selectedStart !== null && (
                  <>
                    <span className="capitalize">
                      <CalendarDays size={14} />
                      {formatDate(selectedDate, locale)}
                    </span>
                    <strong>
                      {timeLabel(selectedStart)}–
                      {timeLabel(selectedStart + service.duration)}
                    </strong>
                  </>
                )}
                <strong>
                  <Price value={service.price} />
                </strong>
              </div>
            )}
            <div className="summary-note">
              <Info size={16} />
              <span>
                {translate(
                  "Nema online plaćanja. Cijenu i način plaćanja dogovarate sa terapeutom.",
                  "No online payments. Discuss price and payment directly with your therapist.",
                )}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
