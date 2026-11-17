"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { type Therapist } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { useDirectory } from "@/lib/directory-context";
import { authErrorMessage } from "@/lib/auth-client";
import {
  requestBookingApi,
  type ScheduleSaveResult,
} from "@/lib/booking-client";
import { getWeekdayNames, timeToMinutes } from "@/lib/format";
import { SessionEditor } from "./session-editor";
import { ActionButton, PendingStatus, SaveFeedback } from "@/components/ui";
import { TimeField, readTimeField } from "@/components/time-field";
import {
  CalendarDays,
  ChevronDown,
  Clock3,
  SlidersHorizontal,
} from "lucide-react";
import {
  WeeklyWindowEditor,
  DateAvailabilityEditor,
} from "./availability-editor";

/** Uređuje stvarni raspored terapeuta; svaki upis server ograničava na vlasnika JWT sesije. */
export function ScheduleEditor() {
  const { translate, locale } = useDemo();
  const { refresh } = useDirectory();
  const [therapist, setTherapist] = useState<Therapist | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addingWindow, setAddingWindow] = useState(false);
  const [windowResult, setWindowResult] = useState<ScheduleSaveResult | null>(
    null,
  );
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const weekdayNames = getWeekdayNames(locale);
  // Pri otvaranju učitavamo raspored; zatvaranje prekida čekanje i sprečava odgovor starog naloga.
  useEffect(() => {
    const controller = new AbortController();
    /** Učitava vlastiti profil i radno vrijeme iz API-ja. */
    async function loadSchedule() {
      setError("");
      setLoading(true);
      try {
        const response = await requestBookingApi(
          "schedule",
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted)
          setTherapist(response.therapist || null);
      } catch (failure) {
        if (!controller.signal.aborted) setError(authErrorMessage(failure));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadSchedule();
    /** Prekida učitavanje i čuvanje kada korisnik napusti ovaj nalog. */
    function stopLoading() {
      controller.abort();
      pending.current?.abort();
    }
    return stopLoading;
  }, [reload]);
  /** Čuva izmjenu i osvježava javni katalog; poruku uspjeha prikazuje tek nakon API odgovora. */
  async function saveSchedule(
    body: Record<string, string>,
  ): Promise<ScheduleSaveResult> {
    if (pending.current)
      return {
        saved: false,
        message: translate(
          "Sačekajte završetak prethodnog čuvanja.",
          "Please wait for the previous save to finish.",
        ),
      };
    const controller = new AbortController();
    pending.current = controller;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await requestBookingApi(
        "schedule",
        body,
        controller.signal,
      );
      if (controller.signal.aborted)
        return {
          saved: false,
          message: translate(
            "Čekanje je prekinuto. Provjerite raspored prije ponovnog čuvanja.",
            "Waiting was interrupted. Check the schedule before saving again.",
          ),
        };
      if (!response.therapist) throw new Error("Nedostaje sačuvani raspored.");
      setTherapist(response.therapist || null);
      // Jedna zajednička potvrda opisuje tačno onu radnju koju je server sačuvao.
      const message =
        response.notice === "window-already-exists"
          ? translate(
              "Radno vrijeme je već sačuvano.",
              "These working hours are already saved.",
            )
          : getSavedMessage(body);
      setNotice(message);
      void refresh();
      return { saved: true, message };
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
      return { saved: false, message: authErrorMessage(failure) };
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSubmitting(false);
      }
    }
  }
  /** Opisuje potvrđenu izmjenu; poziva se tek poslije uspješnog odgovora API-ja. */
  function getSavedMessage(body: Record<string, string>): string {
    if (body.action === "service")
      return translate("Seansa je sačuvana.", "Session saved.");
    if (body.action === "remove-service")
      return translate(
        "Seansa je uklonjena iz ponude.",
        "Session removed from your services.",
      );
    if (body.action === "window" || body.action === "date-availability")
      return translate("Raspored je sačuvan.", "Schedule saved.");
    if (body.action === "remove-window")
      return translate("Radni period je uklonjen.", "Working period removed.");
    return translate(
      "Sedmični raspored je vraćen.",
      "Weekly schedule restored.",
    );
  }
  /** Novi unos uklanja potvrdu prethodnog unosa, da nezapisani sati ne izgledaju sačuvano. */
  function handleWindowChange() {
    setWindowResult(null);
  }
  /** Potvrda prethodnog čuvanja ne opisuje novi, još nesačuvani unos. */
  function handleScheduleChange() {
    setNotice("");
    setError("");
  }
  /** Pretvara sate formulara u minute i dodaje jedan sedmični period dostupnosti. */
  async function handleAddWindow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const end = timeToMinutes(readTimeField(form, "end"));
    setAddingWindow(true);
    setWindowResult(null);
    try {
      const result = await saveSchedule({
        action: "window",
        weekday: String(form.get("weekday")),
        start: String(timeToMinutes(readTimeField(form, "start"))),
        end: String(end === 0 ? 1440 : end),
      });
      setWindowResult(result);
    } finally {
      setAddingWindow(false);
    }
  }
  /** Ponovo učitava raspored kada prvi HTTP zahtjev nije uspio. */
  function handleReload() {
    setReload(reload + 1);
  }
  return (
    <section
      className="auth-card schedule-editor"
      aria-busy={submitting || loading}
    >
      <h2>
        {translate("Radno vrijeme i seanse", "Working hours and sessions")}
      </h2>
      <p>
        {translate(
          "Uredite tip, trajanje i cijenu seanse, sedmične sate ili raspored za konkretan datum. Seansa mora cijela stati u slobodan period.",
          "Edit session types, durations and prices, weekly hours or a specific date. The entire session must fit inside an available period.",
        )}
      </p>
      <div className="schedule-feedback">
        {error && (
          <SaveFeedback
            kind="error"
            title={
              therapist
                ? translate(
                    "Izmjene nijesu sačuvane.",
                    "Changes were not saved.",
                  )
                : translate("Raspored nije učitan.", "Schedule was not loaded.")
            }
          >
            {error}
          </SaveFeedback>
        )}
        {notice && <SaveFeedback kind="success" title={notice} />}
        {submitting && (
          <SaveFeedback
            kind="pending"
            title={translate("Čuvanje izmjena…", "Saving changes…")}
          >
            {translate(
              "Sačekajte potvrdu prije nove izmjene.",
              "Please wait for confirmation before making another change.",
            )}
          </SaveFeedback>
        )}
      </div>
      {loading ? (
        <PendingStatus>
          {translate("Učitavanje rasporeda…", "Loading schedule…")}
        </PendingStatus>
      ) : !therapist ? (
        <button className="button button-outline" onClick={handleReload}>
          {translate("Učitaj raspored", "Load schedule")}
        </button>
      ) : (
        <fieldset
          disabled={submitting}
          onChange={handleScheduleChange}
          className="schedule-fields"
        >
          {/* Zatvaranje sekcije samo sakriva prikaz: nesačuvani unos ostaje u formularu. */}
          <details className="schedule-section" id="session-types">
            <summary>
              <SlidersHorizontal size={21} aria-hidden="true" />
              <span>
                <strong>
                  {translate(
                    "Usluge i vrste seanse",
                    "Services and session types",
                  )}
                </strong>
                <small>
                  {translate(
                    "Naziv, trajanje i cijena vaših seansi",
                    "Session names, durations and prices",
                  )}
                </small>
              </span>
              <ChevronDown size={20} aria-hidden="true" />
            </summary>
            <div className="schedule-section-content">
              {therapist.services
                .filter((service) => service.active)
                .map((service) => (
                  <SessionEditor
                    key={service.id}
                    service={service}
                    onSave={saveSchedule}
                  />
                ))}
              <SessionEditor onSave={saveSchedule} />
            </div>
          </details>
          <details className="schedule-section" id="weekly-availability">
            <summary>
              <Clock3 size={21} aria-hidden="true" />
              <span>
                <strong>
                  {translate("Sedmično radno vrijeme", "Weekly working hours")}
                </strong>
                <small>
                  {translate(
                    "Dani i sati koji se ponavljaju svake sedmice",
                    "Recurring working days and hours",
                  )}
                </small>
              </span>
              <ChevronDown size={20} aria-hidden="true" />
            </summary>
            <div className="schedule-section-content">
              <ul className="availability-list">
                {therapist.availability.map((window) => (
                  <WeeklyWindowEditor
                    key={window.id}
                    window={window}
                    onSave={saveSchedule}
                  />
                ))}
              </ul>
              {!therapist.availability.length && (
                <p>
                  {translate(
                    "Još nijeste unijeli sedmično radno vrijeme. Možete unijeti i pojedinačne datume ispod.",
                    "You have not set weekly hours yet. You can also add individual dates below.",
                  )}
                </p>
              )}
              <form
                onSubmit={handleAddWindow}
                onChange={handleWindowChange}
                className="schedule-form"
              >
                <label className="field">
                  <span id="working-weekday-label">
                    {translate("Dan", "Weekday")}
                  </span>
                  <select
                    name="weekday"
                    aria-labelledby="working-weekday-label"
                    defaultValue="1"
                  >
                    {weekdayNames.map((name, index) => (
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
                    defaultValue="09:00"
                  />
                  <TimeField
                    name="end"
                    label={translate("Radno vrijeme do", "Working hours until")}
                    defaultValue="17:00"
                  />
                </div>
                <p className="muted small">
                  {translate(
                    "Vrijeme je u formatu 24 sata. Završetak u 00:00 znači ponoć na kraju dana.",
                    "Times use the 24-hour clock. An end of 00:00 means midnight at the end of the day.",
                  )}
                </p>
                <ActionButton
                  pending={addingWindow}
                  pendingText={translate(
                    "Dodavanje radnog vremena…",
                    "Adding working hours…",
                  )}
                  className="button button-primary"
                >
                  {translate("Dodaj radno vrijeme", "Add working hours")}
                </ActionButton>
                {windowResult && !windowResult.saved && (
                  <SaveFeedback kind="error" title={windowResult.message} />
                )}
              </form>
            </div>
          </details>
          <details className="schedule-section" id="date-availability">
            <summary>
              <CalendarDays size={21} aria-hidden="true" />
              <span>
                <strong>
                  {translate("Dostupnost po datumu", "Availability by date")}
                </strong>
                <small>
                  {translate(
                    "Posebni radni sati i neradni dani",
                    "Special working hours and days off",
                  )}
                </small>
              </span>
              <ChevronDown size={20} aria-hidden="true" />
            </summary>
            <div className="schedule-section-content">
              <p>
                {translate(
                  "Raspored za konkretan datum zamjenjuje sedmične sate samo tog dana. Odznačite radni dan ako tog datuma ne primate klijente.",
                  "A date schedule replaces weekly hours for that day only. Uncheck the working day if you do not see clients on that date.",
                )}
              </p>
              {(therapist.dateAvailability || []).map((availability) => (
                <DateAvailabilityEditor
                  key={availability.id}
                  availability={availability}
                  onSave={saveSchedule}
                />
              ))}
              <DateAvailabilityEditor onSave={saveSchedule} />
            </div>
          </details>
          <p>
            {translate(
              "Promjena radnog vremena ne otkazuje već zakazane seanse. Njih mijenjate u listi zahtjeva.",
              "Changing working hours does not cancel booked sessions. Manage them in the requests list.",
            )}
          </p>
        </fieldset>
      )}
    </section>
  );
}
