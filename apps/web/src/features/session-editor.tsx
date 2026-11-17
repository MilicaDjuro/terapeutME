"use client";
import { useState, type FormEvent } from "react";
import type { Service } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { ActionButton, SaveFeedback } from "@/components/ui";
import type { ScheduleSaveResult } from "@/lib/booking-client";

/** Uređuje naziv, trajanje i cijenu jedne seanse; ranije rezervacije zadržavaju svoje kopije podataka. */
export function SessionEditor({
  service,
  onSave,
}: {
  service?: Service;
  onSave: (body: Record<string, string>) => Promise<ScheduleSaveResult>;
}) {
  const { translate } = useDemo();
  const [pendingAction, setPendingAction] = useState("");
  const [saveResult, setSaveResult] = useState<ScheduleSaveResult | null>(null);
  /** Uklanja prethodni rezultat formulara; potvrdu pri vrhu uklanja roditelj na isti događaj. */
  function handleChange() {
    setSaveResult(null);
  }
  /** Čita samo ovu seansu; novi formular resetuje tek poslije potvrđenog upisa na serveru. */
  async function handleSaveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body: Record<string, string> = {
      action: "service",
      name: String(values.get("name") || ""),
      duration: String(values.get("duration") || ""),
      price: String(values.get("price") || ""),
    };
    if (service) body.serviceId = service.id;
    // Spinner traje koliko i stvarni API zahtjev, uključujući neuspješan odgovor.
    setPendingAction("save");
    setSaveResult(null);
    try {
      const result = await onSave(body);
      setSaveResult(result);
      if (result.saved && !service) form.reset();
    } finally {
      setPendingAction("");
    }
  }
  /** Isključuje seansu za nova zakazivanja; server zadržava postojeće zahtjeve i istoriju. */
  async function handleRemoveSession() {
    if (!service) return;
    setPendingAction("remove");
    setSaveResult(null);
    try {
      const result = await onSave({
        action: "remove-service",
        serviceId: service.id,
      });
      setSaveResult(result);
    } finally {
      setPendingAction("");
    }
  }
  return (
    <form
      className="session-editor"
      data-service-id={service?.id}
      data-new-session={!service ? "true" : undefined}
      onSubmit={handleSaveSession}
      onChange={handleChange}
      aria-busy={pendingAction !== ""}
    >
      <h4>
        {service
          ? `${service.name} · ${service.duration} min`
          : translate("Dodaj vrstu seanse", "Add session type")}
      </h4>
      <label className="field">
        <span>{translate("Naziv seanse", "Session name")}</span>
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={service?.name || ""}
        />
      </label>
      <div className="form-row">
        <label className="field">
          <span>
            {translate("Trajanje seanse (min)", "Session duration (min)")}
          </span>
          <input
            name="duration"
            type="number"
            min={5}
            max={240}
            step={1}
            required
            defaultValue={service?.duration || 60}
          />
        </label>
        <label className="field">
          <span>{translate("Cijena (€), opciono", "Price (€), optional")}</span>
          <input
            name="price"
            type="number"
            min={0}
            max={99999999.99}
            step="0.01"
            defaultValue={service?.price ?? ""}
          />
        </label>
      </div>
      <p className="muted small">
        {translate(
          "Naziv određuje tip seanse, npr. individualna ili partnerska. Trajanje možete promijeniti na 30, 40, 50, 60 ili drugi broj od 5 do 240 minuta. Prazna cijena znači „Na upit“.",
          "The name describes the session type, such as individual or couples therapy. Change the duration to 30, 40, 50, 60 or any whole number from 5 to 240 minutes. A blank price means “On request”.",
        )}
      </p>
      <div className="booking-actions">
        <ActionButton
          pending={pendingAction === "save"}
          pendingText={translate("Čuvanje seanse…", "Saving session…")}
          className="button button-primary"
        >
          {service
            ? translate("Sačuvaj seansu", "Save session")
            : translate("Dodaj seansu", "Add session")}
        </ActionButton>
        {service && (
          <ActionButton
            pending={pendingAction === "remove"}
            pendingText={translate("Uklanjanje…", "Removing…")}
            type="button"
            className="button button-outline"
            onClick={handleRemoveSession}
          >
            {translate("Ukloni seansu", "Remove session")}
          </ActionButton>
        )}
      </div>
      {/* Uspjeh prikazuje roditelj jednom; greška ostaje uz unos radi ispravke. */}
      {saveResult && !saveResult.saved && (
        <SaveFeedback kind="error" title={saveResult.message} />
      )}
    </form>
  );
}
