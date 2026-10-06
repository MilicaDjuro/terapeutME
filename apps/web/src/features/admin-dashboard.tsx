// Admin demo pregled. Verifikacija i Excel su ovdje; ovo još nijesu serverske dozvole.
"use client";
// Admin prikaz je odvojen od klijentskih zahtjeva i terapeutskog kalendara.
import { useState } from "react";
import Link from "next/link";
import { Users, Clock3, ShieldCheck, Download, BadgeCheck } from "lucide-react";
import type { Therapist } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";
import { downloadDemoExcel } from "@/lib/excel-export";
import { Loading } from "@/components/ui";

/** Prikazuje probne profile, admin verifikaciju i lokalni Excel izvoz. */
export function AdminDashboard() {
  const { state, translate, locale, updateTherapist } = useDemo();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  /** Sakriva ili vraća probni profil bez brisanja postojećih zahtjeva. */
  function toggleVisibility(therapist: Therapist) {
    updateTherapist(therapist.id, { active: !therapist.active });
  }

  /** Mijenja oznaku verifikacije samo kroz admin demo prikaz. */
  function toggleVerification(therapist: Therapist) {
    updateTherapist(therapist.id, { verified: !therapist.verified });
  }
  /** Pokreće lokalni izvoz i pokazuje da li je priprema Excel fajla u toku. */
  async function exportExcel() {
    if (!state) {
      return;
    }
    setExporting(true);
    setExportError("");
    try {
      await downloadDemoExcel(state);
    } catch {
      setExportError(
        translate(
          "Izvoz nije uspio. Pokušajte ponovo.",
          "Export failed. Please try again.",
        ),
      );
    } finally {
      setExporting(false);
    }
  }

  if (!state) {
    return <Loading />;
  }
  return (
    <>
      <div className="stats-grid">
        <div>
          <Users size={20} />
          <strong>{state.therapists.length}</strong>
          <span>
            {translate("Profila stručnjaka", "Professional profiles")}
          </span>
        </div>
        <div>
          <Clock3 size={20} />
          <strong>
            {
              state.bookings.filter(
                (candidateBooking) => candidateBooking.status === "REQUESTED",
              ).length
            }
          </strong>
          <span>
            {translate(
              "Zahtjeva čeka terapeuta",
              "Requests awaiting therapist",
            )}
          </span>
        </div>
        <div>
          <ShieldCheck size={20} />
          <strong>
            {
              state.therapists.filter(
                (candidateTherapist) => candidateTherapist.verified,
              ).length
            }
          </strong>
          <span>{translate("Verifikovanih profila", "Verified profiles")}</span>
        </div>
      </div>
      <section className="admin-panel">
        <div className="section-header">
          <div>
            <h2>
              {translate("Profili i verifikacija", "Profiles & verification")}
            </h2>
            <p>
              {translate(
                "Neverifikovani aktivni profili su javno vidljivi. Verifikaciju dodjeljuje admin.",
                "Active unverified profiles are publicly visible. Verification is assigned by an admin.",
              )}
            </p>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{translate("Stručnjak", "Professional")}</th>
                <th>{translate("Opština", "Municipality")}</th>
                <th>{translate("Javno vidljiv", "Publicly visible")}</th>
                <th>{translate("Verifikacija", "Verification")}</th>
              </tr>
            </thead>
            <tbody>
              {state.therapists.map((candidateTherapist) => (
                <tr key={candidateTherapist.id}>
                  <td>
                    <Link href={`/therapist/${candidateTherapist.id}`}>
                      {candidateTherapist.name}
                    </Link>
                    <span>
                      {locale === "mne"
                        ? candidateTherapist.title
                        : candidateTherapist.titleEn}
                    </span>
                  </td>
                  <td>{candidateTherapist.city}</td>
                  <td>
                    <button
                      className="button button-outline button-sm"
                      onClick={() => toggleVisibility(candidateTherapist)}
                    >
                      {candidateTherapist.active
                        ? translate("Da · arhiviraj", "Yes · archive")
                        : translate("Ne · vrati", "No · restore")}
                    </button>
                  </td>
                  <td>
                    <button
                      className={`button button-sm ${candidateTherapist.verified ? "button-soft" : "button-outline"}`}
                      onClick={() => toggleVerification(candidateTherapist)}
                    >
                      <BadgeCheck size={14} />
                      {candidateTherapist.verified
                        ? translate("Verifikovan · ukloni", "Verified · remove")
                        : translate("Verifikuj", "Verify")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sample-note">
          {translate(
            "Demo arhiviranje sakriva profil i zaustavlja nove zahtjeve. Postojeći zahtjevi ostaju u istoriji.",
            "Demo archiving hides the profile and stops new requests. Existing requests remain in the history.",
          )}
        </p>
      </section>
      <section className="admin-panel admin-export">
        <div>
          <h2>{translate("Izvoz probnih podataka", "Export sample data")}</h2>
          <p>
            {translate(
              "Excel sa zahtjevima i istorijom promjena. Preuzimanje je lokalno; fajl se ne šalje emailom.",
              "Excel workbook with requests and event history. Download is local; no file is emailed.",
            )}
          </p>
        </div>
        <button
          disabled={exporting}
          className="button button-outline"
          onClick={exportExcel}
        >
          <Download size={17} />
          {exporting
            ? translate("Priprema…", "Preparing…")
            : translate("Preuzmi Excel", "Download Excel")}
        </button>
      </section>
      {exportError && (
        <p role="alert" className="form-error">
          {exportError}
        </p>
      )}
    </>
  );
}
