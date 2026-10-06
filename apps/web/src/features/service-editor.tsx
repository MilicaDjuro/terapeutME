// Editor jedne usluge. onSave šalje podatke terapeutskoj stranici koja ih provjerava i čuva.
"use client";
import { useState, type FormEvent } from "react";
import { Clock3, Save } from "lucide-react";
import type { Service } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { Price } from "@/components/ui";
/** Prikazuje jednu uslugu i njen formular za uređivanje. */
export function ServiceEditor({
  service,
  onSave,
}: {
  service: Service;
  onSave: (service: Service) => void;
}) {
  const { translate, locale } = useDemo();
  const [editing, setEditing] = useState(false);
  /** Čita tekstualna polja, pretvara trajanje i cijenu u brojeve i šalje podatke roditelju. */
  function handleSaveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const priceText = String(data.get("price"));
    onSave({
      ...service,
      name: String(data.get("name")),
      nameEn: String(data.get("nameEn")),
      duration: Number(data.get("duration")),
      price: priceText === "" ? null : Number(priceText),
      active: data.get("active") === "on",
    });
  }
  return (
    <div
      className={`editable-service ${!service.active ? "inactive-service" : ""}`}
    >
      <div className="service-editor-heading">
        <div>
          <strong>{locale === "mne" ? service.name : service.nameEn}</strong>
          <span>
            <Clock3 size={13} />
            {service.duration} min · <Price value={service.price} />
            {!service.active && ` · ${translate("Neaktivna", "Inactive")}`}
          </span>
        </div>
        <button
          className="text-link small"
          onClick={() => setEditing(!editing)}
        >
          {translate("Uredi", "Edit")}
        </button>
      </div>
      {editing && (
        <form className="inline-form" onSubmit={handleSaveService}>
          <label className="field">
            <span>{translate("Naziv", "Name")}</span>
            <input
              name="name"
              defaultValue={service.name}
              required
              maxLength={120}
            />
          </label>
          <label className="field">
            <span>{translate("Naziv na engleskom", "English name")}</span>
            <input
              name="nameEn"
              defaultValue={service.nameEn}
              required
              maxLength={120}
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>{translate("Trajanje (min)", "Duration (min)")}</span>
              <input
                name="duration"
                type="number"
                min="5"
                max="240"
                defaultValue={service.duration}
                required
              />
            </label>
            <label className="field">
              <span>{translate("Cijena (€)", "Price (€)")}</span>
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                defaultValue={service.price ?? ""}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="active"
              defaultChecked={service.active}
            />
            <span>
              {translate(
                "Usluga je dostupna za zakazivanje",
                "Service is available for booking",
              )}
            </span>
          </label>
          <button className="button button-primary button-sm" type="submit">
            <Save size={14} />
            {translate("Sačuvaj", "Save")}
          </button>
        </form>
      )}
    </div>
  );
}
