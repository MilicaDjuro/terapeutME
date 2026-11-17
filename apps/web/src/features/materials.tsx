"use client";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { BookOpen, Download, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { authErrorMessage } from "@/lib/auth-client";
import {
  downloadMaterial,
  requestMaterials,
  type ClientMaterial,
  type MaterialClient,
  type MaterialKind,
} from "@/lib/materials-client";
import { ActionButton, PendingStatus, SaveFeedback } from "@/components/ui";
import { formatDate } from "@/lib/format";

/** Zajednički privatni pregled: terapeut dodjeljuje svojim klijentima, a klijent čita samo svoje zadatke. */
export function ClientMaterials() {
  const { user } = useAuth();
  const { translate } = useDemo();
  const therapistView = user?.role === "THERAPIST";
  const [materials, setMaterials] = useState<ClientMaterial[]>([]);
  const [clients, setClients] = useState<MaterialClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeVersion, setNoticeVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClientMaterial | null>(null);
  const selectedClient = clients.find(
    (client) => client.id === selectedClientId,
  );
  const visibleMaterials = selectedClientId
    ? materials.filter((material) => material.clientUserId === selectedClientId)
    : materials;

  // Pozadinsko osvježavanje ne resetuje otvoreni formular ili korisnikov nedovršeni unos.
  useEffect(() => {
    let stopped = false;
    let pending: AbortController | undefined;
    /** Učitava metapodatke iz privatnog API-ja, bez preuzimanja PDF dokumenata u pozadini. */
    async function loadMaterials() {
      if (document.visibilityState !== "visible") return;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await requestMaterials(
          "",
          undefined,
          controller.signal,
        );
        if (stopped || controller.signal.aborted) return;
        setMaterials(response.materials || []);
        setClients(response.clients || []);
        setError("");
      } catch (failure) {
        if (!stopped && !controller.signal.aborted)
          setError(authErrorMessage(failure));
      } finally {
        if (!stopped && !controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void loadMaterials();
    const timer = window.setInterval(() => {
      void loadMaterials();
    }, 30000);
    /** Odmah provjerava nove zadatke kada klijent ponovo otvori tab. */
    function handleVisibility() {
      void loadMaterials();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    /** Pri odjavi uklanja timer, slušač i stari odgovor koji više ne pripada nalogu. */
    function stopLoading() {
      stopped = true;
      pending?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    return stopLoading;
  }, [reload, user?.id]);

  /** Ručno osvježava pregled i prikazuje spinner do odgovora API-ja. */
  function handleRefresh() {
    setRefreshing(true);
    setReload((value) => value + 1);
  }
  /** Izbor drugog klijenta zatvara otvoreni formular da zadatak ne ode pogrešnom primaocu. */
  function handleClientChange(event: ChangeEvent<HTMLSelectElement>) {
    setSelectedClientId(event.target.value);
    setCreating(false);
    setEditing(null);
    setNotice("");
  }
  /** Otvara prazan formular tek poslije izričitog izbora klijenta. */
  function handleCreate() {
    if (!selectedClient) return;
    setCreating(true);
    setEditing(null);
    setNotice("");
  }
  /** Otvara snimak odabranog materijala; server provjerava verziju pri čuvanju. */
  function handleEdit(material: ClientMaterial) {
    setEditing(material);
    setCreating(false);
    setNotice("");
  }
  /** Zatvara formular bez upisa u bazu. */
  function handleCloseEditor() {
    setCreating(false);
    setEditing(null);
  }
  /** Uspješna potvrda API-ja zatvara formular; obnova prikaza čita stvarno sačuvane podatke. */
  function handleSaved() {
    handleCloseEditor();
    setNotice(
      translate(
        "Materijal je sačuvan i dostupan klijentu.",
        "Material saved and available to the client.",
      ),
    );
    setNoticeVersion((value) => value + 1);
    handleRefresh();
  }
  /** Povlačenje uklanja karticu tek poslije potvrde servera i osvježava oba pregleda. */
  function handleArchived(id: string) {
    setMaterials((current) => current.filter((material) => material.id !== id));
    setNotice(translate("Materijal je povučen.", "Material withdrawn."));
    // Novi ključ ponovo prikazuje istu poruku i kada se zaredom povuče više materijala.
    setNoticeVersion((value) => value + 1);
    if (editing?.id === id) handleCloseEditor();
    handleRefresh();
  }

  if (!user || !["CLIENT", "THERAPIST"].includes(user.role)) return null;
  return (
    <section
      id="my-materials"
      className="materials-section"
      aria-labelledby="materials-heading"
    >
      <div className="requests-heading">
        <div>
          <span className="eyebrow">
            <BookOpen size={18} aria-hidden="true" />{" "}
            {translate("PODRŠKA IZMEĐU SEANSI", "SUPPORT BETWEEN SESSIONS")}
          </span>
          <h2 id="materials-heading">
            {translate("Materijali i domaći zadaci", "Materials and homework")}
          </h2>
          <p className="muted small">
            {therapistView
              ? translate(
                  "Dodijelite uputstva, PDF dokumente i preporučene materijale konkretnom klijentu.",
                  "Assign instructions, PDF documents and recommended resources to a specific client.",
                )
              : translate(
                  "Ovdje su zadaci i materijali koje su vaši terapeuti namijenili vama.",
                  "Your therapists’ tasks and materials shared specifically with you.",
                )}
          </p>
        </div>
        <ActionButton
          type="button"
          className="button button-outline button-sm"
          pending={refreshing}
          pendingText={translate("Osvježavanje…", "Refreshing…")}
          onClick={handleRefresh}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {translate("Osvježi materijale", "Refresh materials")}
        </ActionButton>
      </div>
      {loading && (
        <PendingStatus>
          {translate("Učitavanje vaših materijala…", "Loading your materials…")}
        </PendingStatus>
      )}
      {error && <SaveFeedback kind="error" title={error} />}
      {notice && (
        <SaveFeedback key={noticeVersion} kind="success" title={notice} />
      )}
      {therapistView && !loading && (
        <div className="materials-client-picker">
          <label className="field">
            <span>
              {translate("Klijent za materijale", "Client for materials")}
            </span>
            <select value={selectedClientId} onChange={handleClientChange}>
              <option value="">
                {translate("Izaberite klijenta", "Choose a client")}
              </option>
              {clients.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.name} · {client.email}
                </option>
              ))}
            </select>
          </label>
          {!clients.length && !error && (
            <p className="muted">
              {translate(
                "Klijenti se pojavljuju kada imate potvrđenu ili održanu seansu. Materijal može vidjeti samo odabrani klijent i vi.",
                "Clients appear after a confirmed or previous session. Only you and the selected client can access a material.",
              )}
            </p>
          )}
          {selectedClient && !creating && !editing && (
            <button
              type="button"
              className="button button-primary"
              onClick={handleCreate}
            >
              {translate(
                "Dodaj materijal ili zadatak",
                "Add material or homework",
              )}
            </button>
          )}
        </div>
      )}
      {therapistView && (editing || (creating && selectedClient)) && (
        <MaterialEditor
          key={editing?.id || selectedClientId}
          material={editing}
          clientUserId={editing?.clientUserId || selectedClientId}
          clientName={editing?.clientName || selectedClient?.name || ""}
          onSaved={handleSaved}
          onClose={handleCloseEditor}
        />
      )}
      {!loading && !error && !visibleMaterials.length && (
        <p className="materials-empty">
          {translate(
            therapistView
              ? "Nema dodijeljenih materijala za ovaj pregled."
              : "Još nemate dodijeljene zadatke ili materijale. Kada ih terapeut doda, pojaviće se ovdje.",
            therapistView
              ? "No materials assigned in this view."
              : "You have no assigned tasks or materials yet. They will appear here when your therapist adds them.",
          )}
        </p>
      )}
      <div className="materials-list">
        {visibleMaterials.map((material) => (
          <MaterialCard
            key={material.id}
            material={material}
            therapistView={therapistView}
            onEdit={handleEdit}
            onArchived={handleArchived}
          />
        ))}
      </div>
    </section>
  );
}

/** Pretvara sačuvanu oznaku u naziv prikazan korisniku; ne mijenja vrijednost u bazi. */
function materialKindLabel(kind: MaterialKind, english: boolean) {
  if (kind === "HOMEWORK") return english ? "Homework" : "Domaći zadatak";
  if (kind === "EXERCISE") return english ? "Exercise" : "Vježba";
  if (kind === "JOURNAL") return english ? "Journal" : "Dnevnik";
  return english ? "Recommended material" : "Preporučeni materijal";
}

/** Čuva naslov/uputstvo i opcioni PDF jednim zahtjevom; primalac je zaključan pri uređivanju. */
function MaterialEditor({
  material,
  clientUserId,
  clientName,
  onSaved,
  onClose,
}: {
  material: ClientMaterial | null;
  clientUserId: string;
  clientName: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { translate } = useDemo();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    /** Prekida lokalno čekanje pri promjeni klijenta ili odjavi; potvrđen upis ostaje u bazi. */
    function stopWaiting() {
      pending.current?.abort();
    }
    return stopWaiting;
  }, []);
  /** Nova izmjena uklanja prethodnu grešku bez brisanja korisnikovog unosa. */
  function handleChange() {
    setError("");
  }
  /** Provjerava veličinu prije slanja; server ponavlja provjeru PDF-a, vlasništva i verzije. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const body = new FormData(event.currentTarget);
    const file = body.get("file");
    if (file instanceof File && file.name && file.size === 0) {
      setError(
        translate(
          "PDF dokument je prazan. Izaberite drugi dokument.",
          "The PDF is empty. Choose another document.",
        ),
      );
      return;
    }
    if (file instanceof File && file.size > 5 * 1024 * 1024) {
      setError(
        translate("PDF može imati najviše 5 MB.", "PDF must be at most 5 MB."),
      );
      return;
    }
    if (file instanceof File && file.size === 0) body.delete("file");
    if (material) body.set("version", String(material.version));
    else body.set("clientUserId", clientUserId);
    body.set("removeFile", body.get("removeFile") === "on" ? "true" : "false");
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    try {
      await requestMaterials(
        material ? `/${material.id}/update` : "",
        body,
        controller.signal,
      );
      if (!controller.signal.aborted) onSaved();
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }
  return (
    <form
      className="material-editor"
      onSubmit={handleSave}
      onChange={handleChange}
      aria-busy={saving}
    >
      <h3>
        {material
          ? translate("Uredi materijal", "Edit material")
          : translate("Novi materijal ili zadatak", "New material or homework")}
      </h3>
      <p>
        {translate("Namijenjeno klijentu:", "Assigned to:")}{" "}
        <strong>{clientName}</strong>
      </p>
      <fieldset disabled={saving} className="material-fields">
        <div className="materials-form-grid">
          <label className="field">
            <span>{translate("Vrsta materijala", "Material type")}</span>
            <select name="kind" defaultValue={material?.kind || "HOMEWORK"}>
              <option value="HOMEWORK">
                {translate("Domaći zadatak", "Homework")}
              </option>
              <option value="EXERCISE">
                {translate("Vježba", "Exercise")}
              </option>
              <option value="JOURNAL">{translate("Dnevnik", "Journal")}</option>
              <option value="RESOURCE">
                {translate("Preporučeni materijal", "Recommended material")}
              </option>
            </select>
          </label>
          <label className="field">
            <span>{translate("Rok (opciono)", "Due date (optional)")}</span>
            <input
              name="dueDate"
              type="date"
              defaultValue={material?.dueDate || ""}
            />
          </label>
        </div>
        <label className="field">
          <span>{translate("Naslov materijala", "Material title")}</span>
          <input
            name="title"
            required
            maxLength={160}
            defaultValue={material?.title || ""}
          />
        </label>
        <label className="field">
          <span>
            {translate(
              "Uputstvo ili tekst zadatka",
              "Instructions or task text",
            )}
          </span>
          <textarea
            name="instructions"
            rows={5}
            maxLength={10000}
            defaultValue={material?.instructions || ""}
          />
        </label>
        <label className="field">
          <span>
            {translate(
              "Preporučeni link (opciono)",
              "Recommended link (optional)",
            )}
          </span>
          <input
            name="resourceUrl"
            type="url"
            maxLength={2000}
            placeholder="https://…"
            defaultValue={material?.resourceUrl || ""}
          />
        </label>
        <label className="field">
          <span>
            {translate(
              "PDF prilog (opciono, do 5 MB)",
              "PDF attachment (optional, up to 5 MB)",
            )}
          </span>
          <input name="file" type="file" accept="application/pdf,.pdf" />
        </label>
        {material?.fileName && (
          <>
            <p className="muted">
              {translate("Sačuvani prilog:", "Current attachment:")}{" "}
              {material.fileName}
            </p>
            <label className="checkbox-label">
              <input name="removeFile" type="checkbox" />
              <span>
                {translate(
                  "Ukloni sačuvani PDF prilog",
                  "Remove current PDF attachment",
                )}
              </span>
            </label>
          </>
        )}
        <p className="muted small">
          {translate(
            "Dodajte uputstvo, link ili PDF. Materijal će biti dostupan samo ovom klijentu i vama.",
            "Add instructions, a link or a PDF. The material will be available only to this client and you.",
          )}
        </p>
      </fieldset>
      <div className="booking-actions">
        <ActionButton
          type="submit"
          className="button button-primary"
          pending={saving}
          pendingText={translate("Čuvanje materijala…", "Saving material…")}
        >
          {translate("Sačuvaj materijal", "Save material")}
        </ActionButton>
        <button
          type="button"
          className="button button-outline"
          onClick={onClose}
          disabled={saving}
        >
          {translate("Odustani", "Cancel")}
        </button>
      </div>
      {saving && (
        <SaveFeedback
          kind="pending"
          title={translate(
            "Čuvanje zadatka i priloga…",
            "Saving task and attachment…",
          )}
        />
      )}
      {error && <SaveFeedback kind="error" title={error} />}
    </form>
  );
}

/** Prikazuje samo običan tekst i provjeren link; dokument se preuzima tek na klik uz JWT provjeru. */
function MaterialCard({
  material,
  therapistView,
  onEdit,
  onArchived,
}: {
  material: ClientMaterial;
  therapistView: boolean;
  onEdit: (material: ClientMaterial) => void;
  onArchived: (id: string) => void;
}) {
  const { translate, locale } = useDemo();
  const [action, setAction] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    /** Prekida mrežno čekanje pri uklanjanju kartice ili promjeni naloga. */
    function stopWaiting() {
      pending.current?.abort();
    }
    return stopWaiting;
  }, []);
  /** Preuzima PDF bez napuštanja pregleda i prikazuje grešku ako pristup više nije dozvoljen. */
  async function handleDownload() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setAction("download");
    setError("");
    try {
      await downloadMaterial(material.id, controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setAction("");
      }
    }
  }
  /** Otvara postojeći zadatak u formularu sa sačuvanom verzijom i istim primaocem. */
  function handleEdit() {
    onEdit(material);
  }
  /** Traži jasnu potvrdu povlačenja jer će materijal prestati da bude vidljiv klijentu. */
  function handleAskArchive() {
    setConfirmArchive(true);
    setError("");
  }
  /** Odustaje od povlačenja bez poziva serveru. */
  function handleCancelArchive() {
    setConfirmArchive(false);
  }
  /** Povlači samo vlasnikov zapis; zastarjela verzija čuva novije podatke drugog taba. */
  async function handleArchive() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setAction("archive");
    setError("");
    try {
      await requestMaterials(
        `/${material.id}/archive`,
        { version: material.version },
        controller.signal,
      );
      if (!controller.signal.aborted) onArchived(material.id);
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setAction("");
      }
    }
  }
  return (
    <article className="material-card" data-material-id={material.id}>
      <span className="material-kind">
        {materialKindLabel(material.kind, locale === "en")}
      </span>
      <h3>{material.title}</h3>
      <p className="muted small">
        {therapistView
          ? translate("Klijent:", "Client:")
          : translate("Terapeut:", "Therapist:")}{" "}
        <strong>
          {therapistView ? material.clientName : material.therapistName}
        </strong>
      </p>
      {material.dueDate && (
        <p className="material-due">
          {translate("Rok:", "Due:")}{" "}
          {formatDate(material.dueDate, locale, true)}
        </p>
      )}
      {material.instructions && (
        <p className="material-instructions">{material.instructions}</p>
      )}
      {material.resourceUrl && (
        <p>
          <a
            href={material.resourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link"
          >
            {translate(
              "Otvori preporučeni materijal",
              "Open recommended resource",
            )}{" "}
            ↗
          </a>
        </p>
      )}
      {material.fileName && (
        <div className="material-file">
          <BookOpen size={20} aria-hidden="true" />
          <span>
            {material.fileName}
            <small>
              PDF · {((material.fileSize || 0) / 1024 / 1024).toFixed(2)} MB
            </small>
          </span>
          <ActionButton
            type="button"
            className="button button-outline button-sm"
            onClick={handleDownload}
            pending={action === "download"}
            disabled={!!action}
            pendingText={translate("Preuzimanje…", "Downloading…")}
          >
            <Download size={15} aria-hidden="true" />
            {translate("Preuzmi PDF", "Download PDF")}
          </ActionButton>
        </div>
      )}
      <p className="muted small">
        {translate("Posljednja izmjena:", "Last updated:")}{" "}
        {new Intl.DateTimeFormat(locale === "mne" ? "sr-Latn-ME" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Europe/Podgorica",
        }).format(new Date(material.updatedAt))}
      </p>
      {therapistView && (
        <div className="booking-actions">
          <button
            type="button"
            className="button button-outline button-sm"
            onClick={handleEdit}
            disabled={!!action}
          >
            {translate("Uredi materijal", "Edit material")}
          </button>
          <button
            type="button"
            className="button button-quiet button-sm"
            onClick={handleAskArchive}
            disabled={!!action}
          >
            {translate("Povuci materijal", "Withdraw material")}
          </button>
        </div>
      )}
      {confirmArchive && (
        <div className="material-archive-confirmation">
          <p>
            {translate(
              "Klijent više neće vidjeti ovaj materijal niti moći da preuzme prilog. Želite li da ga povučete?",
              "The client will no longer see this material or download its attachment. Withdraw it?",
            )}
          </p>
          <div className="booking-actions">
            <ActionButton
              type="button"
              className="button button-outline button-sm"
              onClick={handleArchive}
              pending={action === "archive"}
              disabled={!!action}
              pendingText={translate("Povlačenje…", "Withdrawing…")}
            >
              {translate("Potvrdi povlačenje", "Confirm withdrawal")}
            </ActionButton>
            <button
              type="button"
              className="button button-quiet button-sm"
              onClick={handleCancelArchive}
              disabled={!!action}
            >
              {translate("Odustani", "Cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <SaveFeedback kind="error" title={error} />}
    </article>
  );
}
