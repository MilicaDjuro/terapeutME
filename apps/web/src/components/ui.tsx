// Mali prikazi koji se ponavljaju: inicijali, cijena, verifikacija, kartica i status.
"use client";
import {
  Check,
  BadgeCheck,
  Clock3,
  MapPin,
  ArrowUpRight,
  CalendarDays,
} from "lucide-react";
import Link from "next/link";
import type { BookingStatus, Therapist } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
/** Prikazuje inicijale terapeuta na obojenoj podlozi; dekoracija nema poslovnu logiku. */
export function Avatar({
  therapist,
  large = false,
}: {
  therapist: Therapist;
  large?: boolean;
}) {
  return (
    <div
      className={`avatar ${therapist.color} ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      <span>{therapist.initials}</span>
      <svg viewBox="0 0 100 100">
        <path d="M-10 90Q50 10 110 90M-10 100Q50 30 110 100" />
      </svg>
    </div>
  );
}
/** Prikazuje admin oznaku verifikacije; neverifikovan profil takođe može biti javan. */
export function Verified({ therapist }: { therapist: Therapist }) {
  const { translate } = useDemo();
  return therapist.verified ? (
    <span className="verified">
      <BadgeCheck size={15} />
      {translate("Verifikovan profil", "Verified profile")}
    </span>
  ) : (
    <span className="unverified">
      {translate("Neverifikovan profil", "Unverified profile")}
    </span>
  );
}
/** Prikazuje cijenu u eurima ili Na upit kada cijena nije unesena. */
export function Price({ value }: { value: number | null }) {
  const { translate } = useDemo();
  return (
    <>
      {value === null
        ? translate("Na upit", "On request")
        : new Intl.NumberFormat("sr-Latn-ME", {
            style: "currency",
            currency: "EUR",
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }).format(value)}
    </>
  );
}
/** Prikazuje sažetak javnog profila sa linkovima ka profilu i izboru termina. */
export function TherapistCard({ therapist }: { therapist: Therapist }) {
  const { locale, translate } = useDemo();
  const active = therapist.services.filter((service) => service.active);
  const prices = active
    .map((service) => service.price)
    .filter((price): price is number => price !== null);
  return (
    <article className="therapist-card">
      <div className="card-top">
        <Avatar therapist={therapist} />
        <Verified therapist={therapist} />
      </div>
      <Link href={`/therapist/${therapist.id}`} className="card-name">
        {therapist.name}
        <ArrowUpRight size={19} />
      </Link>
      <p className="card-title">
        {locale === "mne" ? therapist.title : therapist.titleEn}
      </p>
      <div className="card-location">
        <MapPin size={14} />
        {therapist.city}
        <span className="dot" />
        {translate("Uživo", "In person")}
      </div>
      <div className="tags">
        {(locale === "mne" ? therapist.approaches : therapist.approachesEn).map(
          (approach) => (
            <span key={approach}>{approach}</span>
          ),
        )}
      </div>
      <p className="card-bio">
        {locale === "mne" ? therapist.bio : therapist.bioEn}
      </p>
      <div className="card-bottom">
        <div>
          <span className="tiny-label">
            {translate("Cijena seanse", "Session price")}
          </span>
          <strong>
            {prices.length ? (
              <>
                {translate("od", "from")} <Price value={Math.min(...prices)} />
              </>
            ) : (
              <Price value={null} />
            )}
          </strong>
        </div>
        <Link
          className="button button-soft button-sm"
          href={`/therapist/${therapist.id}/book`}
        >
          <CalendarDays size={15} />
          {translate("Pogledaj termine", "View times")}
        </Link>
      </div>
    </article>
  );
}
// Nazivi polja su čitljiviji od niza gdje treba pamtiti šta znači svaka pozicija.
interface StatusLabel {
  mne: string;
  en: string;
  color: string;
}
const labels: Record<BookingStatus, StatusLabel> = {
  REQUESTED: {
    mne: "Čeka terapeuta",
    en: "Awaiting therapist",
    color: "pending",
  },
  ALTERNATIVE_PROPOSED: {
    mne: "Čeka klijenta",
    en: "Awaiting client",
    color: "alternative",
  },
  CONFIRMED: { mne: "Potvrđeno", en: "Confirmed", color: "confirmed" },
  DECLINED: { mne: "Odbijeno", en: "Declined", color: "closed" },
  CANCELLED: { mne: "Otkazano", en: "Cancelled", color: "closed" },
  EXPIRED_PROVIDER: {
    mne: "Bez odgovora terapeuta",
    en: "No therapist response",
    color: "expired",
  },
  EXPIRED_CLIENT: {
    mne: "Bez odgovora klijenta",
    en: "No client response",
    color: "expired",
  },
  COMPLETED: { mne: "Završena seansa", en: "Completed", color: "completed" },
  NO_SHOW: { mne: "Nedolazak", en: "No-show", color: "closed" },
};
/** Pretvara status zahtjeva u lokalizovanu oznaku sa tekstom, ikonicom i bojom. */
export function StatusBadge({ status }: { status: BookingStatus }) {
  const { translate } = useDemo();
  const label = labels[status];
  return (
    <span className={`status ${label.color}`}>
      {status === "CONFIRMED" || status === "COMPLETED" ? (
        <Check size={13} />
      ) : (
        <Clock3 size={13} />
      )}
      {translate(label.mne, label.en)}
    </span>
  );
}
/** Prikazuje poruku i indikator dok podaci ili stranica nijesu spremni. */
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Učitavanje / Loading…
    </div>
  );
}
