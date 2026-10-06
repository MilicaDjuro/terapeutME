// Lista zahtjeva i kartice statusa. Isti prikaz koriste klijent i terapeut.
"use client";
import { useState } from "react";
import Link from "next/link";
import { Clock3, CalendarDays, ShieldCheck, ArrowRight } from "lucide-react";
import type { Booking } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { BookingCard } from "./booking-card";
/** Razvrstava zahtjeve u čekanje, potvrđene i istoriju i prikazuje izabranu grupu. */
export function RequestsList({
  bookings,
  therapistView,
}: {
  bookings: Booking[];
  therapistView: boolean;
}) {
  const { translate } = useDemo();
  const [tab, setTab] = useState("pending");
  const pending = bookings.filter((booking) =>
    ["REQUESTED", "ALTERNATIVE_PROPOSED"].includes(booking.status),
  );
  const confirmed = bookings.filter(
    (booking) => booking.status === "CONFIRMED",
  );
  const closed = bookings.filter(
    (booking) =>
      !["REQUESTED", "ALTERNATIVE_PROPOSED", "CONFIRMED"].includes(
        booking.status,
      ),
  );
  let visible = pending;
  if (tab === "confirmed") {
    visible = confirmed;
  }
  if (tab === "closed") {
    visible = closed;
  }
  const sortedBookings = [...visible].sort((first, second) =>
    second.createdAt.localeCompare(first.createdAt),
  );
  return (
    <>
      <div className="stats-grid">
        <div>
          <Clock3 size={20} />
          <strong>{pending.length}</strong>
          <span>{translate("Zahtjeva na čekanju", "Pending requests")}</span>
        </div>
        <div>
          <CalendarDays size={20} />
          <strong>{confirmed.length}</strong>
          <span>
            {translate("Potvrđenih termina", "Confirmed appointments")}
          </span>
        </div>
        <div>
          <ShieldCheck size={20} />
          <strong>
            {
              bookings.filter(
                (candidateBooking) => candidateBooking.status === "COMPLETED",
              ).length
            }
          </strong>
          <span>{translate("Završenih seansi", "Completed sessions")}</span>
        </div>
      </div>
      <div
        className="request-tabs"
        aria-label={translate("Status zahtjeva", "Request status")}
      >
        {[
          {
            id: "pending",
            label: translate("Na čekanju", "Pending"),
            count: pending.length,
          },
          {
            id: "confirmed",
            label: translate("Potvrđeni", "Confirmed"),
            count: confirmed.length,
          },
          {
            id: "closed",
            label: translate("Istorija", "History"),
            count: closed.length,
          },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={tab === item.id ? "active" : ""}
            aria-pressed={tab === item.id}
          >
            {item.label}
            <span>{item.count}</span>
          </button>
        ))}
      </div>
      <div className="bookings-list">
        {visible.length ? (
          sortedBookings.map((candidateBooking) => (
            <BookingCard
              booking={candidateBooking}
              key={candidateBooking.id}
              therapistView={therapistView}
            />
          ))
        ) : (
          <div className="empty-state">
            <CalendarDays size={32} />
            <h2>
              {translate("Ovdje još nema zahtjeva.", "No requests here yet.")}
            </h2>
            <p>
              {translate(
                "Novi zahtjevi će se pojaviti u ovom pregledu.",
                "New requests will appear in this view.",
              )}
            </p>
            {!therapistView && (
              <Link href="/psychotherapy" className="button button-primary">
                {translate("Pronađi stručnjaka", "Find a professional")}
                <ArrowRight size={15} />
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}
