"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { dateKey } from "@terapeut/domain";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { useDirectory } from "@/lib/directory-context";
import {
  authErrorMessage,
  requestAuth,
  type AccountUser,
  type TherapistAccountProfile,
} from "@/lib/auth-client";
import { TherapistProfileFields } from "./therapist-profile-editor";
import { ActionButton, SaveFeedback } from "@/components/ui";
import { AccountProfileSummary } from "./account-profile-summary";
import {
  BadgeCheck,
  BriefcaseBusiness,
  MapPin,
  Pencil,
  UserRound,
} from "lucide-react";

/** Uređuje lične podatke obje uloge; prikaz mijenja tek kada API potvrdi upis u bazu. */
export function AccountProfileEditor({
  user,
  onSaved,
}: {
  user: AccountUser;
  onSaved: () => void;
}) {
  const { setUser } = useAuth();
  const { translate } = useDemo();
  const { refresh } = useDirectory();
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [therapistProfile, setTherapistProfile] =
    useState<TherapistAccountProfile | null>(null);
  const pendingRequest = useRef<AbortController | null>(null);

  // Odjava ili zatvaranje stranice prekida čekanje, pa stari odgovor ne mijenja novi nalog.
  useEffect(() => {
    /** Prekida zahtjev u browseru; već potvrđena serverska transakcija ostaje sačuvana. */
    function stopSaving() {
      pendingRequest.current?.abort();
    }
    return stopSaving;
  }, []);

  /** Učitava i profesionalna polja terapeuta prije otvaranja zajedničkog formulara. */
  async function handleEditProfile() {
    if (pendingRequest.current) return;
    setError("");
    setSaved(false);
    if (user.role !== "THERAPIST") {
      setEditing(true);
      return;
    }
    const controller = new AbortController();
    pendingRequest.current = controller;
    setSubmitting(true);
    try {
      const response = await requestAuth(
        "therapist-profile",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!response.therapistProfile) throw new Error("Profil nije dostupan.");
      setTherapistProfile(response.therapistProfile);
      setEditing(true);
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pendingRequest.current = null;
        setSubmitting(false);
      }
    }
  }

  /** Odbacuje nesnimljeni unos; ne šalje promjene serveru. */
  function handleCancelEditing() {
    if (pendingRequest.current) return;
    setEditing(false);
    setError("");
  }

  /** Šalje dozvoljena polja vlasnika i osvježava javni katalog kada terapeut promijeni ime. */
  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRequest.current) return;
    const values = new FormData(event.currentTarget);
    const input: Record<string, string> = {
      firstName: String(values.get("firstName") || ""),
      lastName: String(values.get("lastName") || ""),
      dateOfBirth: String(values.get("dateOfBirth") || ""),
      phone: String(values.get("phone") || ""),
      city: String(values.get("city") || ""),
      address: String(values.get("address") || ""),
    };
    // Jedno slanje obuhvata i profesionalna polja; server provjerava da pripadaju terapeutu.
    if (user.role === "THERAPIST") {
      input.title = String(values.get("title") || "");
      input.biography = String(values.get("biography") || "");
    }
    const controller = new AbortController();
    pendingRequest.current = controller;
    setSubmitting(true);
    setError("");
    setSaved(false);
    try {
      const response = await requestAuth("profile", input, controller.signal);
      if (controller.signal.aborted) return;
      if (!response.user) throw new Error("Nalog nije dostupan.");
      setUser(response.user);
      setEditing(false);
      setSaved(true);
      onSaved();
      if (user.role === "THERAPIST") void refresh();
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pendingRequest.current = null;
        setSubmitting(false);
      }
    }
  }

  return (
    <div className="account-profile-editor">
      {saved && (
        <SaveFeedback
          kind="success"
          title={translate("Profil je sačuvan.", "Profile saved.")}
        />
      )}
      {!editing && submitting && (
        <SaveFeedback
          kind="pending"
          title={translate(
            "Učitavanje podataka za uređivanje…",
            "Loading details for editing…",
          )}
        >
          {translate(
            "Pripremamo posljednje sačuvane podatke vašeg profila.",
            "Preparing the latest saved profile details.",
          )}
        </SaveFeedback>
      )}
      {!editing ? (
        <>
          <AccountProfileSummary user={user} />
          <ActionButton
            pending={submitting}
            className="button button-primary"
            onClick={handleEditProfile}
            disabled={submitting}
          >
            <Pencil size={16} aria-hidden="true" />
            {submitting
              ? translate("Učitavanje…", "Loading…")
              : translate("Uredi profil", "Edit profile")}
          </ActionButton>
        </>
      ) : (
        <form
          onSubmit={handleSaveProfile}
          aria-label={translate("Podaci profila", "Profile details")}
          aria-busy={submitting}
        >
          <fieldset className="profile-form-fields" disabled={submitting}>
            <legend>
              {translate(
                "Uredite profil i kontakt",
                "Edit profile and contact details",
              )}
            </legend>
            <p className="muted small">
              {translate(
                "Izmijenite željene podatke, pa kliknite „Sačuvaj profil“.",
                "Update your details, then select “Save profile”.",
              )}
            </p>
            <fieldset className="profile-form-group">
              <legend>
                <UserRound size={17} aria-hidden="true" />
                {translate("Lični podaci", "Personal details")}
              </legend>
              <div className="form-row">
                <label className="field">
                  <span>{translate("Ime", "First name")}</span>
                  <input
                    name="firstName"
                    autoComplete="given-name"
                    required
                    maxLength={60}
                    defaultValue={user.firstName}
                  />
                </label>
                <label className="field">
                  <span>{translate("Prezime", "Last name")}</span>
                  <input
                    name="lastName"
                    autoComplete="family-name"
                    required
                    maxLength={60}
                    defaultValue={user.lastName}
                  />
                </label>
              </div>
              <label className="field">
                <span>{translate("Datum rođenja", "Date of birth")}</span>
                <input
                  name="dateOfBirth"
                  type="date"
                  autoComplete="bday"
                  required
                  min="1900-01-01"
                  max={dateKey()}
                  defaultValue={user.dateOfBirth || ""}
                />
              </label>
            </fieldset>
            <fieldset className="profile-form-group">
              <legend>
                <MapPin size={17} aria-hidden="true" />
                {translate("Kontakt podaci", "Contact details")}
              </legend>
              <div className="form-row">
                <label className="field">
                  <span>
                    {user.role === "THERAPIST"
                      ? translate("Telefon", "Phone")
                      : translate(
                          "Kontakt telefon (opcionalno)",
                          "Contact phone (optional)",
                        )}
                  </span>
                  <input
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    maxLength={30}
                    required={user.role === "THERAPIST"}
                    defaultValue={
                      user.role === "THERAPIST"
                        ? therapistProfile?.phone || ""
                        : user.phone || ""
                    }
                  />
                </label>
                <label className="field">
                  <span>
                    {translate("Grad", "City")}
                    {user.role === "CLIENT"
                      ? translate(" (opcionalno)", " (optional)")
                      : ""}
                  </span>
                  <input
                    name="city"
                    maxLength={80}
                    autoComplete="address-level2"
                    required={user.role === "THERAPIST"}
                    defaultValue={
                      user.role === "THERAPIST"
                        ? therapistProfile?.city || ""
                        : user.city || ""
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span>
                  {user.role === "THERAPIST"
                    ? translate(
                        "Adresa ordinacije (opcionalno)",
                        "Practice address (optional)",
                      )
                    : translate("Adresa (opcionalno)", "Address (optional)")}
                </span>
                <input
                  name="address"
                  maxLength={160}
                  autoComplete="street-address"
                  defaultValue={
                    user.role === "THERAPIST"
                      ? therapistProfile?.address || ""
                      : user.address || ""
                  }
                />
              </label>
              {user.role === "CLIENT" && (
                <p className="muted small">
                  {translate(
                    "Vaš grad i adresa nijesu javno prikazani.",
                    "Your city and address are not displayed publicly.",
                  )}
                </p>
              )}
            </fieldset>
            {user.role === "THERAPIST" && therapistProfile && (
              <fieldset className="profile-form-group">
                <legend>
                  <BriefcaseBusiness size={17} aria-hidden="true" />
                  {translate("Profesionalni profil", "Professional profile")}
                </legend>
                <TherapistProfileFields profile={therapistProfile} />
              </fieldset>
            )}
            <p className="profile-email-note">
              <BadgeCheck size={18} aria-hidden="true" />
              <span>
                <strong>{user.email}</strong>
                <small>
                  {translate(
                    "Email za prijavu ostaje potvrđena adresa prikazana iznad.",
                    "Your sign-in email remains the verified address shown above.",
                  )}
                </small>
              </span>
            </p>
            {error && (
              <SaveFeedback
                kind="error"
                title={translate(
                  "Profil nije sačuvan.",
                  "Profile was not saved.",
                )}
              >
                {error}
              </SaveFeedback>
            )}
            {submitting && (
              <SaveFeedback
                kind="pending"
                title={translate(
                  "Čuvanje podataka profila…",
                  "Saving profile details…",
                )}
              >
                {translate(
                  "Sačekajte potvrdu uspješnog čuvanja.",
                  "Please wait for confirmation that your changes were saved.",
                )}
              </SaveFeedback>
            )}
            <div className="account-profile-actions">
              <ActionButton
                pending={submitting}
                className="button button-primary"
                type="submit"
              >
                {submitting
                  ? translate("Čuvanje…", "Saving…")
                  : translate("Sačuvaj profil", "Save profile")}
              </ActionButton>
              <button
                className="button button-outline"
                type="button"
                onClick={handleCancelEditing}
              >
                {translate("Odustani", "Cancel")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {!editing && error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
