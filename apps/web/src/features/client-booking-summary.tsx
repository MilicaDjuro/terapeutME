"use client";
import Link from "next/link";
import { CalendarDays, Clock3, MapPin, UserRound } from "lucide-react";
import { timeLabel } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { useDirectory } from "@/lib/directory-context";
import type { ServerBooking } from "@/lib/booking-client";
import { formatDate } from "@/lib/format";
import { Avatar, Price, StatusBadge } from "@/components/ui";

/** Prikazuje terapeuta i sačuvane detalje klijentove seanse; javni katalog je samo dodatak kartici. */
export function ClientBookingSummary({ booking }: { booking: ServerBooking }) {
  const { translate, locale } = useDemo();
  const { therapists } = useDirectory();
  const therapist = therapists.find(
    (profile) => profile.id === booking.therapistId,
  );
  const profileUrl = `/therapist/${encodeURIComponent(booking.therapistId)}`;
  let explanation = "";
  if (booking.status === "REQUESTED")
    explanation = translate(
      "Zahtjev je poslat. Čekamo da terapeut potvrdi termin.",
      "Your request has been sent. We are waiting for the therapist to confirm.",
    );
  if (booking.status === "CONFIRMED")
    explanation = translate(
      "Termin je potvrđen. Ovdje možete pratiti njegove detalje.",
      "Your session is confirmed. You can review its details here.",
    );
  if (booking.status === "ALTERNATIVE_PROPOSED")
    explanation = translate(
      "Terapeut je predložio novi termin. Provjerite datum i vrijeme, pa prihvatite ili odbijte predlog.",
      "Your therapist proposed a new time. Review the date and time, then accept or decline the proposal.",
    );
  return (
    <>
      <div className="client-booking-heading">
        <div className="client-therapist-identity">
          {therapist ? (
            <Avatar therapist={therapist} />
          ) : (
            <span className="client-therapist-placeholder" aria-hidden="true">
              <UserRound size={25} />
            </span>
          )}
          <div>
            <span className="client-therapist-label">
              {translate("Vaš terapeut", "Your therapist")}
            </span>
            <h3>
              <Link href={profileUrl}>{booking.therapistName}</Link>
            </h3>
            {therapist && (
              <p>{locale === "en" ? therapist.titleEn : therapist.title}</p>
            )}
          </div>
        </div>
        <StatusBadge status={booking.status} />
      </div>
      <p className="client-session-name">
        {locale === "en" ? booking.serviceNameEn : booking.serviceName}
      </p>
      <dl className="client-booking-facts">
        <div>
          <dt>
            <CalendarDays size={15} aria-hidden="true" />
            {translate("Datum", "Date")}
          </dt>
          <dd>
            <time dateTime={booking.date}>
              {formatDate(booking.date, locale, true)}
            </time>
          </dd>
        </div>
        <div>
          <dt>
            <Clock3 size={15} aria-hidden="true" />
            {translate("Vrijeme", "Time")}
          </dt>
          <dd>
            {timeLabel(booking.start)}–{timeLabel(booking.end)}
          </dd>
        </div>
        <div>
          <dt>{translate("Trajanje", "Duration")}</dt>
          <dd>{booking.duration} min</dd>
        </div>
        <div>
          <dt>{translate("Cijena seanse", "Session price")}</dt>
          <dd>
            <Price value={booking.price} />
          </dd>
        </div>
      </dl>
      {booking.online && (
        <p className="client-practice-address">
          {translate(
            "Online · video poziv u aplikaciji",
            "Online · video call in the app",
          )}
        </p>
      )}
      {therapist && !booking.online && (
        <p className="client-practice-address">
          <MapPin size={16} aria-hidden="true" />
          <span>
            {therapist.city}
            {therapist.address ? ` · ${therapist.address}` : ""}
          </span>
        </p>
      )}
      {explanation && (
        <p
          className={`client-booking-explanation${booking.status === "ALTERNATIVE_PROPOSED" ? " client-booking-attention" : ""}`}
        >
          {explanation}
        </p>
      )}
      <div className="client-therapist-links">
        <Link href={profileUrl} className="text-link">
          {translate("Profil terapeuta", "Therapist profile")}
        </Link>
        {therapist?.acceptingClients &&
          !["REQUESTED", "ALTERNATIVE_PROPOSED", "CONFIRMED"].includes(
            booking.status,
          ) && (
            <Link href={`${profileUrl}/book`} className="text-link">
              {translate("Zakaži novi termin", "Book a new session")}
            </Link>
          )}
      </div>
    </>
  );
}
