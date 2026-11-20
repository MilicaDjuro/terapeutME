// Mali prikazi koji se ponavljaju: inicijali, cijena, verifikacija, kartica i status.
"use client";
import {
  Check,
  BadgeCheck,
  Clock3,
  MapPin,
  ArrowUpRight,
  CalendarDays,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
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
  const [failedImage, setFailedImage] = useState("");
  const photo = therapist.photos?.[0];
  /** Vraća inicijale ako fotografija više nije dostupna. */
  function handleImageError() {
    setFailedImage(photo?.url || "");
  }
  return (
    <div
      className={`avatar ${therapist.color} ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      {photo && photo.url !== failedImage ? (
        <img src={photo.url} alt="" onError={handleImageError} />
      ) : (
        <>
          <span>{therapist.initials}</span>
          <svg viewBox="0 0 100 100">
            <path d="M-10 90Q50 10 110 90M-10 100Q50 30 110 100" />
          </svg>
        </>
      )}
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
  const offersOnline = active.some((service) => service.online === true);
  const offersInPerson = active.some((service) => service.online !== true);
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
        {offersOnline
          ? offersInPerson
            ? translate("Uživo i online", "In person and online")
            : translate("Online", "Online")
          : translate("Uživo", "In person")}
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
/** Crta dekorativni spinner; tekst uz njega objašnjava korisniku šta se čeka. */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending: boolean;
  pendingText?: string;
}

/** Zadržava obična svojstva dugmeta; tokom zahtjeva dodaje spinner i blokira novi klik. */
export function ActionButton({
  pending,
  pendingText,
  disabled,
  children,
  ...buttonProperties
}: ActionButtonProps) {
  // Ostala svojstva su obični type, className i onClick koje dobija i HTML button.
  return (
    <button
      {...buttonProperties}
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending && <Spinner />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** Najavljuje čekanje čitaču ekrana; prikazuje se samo za aktivnu korisničku radnju. */
export function PendingStatus({ children }: { children: ReactNode }) {
  return (
    <p className="pending-status" role="status">
      <Spinner />
      {children}
    </p>
  );
}

/** Uspjeh prikazuje četiri sekunde; greške i čekanje traju dok ih roditelj ne promijeni. */
export function SaveFeedback({
  kind,
  title,
  children,
}: {
  kind: "pending" | "success" | "error";
  title: string;
  children?: ReactNode;
}) {
  const [visible, setVisible] = useState(true);

  // Timer utiče samo na poruku. Sačuvane podatke i stanje zahtjeva ne mijenjamo.
  useEffect(() => {
    setVisible(true);
    if (kind !== "success") return;
    /** Sakriva potvrdu poslije četiri sekunde, bez brisanja podataka iz formulara ili baze. */
    function hideSuccess() {
      setVisible(false);
    }
    const timer = window.setTimeout(hideSuccess, 4000);
    /** Uklanja stari timer pri novoj poruci ili zatvaranju komponente. */
    function stopTimer() {
      window.clearTimeout(timer);
    }
    return stopTimer;
  }, [kind, title]);

  if (!visible) return null;
  return (
    <div
      className={`save-feedback save-feedback-${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-atomic="true"
    >
      {kind === "pending" ? (
        <Spinner />
      ) : kind === "success" ? (
        <CircleCheck size={22} aria-hidden="true" />
      ) : (
        <CircleAlert size={22} aria-hidden="true" />
      )}
      <div>
        <strong>{title}</strong>
        {kind !== "success" && children && <p>{children}</p>}
      </div>
    </div>
  );
}

/** Prikazuje prepoznatljiv loader profila; ukrasne linije nijesu stvarni korisnički podaci. */
export function ProfileLoading() {
  const { translate } = useDemo();
  return (
    <div className="profile-loading" role="status" aria-live="polite">
      <div className="profile-loading-title">
        <Spinner />
        <strong>{translate("Učitavanje profila…", "Loading profile…")}</strong>
      </div>
      <p>
        {translate(
          "Pripremamo podatke profila. Molimo sačekajte.",
          "Preparing profile details. Please wait.",
        )}
      </p>
      <div className="profile-loading-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/** Prikazuje poruku i indikator dok podaci ili stranica nijesu spremni. */
export function Loading() {
  return (
    <div className="loading" role="status">
      <Spinner />
      Učitavanje / Loading…
    </div>
  );
}
