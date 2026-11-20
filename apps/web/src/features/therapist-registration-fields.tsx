"use client";
import { useDemo } from "@/lib/demo-context";

/** Prikazuje profesionalne podatke i početnu uslugu; nalog i verifikaciju čuva zajednički tok. */
export function TherapistRegistrationFields() {
  const { translate } = useDemo();
  return (
    <>
      <fieldset className="therapist-registration-fields">
        <legend>
          {translate("Vaš stručni profil", "Your professional profile")}
        </legend>
        <label className="field">
          <span>{translate("Stručno zvanje", "Professional title")}</span>
          <input
            name="title"
            required
            maxLength={120}
            placeholder={translate(
              "Npr. psiholog, psihoterapeut",
              "e.g. psychologist, psychotherapist",
            )}
          />
        </label>
        <label className="field">
          <span>{translate("Biografija", "Biography")}</span>
          <textarea
            name="biography"
            required
            rows={4}
            maxLength={400}
            placeholder={translate(
              "Predstavite svoj rad i pristup (do 400 znakova).",
              "Describe your work and approach (up to 400 characters).",
            )}
          />
        </label>
        <div className="form-row">
          <label className="field">
            <span>{translate("Grad", "City")}</span>
            <input
              name="city"
              autoComplete="address-level2"
              required
              maxLength={80}
            />
          </label>
          <label className="field">
            <span>{translate("Telefon", "Phone")}</span>
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              required
              maxLength={30}
              placeholder="+382"
            />
          </label>
        </div>
        <label className="field">
          <span>
            {translate(
              "Adresa ordinacije (opcionalno)",
              "Practice address (optional)",
            )}
          </span>
          <input name="address" autoComplete="street-address" maxLength={160} />
        </label>
        <p className="muted small">
          {translate(
            "Potvrda emaila kreira nalog. Stručnu verifikaciju profila dodjeljuje administrator.",
            "Email verification creates your account. Professional verification is assigned by an administrator.",
          )}
        </p>
      </fieldset>
      <fieldset className="therapist-registration-fields">
        <legend>
          {translate("Vaša početna usluga", "Your first service")}
        </legend>
        <label className="field">
          <span>{translate("Naziv usluge", "Service name")}</span>
          <input
            name="serviceName"
            required
            maxLength={120}
            defaultValue={translate(
              "Individualna seansa",
              "Individual session",
            )}
          />
        </label>
        <div className="form-row">
          <label className="field">
            <span id="therapist-duration-label">
              {translate("Trajanje seanse (min)", "Session duration (min)")}
            </span>
            <input
              name="durationMinutes"
              aria-labelledby="therapist-duration-label"
              required
              type="number"
              min={5}
              max={240}
              step={1}
              defaultValue={60}
            />
          </label>
          <label className="field">
            <span>
              {translate(
                "Cijena seanse (€), opciono",
                "Session price (€), optional",
              )}
            </span>
            <input
              name="priceEur"
              type="number"
              min={0}
              max={99999999.99}
              step="0.01"
              aria-describedby="therapist-price-help"
            />
          </label>
        </div>
        <p id="therapist-price-help" className="muted small">
          {translate(
            "Ako ne unesete cijenu, prikazuje se „Na upit“.",
            "If you leave the price blank, it is shown as “On request”.",
          )}
        </p>
        <label className="checkbox-label">
          <input type="checkbox" name="online" />
          <span>
            {translate(
              "Online seansa — video poziv za dvije osobe",
              "Online session — video call for two people",
            )}
          </span>
        </label>
      </fieldset>
    </>
  );
}
