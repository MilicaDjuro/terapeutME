"use client";
import { useEffect, useState } from "react";
import { useDemo } from "@/lib/demo-context";
import {
  authErrorMessage,
  requestAuth,
  type TherapistAccountProfile,
} from "@/lib/auth-client";
import {
  ProfileLoading,
  PendingStatus,
  SaveFeedback,
  Price,
} from "@/components/ui";
import Link from "next/link";
import { TherapistPhotosEditor } from "./therapist-photos-editor";
import { useAuth } from "@/lib/auth-context";

/** Prikazuje profil i usluge iz baze; server bira vlasnika iz sesije, bez ID-a iz browsera. */
export function TherapistAccountProfileCard() {
  const { user } = useAuth();
  const { translate } = useDemo();
  const [profile, setProfile] = useState<TherapistAccountProfile | null>(null);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loading, setLoading] = useState(true);

  // Profil se učitava pri otvaranju i ponovnom pokušaju; zatvaranje prekida zahtjev.
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    // Sačuvani prikaz ostaje vidljiv tokom osvježavanja, zajedno sa potvrdom za fotografije.
    setLoading(true);
    /** Učitava vlastiti profil i ignoriše odgovor nakon zatvaranja prikaza. */
    async function loadProfile() {
      try {
        const response = await requestAuth(
          "therapist-profile",
          undefined,
          controller.signal,
        );
        if (!response.therapistProfile)
          throw new Error("Profil nije dostupan.");
        if (!controller.signal.aborted) setProfile(response.therapistProfile);
      } catch (failure) {
        if (!controller.signal.aborted) setError(authErrorMessage(failure));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadProfile();
    /** Prekida HTTP zahtjev pri odjavi, promjeni naloga ili zatvaranju komponente. */
    function stopLoading() {
      controller.abort();
    }
    return stopLoading;
  }, [reloadVersion]);

  /** Ponovo učitava profil poslije mrežne greške, bez izmjene podataka u bazi. */
  function handleReloadProfile() {
    setReloadVersion(reloadVersion + 1);
  }

  return (
    <section
      className="auth-card therapist-account-profile"
      aria-labelledby="therapist-profile-title"
    >
      <h2 id="therapist-profile-title">
        {translate("Vaš profil terapeuta", "Your therapist profile")}
      </h2>
      {error && (
        <>
          <SaveFeedback
            kind="error"
            title={translate(
              "Profil nije moguće učitati.",
              "Unable to load profile.",
            )}
          >
            {error}
          </SaveFeedback>
          <button
            className="button button-outline"
            onClick={handleReloadProfile}
          >
            {translate("Pokušaj ponovo", "Try again")}
          </button>
        </>
      )}
      {loading && profile && (
        <PendingStatus>
          {translate(
            "Osvježavanje sačuvanog profila…",
            "Refreshing the saved profile…",
          )}
        </PendingStatus>
      )}
      {!profile ? (
        loading && <ProfileLoading />
      ) : (
        <>
          <h3>{user ? `${user.firstName} ${user.lastName}` : profile.name}</h3>
          <p>{profile.title}</p>
          <span className={profile.verified ? "verified" : "unverified"}>
            {profile.verified
              ? translate("Verifikovan profil", "Verified profile")
              : translate("Neverifikovan profil", "Unverified profile")}
          </span>
          <dl className="account-details">
            <div>
              <dt>{translate("Grad", "City")}</dt>
              <dd>{profile.city}</dd>
            </div>
            <div>
              <dt>{translate("Telefon", "Phone")}</dt>
              <dd>{profile.phone || "—"}</dd>
            </div>
            <div>
              <dt>{translate("Adresa ordinacije", "Practice address")}</dt>
              <dd>
                {profile.address || translate("Nije unesena", "Not provided")}
              </dd>
            </div>
          </dl>
          <h3>{translate("Biografija", "Biography")}</h3>
          <p className="therapist-account-biography">{profile.biography}</p>
          <h3>{translate("Vaše usluge", "Your services")}</h3>
          <ul className="therapist-account-services">
            {profile.services.map((service) => (
              <li key={service.id}>
                <strong>{service.name}</strong>
                <span>
                  {service.durationMinutes} min ·{" "}
                  <Price value={service.priceEur} />
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {translate(
              "Potvrđen email ne predstavlja stručnu verifikaciju. Verifikaciju profila dodjeljuje administrator.",
              "A verified email does not mean professional verification. Profile verification is assigned by an administrator.",
            )}
          </p>
          <Link href={`/therapist/${profile.publicId}`} className="text-link">
            {translate("Otvori javni profil", "Open public profile")}
          </Link>
          <TherapistPhotosEditor
            photos={profile.photos}
            refreshing={loading}
            onChanged={handleReloadProfile}
          />
        </>
      )}
    </section>
  );
}
