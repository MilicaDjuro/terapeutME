// Javni profil stručnjaka. Prikazuje podatke i usluge, bez izmjene rasporeda.
"use client";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  MapPin,
  Languages,
  GraduationCap,
  Check,
} from "lucide-react";
import { useDemo } from "@/lib/demo-context";
import { Avatar, ProfileLoading, Price, Verified } from "@/components/ui";
import { useDirectory } from "@/lib/directory-context";
import { DirectoryError } from "@/components/directory-error";
import { ProfileViewTracker } from "@/components/profile-view-tracker";
/** Prikazuje javni profil, usluge i mogućnost zakazivanja za aktivnog terapeuta. */
export function TherapistProfile({ id }: { id: string }) {
  const { translate, locale } = useDemo();
  const { therapists, loading, error } = useDirectory();
  if (error) return <DirectoryError />;
  if (loading)
    return (
      <div className="container page-space">
        <ProfileLoading />
      </div>
    );
  const therapist = therapists.find(
    (therapist) => therapist.id === id && therapist.active,
  );
  if (!therapist)
    return (
      <div className="container page-space empty-state">
        <h1>{translate("Profil nije dostupan.", "Profile unavailable.")}</h1>
        <Link className="button button-primary" href="/psychotherapy">
          {translate("Pronađi stručnjaka", "Find a professional")}
        </Link>
      </div>
    );
  return (
    <div className="container page-space">
      <ProfileViewTracker therapistId={therapist.id} />
      <Link href="/psychotherapy" className="back-link">
        <ArrowLeft size={16} />
        {translate("Svi stručnjaci", "All professionals")}
      </Link>
      <div className="profile-layout">
        <div className="profile-main">
          <div className="profile-identity">
            <Avatar therapist={therapist} large />
            <div>
              <Verified therapist={therapist} />
              <h1>{therapist.name}</h1>
              <p>{locale === "mne" ? therapist.title : therapist.titleEn}</p>
              <span className="card-location">
                <MapPin size={15} />
                {therapist.city}
                <span className="dot" />
                {translate("Susreti uživo", "In-person sessions")}
              </span>
            </div>
          </div>
          <div className="profile-section">
            <h2>{translate("O meni", "About me")}</h2>
            <p>{locale === "mne" ? therapist.bio : therapist.bioEn}</p>
          </div>
          {!!therapist.photos?.length && (
            <section className="profile-section">
              <h2>{translate("Fotografije", "Photos")}</h2>
              <div className="public-photo-gallery">
                {therapist.photos.map((photo) => (
                  <a
                    key={photo.id}
                    href={photo.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={photo.url}
                      alt={translate(
                        `Fotografija profila ${therapist.name}`,
                        `Profile photo of ${therapist.name}`,
                      )}
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            </section>
          )}
          <div className="profile-section">
            <h2>{translate("Pristup radu", "My approach")}</h2>
            <div className="tags tags-lg">
              {(locale === "mne"
                ? therapist.approaches
                : therapist.approachesEn
              ).map((approach) => (
                <span key={approach}>{approach}</span>
              ))}
            </div>
          </div>
          <div className="profile-section">
            <h2>{translate("Usluge i trajanje", "Services and duration")}</h2>
            <div className="profile-services">
              {therapist.services
                .filter((candidateService) => candidateService.active)
                .map((candidateService) => (
                  <div key={candidateService.id}>
                    <span className="service-icon">
                      <CalendarDays size={20} />
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
                    <strong className="service-price">
                      <Price value={candidateService.price} />
                    </strong>
                  </div>
                ))}
            </div>
          </div>
          <div className="profile-section">
            <h2>
              {translate("Obrazovanje i jezici", "Education and languages")}
            </h2>
            <p className="icon-line">
              <GraduationCap size={19} />
              <span className="preserve-lines">
                {locale === "mne" ? therapist.education : therapist.educationEn}
              </span>
            </p>
            <p className="icon-line">
              <Languages size={19} />
              {therapist.languages.join(" · ")}
            </p>
          </div>
        </div>
        <aside className="profile-sidebar">
          <div className="booking-summary">
            <span className="eyebrow">
              {translate(
                "PROSTOR ZA VAŠ RAZGOVOR",
                "SPACE FOR YOUR CONVERSATION",
              )}
            </span>
            <h2>
              {translate("Napravite prvi korak.", "Take the first step.")}
            </h2>
            <p>
              {translate(
                "Izaberite uslugu i vrijeme koje vam odgovara.",
                "Choose a service and a time that works for you.",
              )}
            </p>
            <span className="accepting">
              <span className="eyebrow-dot" />
              {therapist.acceptingClients
                ? translate("Prima nove klijente", "Accepting new clients")
                : translate(
                    "Trenutno ne prima klijente",
                    "Not currently accepting clients",
                  )}
            </span>
            {therapist.acceptingClients ? (
              <Link
                href={`/therapist/${therapist.id}/book`}
                className="button button-primary full-width"
              >
                {translate("Izaberi termin", "Choose a time")}
                <ArrowRight size={17} />
              </Link>
            ) : (
              <span className="muted">
                {translate(
                  "Zakazivanje trenutno nije dostupno.",
                  "Booking is currently unavailable.",
                )}
              </span>
            )}
            <div className="summary-note">
              <Check size={15} />
              <span>
                {translate(
                  "Zahtjev čeka potvrdu terapeuta. Plaćanje se dogovara direktno.",
                  "Requests await therapist confirmation. Arrange payment directly.",
                )}
              </span>
            </div>
            <div className="summary-address">
              <MapPin size={17} />
              <div>
                <strong>{translate("Lokacija", "Location")}</strong>
                <p>{therapist.address}</p>
              </div>
            </div>
          </div>
          <p className="sample-note">
            {translate(
              "Podaci profila i fotografije učitavaju se iz baze. Rezervacije su još lokalna demonstracija.",
              "Profile information and photos are loaded from the database. Bookings are still a local demonstration.",
            )}
          </p>
        </aside>
      </div>
    </div>
  );
}
