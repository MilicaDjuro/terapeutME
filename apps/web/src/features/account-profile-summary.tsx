"use client";
import { BadgeCheck, MapPin, UserRound } from "lucide-react";
import type { AccountUser } from "@/lib/auth-client";
import { useDemo } from "@/lib/demo-context";

/** Prikazuje posljednje potvrđene podatke naloga; ovaj pregled ne čita lokalni unos formulara. */
export function AccountProfileSummary({ user }: { user: AccountUser }) {
  const { translate, locale } = useDemo();
  const birthday = user.dateOfBirth
    ? new Intl.DateTimeFormat(locale === "mne" ? "sr-Latn-ME" : "en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${user.dateOfBirth}T12:00:00Z`))
    : "—";
  return (
    <div
      className={`profile-summary-grid${user.role !== "CLIENT" ? " profile-summary-single" : ""}`}
    >
      <section
        className="profile-summary-group"
        aria-label={translate("Lični podaci", "Personal details")}
      >
        <h3>
          <UserRound size={17} aria-hidden="true" />
          {translate("Lični podaci", "Personal details")}
        </h3>
        <dl className="profile-summary-details">
          <div>
            <dt>{translate("Ime", "First name")}</dt>
            <dd>{user.firstName}</dd>
          </div>
          <div>
            <dt>{translate("Prezime", "Last name")}</dt>
            <dd>{user.lastName}</dd>
          </div>
          <div>
            <dt>{translate("Datum rođenja", "Date of birth")}</dt>
            <dd>
              {user.dateOfBirth ? (
                <time dateTime={user.dateOfBirth}>{birthday}</time>
              ) : (
                birthday
              )}
            </dd>
          </div>
          <div className="profile-summary-email">
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>{translate("Vrsta naloga", "Account type")}</dt>
            <dd>
              {user.role === "THERAPIST"
                ? translate("Terapeut", "Therapist")
                : user.role === "ADMIN"
                  ? "Admin"
                  : translate("Klijent", "Client")}
            </dd>
          </div>
        </dl>
        <span className="profile-email-verified">
          <BadgeCheck size={15} aria-hidden="true" />
          {translate(
            "Email adresa je potvrđena.",
            "Your email address is verified.",
          )}
        </span>
      </section>
      {user.role === "CLIENT" && (
        <section
          className="profile-summary-group"
          aria-label={translate("Kontakt podaci", "Contact details")}
        >
          <h3>
            <MapPin size={17} aria-hidden="true" />
            {translate("Kontakt podaci", "Contact details")}
          </h3>
          <dl className="profile-summary-details">
            <div>
              <dt>{translate("Kontakt telefon", "Contact phone")}</dt>
              <dd>{user.phone || translate("Nije unesen", "Not provided")}</dd>
            </div>
            <div>
              <dt>{translate("Grad", "City")}</dt>
              <dd>{user.city || translate("Nije unesen", "Not provided")}</dd>
            </div>
            <div>
              <dt>{translate("Adresa", "Address")}</dt>
              <dd>
                {user.address || translate("Nije unesena", "Not provided")}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
