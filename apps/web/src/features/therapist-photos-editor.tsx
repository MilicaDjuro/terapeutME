"use client";
import { useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/lib/demo-context";
import { useDirectory } from "@/lib/directory-context";
import { AuthRequestError, authErrorMessage } from "@/lib/auth-client";
import { ActionButton, PendingStatus, SaveFeedback } from "@/components/ui";

interface Photo {
  id: string;
  url: string;
  primary: boolean;
}

/** Prikazuje serversku grešku slanja/brisanja bez zamjene neuspjeha porukom o uspjehu. */
async function checkPhotoResponse(response: Response) {
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  throw new AuthRequestError(
    typeof body?.message === "string"
      ? body.message
      : "Fotografiju nije moguće sačuvati.",
    response.status,
  );
}

/** Omogućava terapeutu da čuva, bira profilnu i briše svoje fotografije u bazi. */
export function TherapistPhotosEditor({
  photos,
  onChanged,
  refreshing = false,
}: {
  photos: Photo[];
  onChanged: () => void;
  refreshing?: boolean;
}) {
  const { translate } = useDemo();
  const { refresh } = useDirectory();
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [pendingPhotoId, setPendingPhotoId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inProgress = useRef(false);
  const busy = submitting || refreshing;

  /** Izbor nove datoteke uklanja potvrdu prethodne slike; novu sliku još nijesmo poslali. */
  function handlePhotoSelection() {
    setNotice("");
    setError("");
  }

  /** Šalje datoteku multipart zahtjevom; browser sam postavlja boundary, a server provjerava sliku. */
  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inProgress.current || refreshing) return;
    setNotice("");
    const form = event.currentTarget;
    const body = new FormData(form);
    const photo = body.get("photo");
    if (!(photo instanceof File) || photo.size > 5 * 1024 * 1024) {
      setError(
        translate(
          "Izaberite fotografiju do 5 MB.",
          "Choose a photo up to 5 MB.",
        ),
      );
      return;
    }
    inProgress.current = true;
    setPendingAction("upload");
    setSubmitting(true);
    setError("");
    try {
      await checkPhotoResponse(
        await fetch("/api/v1/auth/therapist-profile/photos", {
          method: "POST",
          body,
          credentials: "same-origin",
        }),
      );
      form.reset();
      setNotice(translate("Fotografija je sačuvana.", "Photo saved."));
      await refresh();
      onChanged();
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      inProgress.current = false;
      setSubmitting(false);
      setPendingAction("");
    }
  }

  /** Traži izmjenu samo označene slike; server ponovo provjerava vlasništvo. */
  async function changePhoto(id: string, action: "primary" | "delete") {
    if (inProgress.current || refreshing) return;
    setNotice("");
    inProgress.current = true;
    // ID određuje koja fotografija ima spinner, a sve ostale kontrole čekaju završetak.
    setPendingAction(action);
    setPendingPhotoId(id);
    setSubmitting(true);
    setError("");
    try {
      const path = `/api/v1/auth/therapist-profile/photos/${encodeURIComponent(id)}${action === "primary" ? "/primary" : ""}`;
      await checkPhotoResponse(
        await fetch(path, {
          method: action === "primary" ? "POST" : "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      setNotice(
        action === "primary"
          ? translate(
              "Profilna fotografija je promijenjena.",
              "Profile photo updated.",
            )
          : translate("Fotografija je obrisana.", "Photo deleted."),
      );
      await refresh();
      onChanged();
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      inProgress.current = false;
      setSubmitting(false);
      setPendingAction("");
      setPendingPhotoId("");
    }
  }

  /** Bira fotografiju koja će se prikazivati u kartici kataloga. */
  function handlePrimaryPhoto(id: string) {
    void changePhoto(id, "primary");
  }
  /** Briše vlastitu fotografiju; brisanje naloga ili rezervacija nije dio ove radnje. */
  function handleDeletePhoto(id: string) {
    void changePhoto(id, "delete");
  }

  return (
    <section className="photos-editor" aria-labelledby="own-photos-title">
      <h3 id="own-photos-title">
        {translate("Vaše fotografije", "Your photos")}
      </h3>
      <p>
        {translate(
          "Dodajte do 8 fotografija, najviše 5 MB po fotografiji. Fotografije su vidljive na vašem javnom profilu.",
          "Add up to 8 photos, up to 5 MB each. Photos are visible on your public profile.",
        )}
      </p>
      {submitting && (
        <PendingStatus>
          {translate("Čuvanje izmjene fotografija…", "Saving photo changes…")}
        </PendingStatus>
      )}
      {notice && <SaveFeedback kind="success" title={notice} />}
      <div className="own-photo-grid">
        {photos.map((photo) => (
          <article key={photo.id} className="own-photo">
            <img
              src={photo.url}
              alt={translate("Vaša fotografija", "Your photo")}
            />
            <div>
              {photo.primary ? (
                <span className="verified">
                  {translate("Profilna fotografija", "Profile photo")}
                </span>
              ) : (
                <ActionButton
                  pending={
                    submitting &&
                    pendingAction === "primary" &&
                    pendingPhotoId === photo.id
                  }
                  pendingText={translate("Postavljanje…", "Updating…")}
                  className="button button-outline button-sm"
                  disabled={busy}
                  onClick={() => handlePrimaryPhoto(photo.id)}
                >
                  {translate("Postavi kao profilnu", "Set as profile photo")}
                </ActionButton>
              )}
              <ActionButton
                pending={
                  submitting &&
                  pendingAction === "delete" &&
                  pendingPhotoId === photo.id
                }
                pendingText={translate("Brisanje…", "Deleting…")}
                className="button button-quiet button-sm"
                disabled={busy}
                onClick={() => handleDeletePhoto(photo.id)}
              >
                {translate("Obriši fotografiju", "Delete photo")}
              </ActionButton>
            </div>
          </article>
        ))}
      </div>
      <form onSubmit={handleUpload} aria-busy={submitting}>
        <label className="field">
          <span>
            {translate(
              "Fotografija (JPG, PNG ili WebP)",
              "Photo (JPG, PNG or WebP)",
            )}
          </span>
          <input
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            disabled={busy || photos.length >= 8}
            onChange={handlePhotoSelection}
          />
        </label>
        {error && (
          <SaveFeedback
            kind="error"
            title={translate(
              "Izmjena fotografije nije sačuvana.",
              "Photo change was not saved.",
            )}
          >
            {error}
          </SaveFeedback>
        )}
        <ActionButton
          pending={submitting && pendingAction === "upload"}
          className="button button-primary"
          disabled={busy || photos.length >= 8}
        >
          {submitting && pendingAction === "upload"
            ? translate("Čuvanje fotografije…", "Saving photo…")
            : translate("Sačuvaj fotografiju", "Save photo")}
        </ActionButton>
      </form>
    </section>
  );
}
