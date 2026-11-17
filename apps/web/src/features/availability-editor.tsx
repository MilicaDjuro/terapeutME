"use client";
import { useState, type FormEvent, type ChangeEvent } from "react";
import {
  addDays,
  dateKey,
  timeLabel,
  type AvailabilityWindow,
  type DateAvailability,
} from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { getWeekdayNames, timeToMinutes } from "@/lib/format";
import { ActionButton, SaveFeedback } from "@/components/ui";
import { TimeField, readTimeField } from "@/components/time-field";
import type { ScheduleSaveResult } from "@/lib/booking-client";

/** Uređuje postojeći sedmični interval bez brisanja i ponovnog dodavanja. */
export function WeeklyWindowEditor({
  window,
  onSave,
}: {
  window: AvailabilityWindow;
  onSave: (body: Record<string, string>) => Promise<ScheduleSaveResult>;
}) {
  const { translate, locale } = useDemo();
  const [editing, setEditing] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [saveResult, setSaveResult] = useState<ScheduleSaveResult | null>(null);
  /** Novi unos uklanja raniju grešku perioda; podatke čuvamo tek na dugme. */
  function handleChange() {
    setSaveResult(null);
  }
  const names = getWeekdayNames(locale);
  /** Otvara polja sa posljednjim sačuvanim danom i satima. */
  function handleEdit() {
    setSaveResult(null);
    setEditing(true);
  }
  /** Odbacuje lokalni unos bez izmjene baze. */
  function handleCancel() {
    setEditing(false);
  }
  /** Šalje isti ID intervala, pa server provjerava vlasnika i preklapanja. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const end = timeToMinutes(readTimeField(values, "end"));
    setPendingAction("save");
    setSaveResult(null);
    try {
      const result = await onSave({
        action: "window",
        id: window.id,
        weekday: String(values.get("weekday")),
        start: String(timeToMinutes(readTimeField(values, "start"))),
        end: String(end === 0 ? 1440 : end),
      });
      setSaveResult(result);
      if (result.saved) setEditing(false);
    } finally {
      setPendingAction("");
    }
  }
  /** Isključuje interval za budući prikaz; zakazane seanse ostaju sačuvane. */
  async function handleRemove() {
    setPendingAction("remove");
    setSaveResult(null);
    try {
      setSaveResult(await onSave({ action: "remove-window", id: window.id }));
    } finally {
      setPendingAction("");
    }
  }
  return (
    <li data-window-id={window.id}>
      {!editing ? (
        <>
          <span>
            {names[window.weekday]} · {timeLabel(window.start)}–
            {timeLabel(window.end)}
          </span>
          <div className="booking-actions">
            <button type="button" className="text-link" onClick={handleEdit}>
              {translate("Uredi period", "Edit period")}
            </button>
            <ActionButton
              pending={pendingAction === "remove"}
              pendingText={translate("Uklanjanje…", "Removing…")}
              type="button"
              className="text-link"
              onClick={handleRemove}
            >
              {translate("Ukloni period", "Remove period")}
            </ActionButton>
          </div>
        </>
      ) : (
        <form
          className="schedule-form"
          onSubmit={handleSave}
          onChange={handleChange}
          aria-label={translate("Uredi sedmični period", "Edit weekly period")}
        >
          <label className="field">
            <span id={`weekday-${window.id}`}>
              {translate("Dan", "Weekday")}
            </span>
            <select
              name="weekday"
              defaultValue={window.weekday}
              aria-labelledby={`weekday-${window.id}`}
            >
              {names.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <TimeField
              name="start"
              label={translate("Radno vrijeme od", "Working hours from")}
              defaultValue={timeLabel(window.start)}
            />
            <TimeField
              name="end"
              label={translate("Radno vrijeme do", "Working hours until")}
              defaultValue={
                window.end === 1440 ? "00:00" : timeLabel(window.end)
              }
            />
          </div>
          <div className="booking-actions">
            <ActionButton
              pending={pendingAction === "save"}
              pendingText={translate("Čuvanje perioda…", "Saving period…")}
              type="submit"
              className="button button-primary"
            >
              {translate("Sačuvaj period", "Save period")}
            </ActionButton>
            <button
              type="button"
              className="button button-outline"
              onClick={handleCancel}
            >
              {translate("Odustani", "Cancel")}
            </button>
          </div>
        </form>
      )}
      {/* Jedina potvrda uspjeha je iznad rasporeda; ovdje ostaje samo greška unosa. */}
      {saveResult && !saveResult.saved && (
        <SaveFeedback kind="error" title={saveResult.message} />
      )}
    </li>
  );
}

/** Dodaje ili mijenja jedan konkretan datum; taj datum ima prednost nad sedmičnim rasporedom. */
export function DateAvailabilityEditor({
  availability,
  onSave,
}: {
  availability?: DateAvailability;
  onSave: (body: Record<string, string>) => Promise<ScheduleSaveResult>;
}) {
  const { translate } = useDemo();
  const [editing, setEditing] = useState(!availability);
  const [working, setWorking] = useState(availability?.working ?? true);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [saveResult, setSaveResult] = useState<ScheduleSaveResult | null>(null);
  /** Uklanja raniji rezultat datuma; roditelj istim događajem uklanja zajedničku potvrdu. */
  function handleChange() {
    setSaveResult(null);
  }
  /** Otvara postojeći datum i njegovo trenutno radno vrijeme. */
  function handleEdit() {
    setSaveResult(null);
    setWorking(availability?.working ?? true);
    setConfirmingRemoval(false);
    setEditing(true);
  }
  /** Zatvara izmjenu; sljedeće otvaranje ponovo uzima sačuvane podatke. */
  function handleCancel() {
    setEditing(false);
  }
  /** Za cijeli neradni datum izostavlja vrijeme, umjesto dodavanja posebne pauze. */
  function handleWorkingChange(event: ChangeEvent<HTMLInputElement>) {
    setWorking(event.target.checked);
  }
  /** Čuva datum i sate zajedno; promjena datuma zadržava isti ID zapisa. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body: Record<string, string> = {
      action: "date-availability",
      date: String(values.get("date")),
      working: String(working),
    };
    if (availability) body.id = availability.id;
    if (working) {
      body.start = String(timeToMinutes(readTimeField(values, "start")));
      const end = timeToMinutes(readTimeField(values, "end"));
      // 00:00 u polju kraja znači ponoć na kraju izabranog dana.
      body.end = String(end === 0 ? 1440 : end);
    }
    // Stanje se gasi i kod greške; neuspješan unos ostaje u formularu radi ispravke.
    setPendingAction("save");
    setSaveResult(null);
    try {
      const result = await onSave(body);
      setSaveResult(result);
      if (result.saved) {
        if (availability) setEditing(false);
        else {
          form.reset();
          setWorking(true);
        }
      }
    } finally {
      setPendingAction("");
    }
  }
  /** Objašnjava da uklanjanje neradnog datuma može ponovo otvoriti termine. */
  function handleAskRemoval() {
    setConfirmingRemoval(true);
  }
  /** Zadržava poseban raspored i njegovu trenutnu dostupnost. */
  function handleCancelRemoval() {
    setConfirmingRemoval(false);
  }
  /** Tek poslije potvrde uklanja datum; server vraća redovne sedmične sate. */
  async function handleRemove() {
    if (!availability) return;
    setPendingAction("remove");
    setSaveResult(null);
    try {
      const result = await onSave({
        action: "remove-date",
        id: availability.id,
      });
      setSaveResult(result);
      if (result.saved) setConfirmingRemoval(false);
    } finally {
      setPendingAction("");
    }
  }
  return (
    <div
      className="session-editor date-availability-editor"
      data-date-id={availability?.id}
      data-new-date={!availability ? "true" : undefined}
    >
      <h4>
        {availability
          ? `${availability.date} · ${availability.working ? `${timeLabel(availability.start)}–${timeLabel(availability.end)}` : translate("Neradni dan", "Day off")}`
          : translate("Dodaj raspored za datum", "Add hours for a date")}
      </h4>
      {!editing ? (
        <div className="booking-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={handleEdit}
          >
            {translate("Uredi datum", "Edit date")}
          </button>
          <button
            type="button"
            className="text-link"
            onClick={handleAskRemoval}
          >
            {translate("Vrati sedmični raspored", "Restore weekly hours")}
          </button>
          {confirmingRemoval && (
            <div
              role="group"
              aria-label={translate(
                "Potvrda vraćanja rasporeda",
                "Confirm restoring weekly hours",
              )}
            >
              <p>
                {translate(
                  "Uklanjanjem posebnog rasporeda ovaj datum ponovo prati sedmično radno vrijeme. Ako je to redovan radni dan, pacijenti će ponovo moći da zakazuju termine.",
                  "Removing this date schedule restores weekly hours. If this is a regular working day, patients will be able to book times again.",
                )}
              </p>
              <div className="booking-actions">
                <ActionButton
                  pending={pendingAction === "remove"}
                  pendingText={translate(
                    "Vraćanje rasporeda…",
                    "Restoring weekly hours…",
                  )}
                  type="button"
                  className="button button-outline"
                  onClick={handleRemove}
                >
                  {translate(
                    "Potvrdi vraćanje rasporeda",
                    "Confirm restoring weekly hours",
                  )}
                </ActionButton>
                <button
                  type="button"
                  className="text-link"
                  onClick={handleCancelRemoval}
                >
                  {translate("Odustani", "Cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          onChange={handleChange}
          aria-label={
            availability
              ? translate("Uredi datum rasporeda", "Edit date schedule")
              : translate("Novi datum rasporeda", "New date schedule")
          }
        >
          <label className="field">
            <span>{translate("Datum rada", "Working date")}</span>
            <input
              name="date"
              type="date"
              min={dateKey()}
              max={addDays(dateKey(), 90)}
              required
              defaultValue={availability?.date || dateKey()}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={working}
              onChange={handleWorkingChange}
            />
            <span>{translate("Radim ovog datuma", "I work on this date")}</span>
          </label>
          {working && (
            <div className="form-row">
              <TimeField
                name="start"
                label={translate("Rad za datum od", "Date hours from")}
                defaultValue={
                  availability?.working
                    ? timeLabel(availability.start)
                    : "09:00"
                }
              />
              <TimeField
                name="end"
                label={translate("Rad za datum do", "Date hours until")}
                defaultValue={
                  availability?.working
                    ? availability.end === 1440
                      ? "00:00"
                      : timeLabel(availability.end)
                    : "17:00"
                }
              />
            </div>
          )}
          {availability && (
            <p className="muted small">
              {translate(
                "Promjena datuma vraća prethodni dan na sedmični raspored.",
                "Moving the date restores weekly hours for the previous day.",
              )}
            </p>
          )}
          <div className="booking-actions">
            <ActionButton
              pending={pendingAction === "save"}
              pendingText={translate("Čuvanje datuma…", "Saving date…")}
              className="button button-primary"
              type="submit"
            >
              {translate("Sačuvaj datum", "Save date")}
            </ActionButton>
            {availability && (
              <button
                type="button"
                className="button button-outline"
                onClick={handleCancel}
              >
                {translate("Odustani", "Cancel")}
              </button>
            )}
          </div>
        </form>
      )}
      {/* Ne dupliramo roditeljsku potvrdu; grešku prikazujemo uz izabrani datum. */}
      {saveResult && !saveResult.saved && (
        <SaveFeedback kind="error" title={saveResult.message} />
      )}
    </div>
  );
}
