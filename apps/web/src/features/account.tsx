"use client";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { ProfileLoading } from "@/components/ui";
import { TherapistAccountProfileCard } from "./therapist-account-profile";
import { ServerBookings } from "./server-bookings";
import { AccountProfileEditor } from "./account-profile-editor";
import { BookOpen, CalendarDays, Search, UserRound } from "lucide-react";
import { ClientMaterials } from "./materials";

/** Prikazuje podatke vlasnika serverske sesije; demo rezervacije nijesu dio ovog naloga. */
export function AccountPage() {
  const { user, loading, error, refreshAccount } = useAuth();
  const { translate } = useDemo();
  const [profileVersion, setProfileVersion] = useState(0);

  /** Poslije zajedničkog čuvanja ponovo učitava pregled terapeuta i njegove fotografije. */
  function handleProfileSaved() {
    setProfileVersion(profileVersion + 1);
  }

  if (loading)
    return (
      <div className="container page-space">
        <ProfileLoading />
      </div>
    );
  if (error)
    return (
      <div className="container page-space">
        <h1>{translate("Nalog nije dostupan", "Account unavailable")}</h1>
        <p role="alert">{error}</p>
        <button className="button button-primary" onClick={refreshAccount}>
          {translate("Pokušaj ponovo", "Try again")}
        </button>
      </div>
    );
  if (!user)
    return (
      <div className="container page-space">
        <h1>
          {translate(
            "Prijavite se za pregled naloga.",
            "Sign in to view your account.",
          )}
        </h1>
        <Link href="/login" className="button button-primary">
          {translate("Prijavi se", "Sign in")}
        </Link>
      </div>
    );

  return (
    <div className="container page-space account-page account-overview">
      <div className="account-welcome">
        <div>
          <span className="eyebrow">
            {translate("MOJ NALOG", "MY ACCOUNT")}
          </span>
          <h1>
            {translate(
              `Dobro došli, ${user.firstName}.`,
              `Welcome, ${user.firstName}.`,
            )}
          </h1>
          <p className="muted">
            {translate(
              user.role === "CLIENT"
                ? "Vaši termini, terapeuti i podaci na jednom mjestu."
                : "Uredite svoje podatke i način na koji vas klijenti vide.",
              user.role === "CLIENT"
                ? "Your sessions, therapists and details in one place."
                : "Manage your details and how clients see your profile.",
            )}
          </p>
        </div>
        <span className="account-initials" aria-hidden="true">
          {user.firstName.charAt(0)}
          {user.lastName.charAt(0)}
        </span>
      </div>
      {user.role === "CLIENT" && (
        <>
          <nav
            className="account-shortcuts"
            aria-label={translate("Prečice naloga", "Account shortcuts")}
          >
            <a href="#my-bookings">
              <CalendarDays size={17} aria-hidden="true" />
              {translate("Moji termini", "My sessions")}
            </a>
            <a href="#my-materials">
              <BookOpen size={17} aria-hidden="true" />
              {translate(
                "Domaći zadaci i materijali",
                "Homework and materials",
              )}
            </a>
            <a href="#my-profile">
              <UserRound size={17} aria-hidden="true" />
              {translate("Moj profil", "My profile")}
            </a>
            <Link href="/psychotherapy">
              <Search size={17} aria-hidden="true" />
              {translate("Pronađi terapeuta", "Find a therapist")}
            </Link>
          </nav>
          <ServerBookings key={user.id} />
          <ClientMaterials key={`materials-${user.id}`} />
        </>
      )}
      <section
        className="auth-card account-profile-card"
        id="my-profile"
        aria-labelledby="account-profile-heading"
      >
        <div className="account-section-heading">
          <span className="account-section-icon">
            <UserRound size={21} aria-hidden="true" />
          </span>
          <div>
            <h2 id="account-profile-heading">
              {translate("Vaši podaci", "Your details")}
            </h2>
            <p>
              {translate(
                "Pregledajte podatke ili ih izmijenite na dugme ispod.",
                "Review your details or update them below.",
              )}
            </p>
          </div>
        </div>
        <AccountProfileEditor
          key={user.id}
          user={user}
          onSaved={handleProfileSaved}
        />
      </section>
      {user.role === "THERAPIST" && (
        <>
          <Link className="text-link" href="/dashboard">
            {translate("Otvori moj pregled", "Open my dashboard")}
          </Link>
          <TherapistAccountProfileCard key={`${user.id}:${profileVersion}`} />
        </>
      )}
      <p className="account-note">
        {translate(
          "Vaši zahtjevi su sačuvani i dostupni nakon ponovne prijave.",
          "Your requests are saved and available after signing in again.",
        )}
      </p>
      <Link className="text-link" href="/psychotherapy">
        {translate("Pogledaj stručnjake", "Browse professionals")}
      </Link>
    </div>
  );
}
