"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ActionButton, SaveFeedback } from "@/components/ui";
import { useDemo } from "@/lib/demo-context";
import { useDirectory } from "@/lib/directory-context";
import { authErrorMessage } from "@/lib/auth-client";
import { requestBookingApi, type ServerBooking } from "@/lib/booking-client";

/** Klijent ocjenjuje samo jednu završenu seansu; javni profil dobija samo zbir. */
export function SessionRating({ booking }: { booking: ServerBooking }) {
  const { translate } = useDemo();
  const { refresh } = useDirectory();
  const [selectedScore, setSelectedScore] = useState("");
  const [savedRating, setSavedRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const rating = savedRating ?? booking.rating;

  useEffect(() => {
    /** Odjava i zatvaranje kartice prekidaju čekanje; server može već završiti upis. */
    function stopSaving() {
      pending.current?.abort();
    }
    return stopSaving;
  }, []);

  /** Izbor se čuva u formularu do uspješnog API odgovora, uključujući mrežnu grešku. */
  function handleScoreChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSelectedScore(event.target.value);
    setError("");
  }

  /** Jedan klik šalje samo broj 1–5; server ponavlja provjere vlasništva i završetka. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !selectedScore) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    try {
      const response = await requestBookingApi(
        `bookings/${booking.id}/rating`,
        { score: selectedScore },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        if (response.rating === undefined)
          throw new Error("Nedostaje potvrda ocjene.");
        setSavedRating(response.rating);
        setSaved(true);
        // Novi zbir dolazi iz baze. Ne sabiramo u browseru, da ponovni klik ne doda bodove.
        void refresh();
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }

  // Proteklo vrijeme potvrđene seanse je dovoljno; ne tražimo ručnu oznaku terapeuta.
  if (!["CONFIRMED", "COMPLETED"].includes(booking.status)) return null;
  if (rating == null && !booking.canRate) return null;
  return (
    <section
      className="session-rating"
      aria-label={translate("Ocjena seanse", "Session rating")}
    >
      {rating != null ? (
        <p>
          <strong>
            {translate("Vaša ocjena", "Your rating")}: {rating}/5
          </strong>
          <span className="muted small">
            {translate(
              "Hvala što ste podijelili svoje zadovoljstvo seansom.",
              "Thank you for sharing your session feedback.",
            )}
          </span>
        </p>
      ) : (
        <form onSubmit={handleSave} aria-busy={saving}>
          <fieldset disabled={saving}>
            <legend>
              {translate(
                "Koliko ste zadovoljni ovom seansom?",
                "How satisfied are you with this session?",
              )}
            </legend>
            <p className="muted small">
              {translate(
                "1 — veoma nezadovoljan/na · 5 — veoma zadovoljan/na",
                "1 — very dissatisfied · 5 — very satisfied",
              )}
            </p>
            <div className="session-rating-options">
              {[1, 2, 3, 4, 5].map((score) => (
                <label key={score}>
                  <input
                    type="radio"
                    name={`rating-${booking.id}`}
                    value={score}
                    checked={selectedScore === String(score)}
                    onChange={handleScoreChange}
                    required
                  />
                  <span>{score}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="muted small">
            {translate(
              "Ocjenu šaljete jednom po seansi. Na profilu terapeuta prikazuju se samo zbir bodova i broj ocjena, bez vašeg imena.",
              "Submit one rating per session. The therapist profile shows only total points and rating count, without your name.",
            )}
          </p>
          <ActionButton
            type="submit"
            pending={saving}
            disabled={saving || !selectedScore}
            className="button button-primary"
          >
            {translate("Pošalji ocjenu", "Submit rating")}
          </ActionButton>
        </form>
      )}
      {error && <SaveFeedback kind="error" title={error} />}
      {saved && (
        <SaveFeedback
          kind="success"
          title={translate("Ocjena je sačuvana.", "Rating saved.")}
        />
      )}
    </section>
  );
}
