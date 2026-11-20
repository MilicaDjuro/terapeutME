"use client";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  LockKeyhole,
  NotebookPen,
  Plus,
  RefreshCw,
} from "lucide-react";
import type {
  TherapistClientNote,
  TherapistNoteClient,
} from "@terapeut/domain";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { accountHome, authErrorMessage } from "@/lib/auth-client";
import { requestTherapistNotes } from "@/lib/therapist-notes-client";
import {
  ActionButton,
  Loading,
  PendingStatus,
  SaveFeedback,
} from "@/components/ui";

/** Čeka JWT provjeru prije prikaza; promjena naloga uklanja stare privatne bilješke iz memorije prikaza. */
export function TherapistNotesPage({
  initialClientId = "",
}: {
  initialClientId?: string;
}) {
  const { user, loading, error, refreshAccount } = useAuth();
  const { translate } = useDemo();
  const router = useRouter();
  useEffect(() => {
    if (loading || error) return;
    if (!user) router.replace("/login");
    else if (user.role !== "THERAPIST") router.replace(accountHome(user));
  }, [user, loading, error, router]);
  if (error)
    return (
      <div className="container page-space">
        <p role="alert">{error}</p>
        <button className="button button-primary" onClick={refreshAccount}>
          {translate("Pokušaj ponovo", "Try again")}
        </button>
      </div>
    );
  if (loading || user?.role !== "THERAPIST") return <Loading />;
  return (
    <NotesWorkspace
      key={`${user.id}-${initialClientId}`}
      initialClientId={initialClientId}
    />
  );
}

/** Učitava samo izabranog klijenta; zasebne imenovane radnje čuvaju, mijenjaju i arhiviraju bilješke. */
function NotesWorkspace({ initialClientId }: { initialClientId: string }) {
  const { translate, locale } = useDemo();
  const [clients, setClients] = useState<TherapistNoteClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [notes, setNotes] = useState<TherapistClientNote[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [clientsError, setClientsError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeVersion, setNoticeVersion] = useState(0);
  const [editing, setEditing] = useState<TherapistClientNote | "new" | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const pending = useRef<AbortController | null>(null);
  const initialChoiceApplied = useRef(false);
  const selectedClient = clients.find(
    (client) => client.id === selectedClientId,
  );
  const busy = Boolean(pendingAction);
  const unavailableClientMessage = translate(
    "Odabrani klijent nije dostupan. Izaberite svog klijenta iz liste.",
    "The selected client is unavailable. Choose one of your clients.",
  );

  // Lista klijenata ne sadrži bilješke; početni URL mora odgovarati vlastitom klijentu.
  useEffect(() => {
    const controller = new AbortController();
    /** Čita vlastite klijente i odbija nedostupan izbor iz URL-a bez prikaza drugog klijenta. */
    async function loadClients() {
      setLoadingClients(true);
      try {
        const result = await requestTherapistNotes(
          "/clients",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const ownClients = result.clients || [];
        setClients(ownClients);
        setClientsError("");
        if (initialClientId && !initialChoiceApplied.current) {
          if (ownClients.some((client) => client.id === initialClientId))
            setSelectedClientId(initialClientId);
          else setClientsError(unavailableClientMessage);
        }
        initialChoiceApplied.current = true;
      } catch (failure) {
        if (!controller.signal.aborted)
          setClientsError(authErrorMessage(failure));
      } finally {
        if (!controller.signal.aborted) setLoadingClients(false);
      }
    }
    void loadClients();
    return () => controller.abort();
  }, [initialClientId, unavailableClientMessage, reload]);

  // Promjena izbora ili odjava prekida stari odgovor, da se bilješka ne pojavi uz pogrešnog klijenta.
  useEffect(() => {
    const controller = new AbortController();
    setNotes([]);
    if (!selectedClientId) {
      setLoadingNotes(false);
      return () => controller.abort();
    }
    /** Čita bilješke samo izabrane veze terapeut–klijent; nema automatskog prepisivanja otvorenog formulara. */
    async function loadNotes() {
      setLoadingNotes(true);
      try {
        const result = await requestTherapistNotes(
          `?clientId=${encodeURIComponent(selectedClientId)}`,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setNotes(result.notes || []);
          setError("");
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(authErrorMessage(failure));
      } finally {
        if (!controller.signal.aborted) setLoadingNotes(false);
      }
    }
    void loadNotes();
    return () => controller.abort();
  }, [selectedClientId, reload]);

  // Odlazak sa stranice prekida HTTP čekanje; već potvrđen upis baze ostaje sačuvan.
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );

  /** Mijenja klijenta samo kada nema otvorenog unosa; novi izbor ne koristi prethodne bilješke. */
  function handleClientChange(event: ChangeEvent<HTMLSelectElement>) {
    if (editing || pending.current) return;
    setSelectedClientId(event.target.value);
    setNotes([]);
    setError("");
    setClientsError("");
    setNotice("");
  }
  /** Ponovo čita server nakon greške ili izmjene u drugom tabu; otvoreni unos ostaje zaštićen. */
  function handleRefresh() {
    if (editing || pending.current) return;
    setError("");
    setNotice("");
    setReload(reload + 1);
  }
  /** Otvara prazan formular tek poslije izbora vlastitog klijenta. */
  function handleCreate() {
    if (!selectedClient || busy) return;
    setEditing("new");
    setTitle("");
    setContent("");
    setError("");
    setNotice("");
  }
  /** Pamti verziju bilješke koja je otvorena; kasnija tuđa izmjena izaziva konflikt, bez gubitka unosa. */
  function handleEdit(note: TherapistClientNote) {
    setEditing(note);
    setTitle(note.title);
    setContent(note.content);
    setError("");
    setNotice("");
  }
  /** Zatvara formular bez upisa; tokom slanja je onemogućeno napuštanje ovog unosa. */
  function handleCancel() {
    if (pending.current) return;
    setEditing(null);
    setTitle("");
    setContent("");
    setError("");
  }
  /** Novi unos uklanja staru poruku uspjeha ili greške. */
  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    setTitle(event.target.value);
    setNotice("");
    setError("");
  }
  /** Čuva lokalni tekst samo u React memoriji dok korisnik ne potvrdi upis. */
  function handleContentChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setContent(event.target.value);
    setNotice("");
    setError("");
  }

  /** Server provjerava vlasništvo i verziju; uspjeh prikazujemo tek nakon potvrđenog upisa baze. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !selectedClient || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setPendingAction("save");
    setError("");
    setNotice("");
    try {
      const result = await requestTherapistNotes(
        editing === "new" ? "" : `/${editing.id}/update`,
        {
          clientUserId: selectedClient.id,
          title,
          content,
          version: editing === "new" ? undefined : editing.version,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!result.note) throw new Error("Missing saved note");
      const saved = result.note;
      setNotes((current) =>
        editing === "new"
          ? [saved, ...current]
          : current.map((note) => (note.id === saved.id ? saved : note)),
      );
      setEditing(null);
      setTitle("");
      setContent("");
      setNotice(
        translate(
          "Bilješka je sačuvana. Vidljiva je samo vama.",
          "Note saved. Only you can see it.",
        ),
      );
      setNoticeVersion((value) => value + 1);
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setPendingAction("");
      }
    }
  }

  /** Arhivira nakon potvrde; u prikazu uklanja bilješku tek kad server potvrdi vlasnički upis. */
  async function handleArchive(note: TherapistClientNote) {
    if (pending.current || editing) return;
    if (
      !window.confirm(
        translate(
          "Arhivirati ovu bilješku? Nestaće iz aktivnog pregleda, a zapis ostaje u bazi.",
          "Archive this note? It will leave the active list, while the record remains stored.",
        ),
      )
    )
      return;
    const controller = new AbortController();
    pending.current = controller;
    setPendingAction(`archive:${note.id}`);
    setError("");
    setNotice("");
    try {
      const result = await requestTherapistNotes(
        `/${note.id}/archive`,
        { version: note.version },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!result.archived) throw new Error("Missing archive confirmation");
      setNotes((current) => current.filter((item) => item.id !== note.id));
      setNotice(translate("Bilješka je arhivirana.", "Note archived."));
      setNoticeVersion((value) => value + 1);
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setPendingAction("");
      }
    }
  }
  /** Datume čita po zoni Podgorice; izmjena ne mijenja datum nastanka bilješke. */
  function formatTimestamp(value: string) {
    return new Intl.DateTimeFormat(locale === "mne" ? "sr-Latn-ME" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Podgorica",
    }).format(new Date(value));
  }

  return (
    <div className="container page-space notes-page">
      <Link href="/dashboard" className="back-link">
        <ArrowLeft size={16} />
        {translate("Moj pregled", "My dashboard")}
      </Link>
      <div className="requests-heading">
        <div>
          <span className="eyebrow">
            <LockKeyhole size={17} aria-hidden="true" />{" "}
            {translate("SAMO ZA VAS", "ONLY FOR YOU")}
          </span>
          <h1>{translate("Privatne bilješke", "Private notes")}</h1>
          <p className="muted">
            {translate(
              "Izaberite svog klijenta. Bilješke može vidjeti i uređivati samo terapeut koji ih je napisao.",
              "Choose your client. Only the therapist who wrote a note can view or edit it.",
            )}
          </p>
        </div>
        <ActionButton
          className="button button-outline"
          onClick={handleRefresh}
          pending={loadingClients || loadingNotes}
          disabled={busy || Boolean(editing)}
          pendingText={translate("Učitavanje…", "Loading…")}
        >
          <RefreshCw size={16} />
          {translate("Osvježi bilješke", "Refresh notes")}
        </ActionButton>
      </div>
      <div className="notes-client-picker">
        <label>
          {translate("Klijent", "Client")}
          <select
            value={selectedClientId}
            onChange={handleClientChange}
            disabled={loadingClients || busy || Boolean(editing)}
          >
            <option value="">
              {translate("Izaberite klijenta", "Choose a client")}
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.email})
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          {editing
            ? translate(
                "Završite unos ili odustanite prije promjene klijenta.",
                "Save or cancel before switching clients.",
              )
            : translate(
                "Lista prikazuje samo klijente koji imaju zahtjev ili termin kod vas.",
                "Only clients with a request or session with you are listed.",
              )}
        </p>
      </div>
      {loadingClients && (
        <PendingStatus>
          {translate("Učitavanje vaših klijenata…", "Loading your clients…")}
        </PendingStatus>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {clientsError && (
        <p className="form-error" role="alert">
          {clientsError}
        </p>
      )}
      {notice && (
        <SaveFeedback key={noticeVersion} kind="success" title={notice} />
      )}
      {!loadingClients && clients.length === 0 && !clientsError && (
        <p className="empty-state">
          {translate(
            "Još nemate klijenata sa zahtjevom ili terminom. Kada se pojave, ovdje možete dodavati njihove privatne bilješke.",
            "You have no clients with a request or session yet. Once you do, you can add private notes here.",
          )}
        </p>
      )}
      {selectedClient && (
        <section aria-labelledby="client-notes-title">
          <div className="requests-heading">
            <div>
              <h2 id="client-notes-title">
                {translate(
                  `Bilješke za ${selectedClient.name}`,
                  `Notes for ${selectedClient.name}`,
                )}
              </h2>
              <p className="muted small">
                <LockKeyhole size={14} aria-hidden="true" />{" "}
                {translate(
                  "Klijent i drugi terapeuti nemaju pristup ovim bilješkama.",
                  "The client and other therapists cannot access these notes.",
                )}
              </p>
            </div>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || Boolean(editing) || loadingNotes}
              onClick={handleCreate}
            >
              <Plus size={16} />
              {translate("Dodaj bilješku", "Add note")}
            </button>
          </div>
          {editing && (
            <form className="notes-editor" onSubmit={handleSave}>
              <h3>
                {editing === "new"
                  ? translate("Nova bilješka", "New note")
                  : translate("Uredi bilješku", "Edit note")}
              </h3>
              <label>
                {translate("Naslov bilješke", "Note title")}
                <input
                  name="title"
                  value={title}
                  onChange={handleTitleChange}
                  maxLength={160}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                {translate("Tekst bilješke", "Note text")}
                <textarea
                  name="content"
                  value={content}
                  onChange={handleContentChange}
                  maxLength={20000}
                  rows={9}
                  required
                  disabled={busy}
                />
              </label>
              <p className="muted small">
                {content.length} / 20000 ·{" "}
                {translate(
                  "Bilješka se čuva tek kada kliknete Sačuvaj.",
                  "The note is stored only after you click Save.",
                )}
              </p>
              <div className="booking-actions">
                <ActionButton
                  type="submit"
                  className="button button-primary"
                  pending={pendingAction === "save"}
                  disabled={busy}
                  pendingText={translate("Čuvanje bilješke…", "Saving note…")}
                >
                  {translate("Sačuvaj bilješku", "Save note")}
                </ActionButton>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={handleCancel}
                  disabled={busy}
                >
                  {translate("Odustani", "Cancel")}
                </button>
              </div>
            </form>
          )}
          {loadingNotes ? (
            <PendingStatus>
              {translate(
                "Učitavanje privatnih bilješki…",
                "Loading private notes…",
              )}
            </PendingStatus>
          ) : (
            <div className="notes-list">
              {notes.map((note) => (
                <article
                  className="private-note"
                  key={note.id}
                  aria-label={note.title}
                >
                  <div className="requests-heading">
                    <h3>
                      <NotebookPen size={18} aria-hidden="true" /> {note.title}
                    </h3>
                    <span className="small muted">
                      {translate("Privatno", "Private")}
                    </span>
                  </div>
                  <p className="preserve-lines private-note-content">
                    {note.content}
                  </p>
                  <p className="muted small">
                    {translate("Kreirano", "Created")}:{" "}
                    {formatTimestamp(note.createdAt)} ·{" "}
                    {translate("Posljednja izmjena", "Last updated")}:{" "}
                    {formatTimestamp(note.updatedAt)}
                  </p>
                  <div className="booking-actions">
                    <button
                      type="button"
                      className="button button-outline button-sm"
                      onClick={() => handleEdit(note)}
                      disabled={busy || Boolean(editing)}
                    >
                      {translate("Uredi bilješku", "Edit note")}
                    </button>
                    <ActionButton
                      type="button"
                      className="button button-outline button-sm"
                      pending={pendingAction === `archive:${note.id}`}
                      pendingText={translate("Arhiviranje…", "Archiving…")}
                      disabled={busy || Boolean(editing)}
                      onClick={() => handleArchive(note)}
                    >
                      {translate("Arhiviraj bilješku", "Archive note")}
                    </ActionButton>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!loadingNotes && notes.length === 0 && !editing && !error && (
            <p className="empty-state">
              {translate(
                "Za ovog klijenta još nemate privatnih bilješki.",
                "You have no private notes for this client yet.",
              )}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
