// Formulari za profil, usluge i sedmične sate. Svaki formular poziva imenovanu handle funkciju.
"use client";
import { useState, type FormEvent } from "react";
import { Plus, Save, X, CalendarDays, Info } from "lucide-react";
import { Therapist, timeLabel, Service } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { errorText } from "@/lib/errors";
import { ServiceEditor } from "./service-editor";
import { timeToMinutes, getWeekdayNames } from "@/lib/format";
/** Prikazuje formulare za usluge, sedmičnu dostupnost i javne podatke terapeuta. */
export function TherapistSettings({ therapist }: { therapist: Therapist }) {
  const { translate, locale, updateTherapist } = useDemo();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [newService, setNewService] = useState(false);
  /** Čuva izmjenu profila kroz demo omotač i prikazuje poruku o uspjehu ili grešci. */
  function save(update: Partial<Therapist>) {
    try {
      updateTherapist(therapist.id, update);
      setSuccess(
        translate(
          "Promjene su sačuvane u demo verziji.",
          "Changes saved in the demo.",
        ),
      );
      setError("");
    } catch (error) {
      setError(errorText(error, translate));
      setSuccess("");
    }
  }

  // Imena dana su numerisana kao u podacima: 0 = nedjelja.
  const weekdayNames = getWeekdayNames(locale);
  /** Zamjenjuje jednu uslugu u listi; postojeći zahtjevi zadržavaju svoje trajanje i cijenu. */
  function updateService(updatedService: Service) {
    const services = therapist.services.map((service) => {
      if (service.id === updatedService.id) {
        return updatedService;
      }
      return service;
    });
    save({ services });
  }
  /** Čita novu uslugu iz formulara, provjerava je pri čuvanju i dodaje u listu. */
  function handleAddService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    const priceText = String(data.get("price"));
    const service: Service = {
      id: crypto.randomUUID(),
      name,
      nameEn: String(data.get("nameEn")).trim() || name,
      duration: Number(data.get("duration")),
      price: priceText === "" ? null : Number(priceText),
      active: true,
    };
    try {
      updateTherapist(therapist.id, {
        services: [...therapist.services, service],
      });
      setNewService(false);
      setSuccess(translate("Usluga je dodata.", "Service added."));
      setError("");
    } catch (error) {
      setError(errorText(error, translate));
    }
  }
  /** Pretvara sate u minute i dodaje period; preklapanje se provjerava pri čuvanju. */
  function handleAddAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const availabilityWindow = {
      id: crypto.randomUUID(),
      weekday: Number(data.get("weekday")),
      start: timeToMinutes(String(data.get("start"))),
      end: timeToMinutes(String(data.get("end"))),
    };
    save({ availability: [...therapist.availability, availabilityWindow] });
  }
  /** Uklanja period za nove zahtjeve, bez brisanja već zauzetih termina. */
  function removeAvailability(id: string) {
    const remainingWindows = therapist.availability.filter(
      (window) => window.id !== id,
    );
    save({ availability: remainingWindows });
  }
  /** Čuva samo javne podatke terapeuta; verifikaciju i admin polja ne uzima iz formulara. */
  function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save({
      name: String(data.get("name")),
      bio: String(data.get("bio")),
      acceptingClients: data.get("accepting") === "on",
    });
  }

  return (
    <div className="settings-grid">
      <section className="settings-panel">
        <div className="panel-heading">
          <div>
            <h2>{translate("Usluge koje nudite", "Your services")}</h2>
            <p>
              {translate(
                "Trajanje određuje dužinu termina. Cijena je opcionalna.",
                "Duration determines appointment length. Price is optional.",
              )}
            </p>
          </div>
          <button
            className="button button-outline button-sm"
            onClick={() => setNewService(!newService)}
          >
            <Plus size={15} />
            {translate("Dodaj", "Add")}
          </button>
        </div>
        <div className="editable-services">
          {therapist.services.map((service) => (
            <ServiceEditor
              key={`${service.id}-${service.active}`}
              service={service}
              onSave={updateService}
            />
          ))}
        </div>
        {newService && (
          <form className="inline-form" onSubmit={handleAddService}>
            <label className="field">
              <span>{translate("Naziv usluge", "Service name")}</span>
              <input name="name" required maxLength={120} />
            </label>
            <label className="field">
              <span>
                {translate(
                  "Naziv na engleskom (opcionalno)",
                  "English name (optional)",
                )}
              </span>
              <input name="nameEn" maxLength={120} />
            </label>
            <div className="form-row">
              <label className="field">
                <span>{translate("Trajanje (min)", "Duration (min)")}</span>
                <input
                  name="duration"
                  type="number"
                  min="5"
                  max="240"
                  step="1"
                  required
                  defaultValue="60"
                />
              </label>
              <label className="field">
                <span>
                  {translate("Cijena (€), opciono", "Price (€), optional")}
                </span>
                <input name="price" type="number" min="0" step="0.01" />
              </label>
            </div>
            <button className="button button-primary button-sm" type="submit">
              <Plus size={15} />
              {translate("Dodaj uslugu", "Add service")}
            </button>
          </form>
        )}
      </section>
      <section className="settings-panel">
        <div className="panel-heading">
          <div>
            <h2>{translate("Nedjeljna dostupnost", "Weekly availability")}</h2>
            <p>
              {translate(
                "Odredite dane i sate u kojima primate klijente.",
                "Choose the days and hours when you see clients.",
              )}
            </p>
          </div>
          <CalendarDays size={23} />
        </div>
        <div className="availability-list">
          {therapist.availability.map((availabilityWindow) => (
            <div key={availabilityWindow.id}>
              <strong>{weekdayNames[availabilityWindow.weekday]}</strong>
              <span>
                {timeLabel(availabilityWindow.start)}–
                {timeLabel(availabilityWindow.end)}
              </span>
              <button
                className="icon-button"
                aria-label={translate(
                  "Ukloni ovaj period dostupnosti",
                  "Remove this availability window",
                )}
                onClick={() => removeAvailability(availabilityWindow.id)}
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
        <form className="inline-form" onSubmit={handleAddAvailability}>
          <label className="field">
            <span>{translate("Dan", "Day")}</span>
            <select name="weekday" defaultValue="1">
              {weekdayNames.map((day, i) => (
                <option value={i} key={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label className="field">
              <span>{translate("Od", "From")}</span>
              <input type="time" name="start" defaultValue="16:00" required />
            </label>
            <label className="field">
              <span>{translate("Do", "Until")}</span>
              <input type="time" name="end" defaultValue="20:00" required />
            </label>
          </div>
          <button className="button button-outline button-sm" type="submit">
            <Plus size={15} />
            {translate("Dodaj dostupnost", "Add availability")}
          </button>
        </form>
        <div className="info-note">
          <Info size={16} />
          <span>
            {translate(
              "Novi raspored važi za nove zahtjeve. Postojeći zauzeti termini i njihovo trajanje ostaju sačuvani.",
              "The updated schedule applies to new requests. Existing held appointments and their durations are preserved.",
            )}
          </span>
        </div>
      </section>
      <section className="settings-panel profile-settings">
        <h2>{translate("Vaš javni profil", "Your public profile")}</h2>
        <form onSubmit={handleSaveProfile}>
          <label className="field">
            <span>{translate("Ime i prezime", "Full name")}</span>
            <input
              name="name"
              defaultValue={therapist.name}
              required
              maxLength={120}
            />
          </label>
          <label className="field">
            <span>
              {translate(
                "Biografija (do 400 karaktera)",
                "Biography (up to 400 characters)",
              )}
            </span>
            <textarea
              name="bio"
              rows={4}
              defaultValue={therapist.bio}
              maxLength={400}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="accepting"
              defaultChecked={therapist.acceptingClients}
            />
            <span>
              {translate("Primam nove klijente", "I am accepting new clients")}
            </span>
          </label>
          <p className="muted">
            {translate(
              "Verifikacijom i javnom aktivnošću upravlja admin.",
              "Verification and public active status are managed by the admin.",
            )}
          </p>
          <button className="button button-primary button-sm" type="submit">
            <Save size={15} />
            {translate("Sačuvaj profil", "Save profile")}
          </button>
        </form>
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="form-success" role="status">
          {success}
        </p>
      )}
    </div>
  );
}
