// Bira demo ulogu i ekran. Administracija, zahtjevi, kalendar i podešavanja imaju svoje fajlove.
"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Settings2,
  Users,
  RotateCcw,
} from "lucide-react";
import { useDemo } from "@/lib/demo-context";
import { Loading, Avatar } from "@/components/ui";
import { AdminDashboard } from "./admin-dashboard";
import { RequestsList } from "./requests-list";
import { TherapistSettings } from "./therapist-settings";
import { WeekCalendar } from "./week-calendar";
type Mode = "client" | "therapist" | "admin";
/** Iz URL-a bira demo ulogu i otvara listu zahtjeva, kalendar, podešavanja ili administraciju. */
export function Dashboard() {
  const { state, translate, reset } = useDemo();
  const params = useSearchParams();
  const router = useRouter();
  let mode: Mode = "client";
  const requestedMode = params.get("mode");
  if (requestedMode === "therapist" || requestedMode === "admin") {
    mode = requestedMode;
  }
  const therapistId = params.get("therapist") || "ana-markovic";
  const [section, setSection] = useState("requests");
  const [resetPrompt, setResetPrompt] = useState(false);
  const therapist =
    state?.therapists.find(
      (candidateTherapist) => candidateTherapist.id === therapistId,
    ) || state?.therapists[0];
  /** Vraća naslov pregleda za trenutno izabranu demo ulogu. */
  function getTitle(): string {
    if (mode === "client") {
      return translate("Vaš prostor za podršku.", "Your space for support.");
    }
    if (mode === "therapist") {
      return translate("Vaš radni prostor.", "Your workspace.");
    }
    return translate("Pregled platforme.", "Platform overview.");
  }

  /** Vraća čitljiv naziv demo uloge na izabranom jeziku. */
  function getRoleLabel(role: Mode): string {
    if (role === "client") {
      return translate("Klijent", "Client");
    }
    if (role === "therapist") {
      return translate("Terapeut", "Therapist");
    }
    return "Admin";
  }

  /** Mijenja ID probnog terapeuta u URL-u da bi se prikazali njegovi podaci. */
  function chooseTherapist(id: string) {
    const query = new URLSearchParams(params);
    query.set("therapist", id);
    router.replace(`/dashboard?${query}`, { scroll: false });
  }

  /** Vraća probne podatke i zatvara pitanje za potvrdu reseta. */
  function restoreDemoData() {
    reset();
    setResetPrompt(false);
  }

  /** Mijenja demo ulogu u URL-u; ovo nije prijava niti produkciona dozvola. */
  function switchMode(next: Mode) {
    const query = new URLSearchParams(params);
    query.set("mode", next);
    router.replace(`/dashboard?${query}`, { scroll: false });
  }
  const bookings =
    state?.bookings.filter(
      (candidateBooking) =>
        mode !== "therapist" || candidateBooking.therapistId === therapist?.id,
    ) || [];
  /** Bira dio pregleda običnim if granama; detalji svakog ekrana su u zasebnom fajlu. */
  function renderContent() {
    if (!state) {
      return <Loading />;
    }
    if (mode === "admin") {
      return <AdminDashboard />;
    }
    if (mode === "therapist" && therapist) {
      if (section === "settings") {
        return <TherapistSettings key={therapist.id} therapist={therapist} />;
      }
      if (section === "calendar") {
        return <WeekCalendar therapist={therapist} />;
      }
    }
    return (
      <RequestsList
        key={`${mode}-${therapistId}`}
        bookings={bookings}
        therapistView={mode === "therapist"}
      />
    );
  }
  return (
    <div className="container page-space">
      <div className="dashboard-intro">
        <div>
          <span className="eyebrow">
            {translate("SVE NA JEDNOM MJESTU", "EVERYTHING IN ONE PLACE")}
          </span>
          <h1>{getTitle()}</h1>
          <p>
            {translate(
              "Zahtjevi, dogovoreni susreti i naredni koraci.",
              "Requests, arranged sessions and next steps.",
            )}
          </p>
        </div>
        <Link href="/psychotherapy" className="button button-outline">
          {translate("Pronađi stručnjaka", "Find a professional")}
          <ArrowRight size={16} />
        </Link>
      </div>
      <div className="demo-controls">
        <div>
          <span className="demo-label">DEMO</span>
          <p>
            {translate(
              "Promijenite ulogu da isprobate cijeli tok. Ovo nijesu pravi korisnički nalozi.",
              "Switch roles to try the full workflow. These are not real user accounts.",
            )}
          </p>
        </div>
        <div
          className="role-switch"
          aria-label={translate("Demo uloga", "Demo role")}
        >
          {(["client", "therapist", "admin"] as const).map((role) => (
            <button
              key={role}
              aria-pressed={mode === role}
              className={mode === role ? "active" : ""}
              onClick={() => switchMode(role)}
            >
              {getRoleLabel(role)}
            </button>
          ))}
        </div>
      </div>
      {!state ? (
        <Loading />
      ) : (
        <>
          {mode === "therapist" && therapist && (
            <>
              <div className="therapist-toolbar">
                <Avatar therapist={therapist} />
                <label>
                  <span className="tiny-label">
                    {translate("PROBNI PROFIL", "SAMPLE PROFILE")}
                  </span>
                  <select
                    value={therapist.id}
                    onChange={(event) => chooseTherapist(event.target.value)}
                  >
                    {state.therapists.map((candidateTherapist) => (
                      <option
                        value={candidateTherapist.id}
                        key={candidateTherapist.id}
                      >
                        {candidateTherapist.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Link className="text-link" href={`/therapist/${therapist.id}`}>
                  {translate("Javni profil", "Public profile")}
                  <ArrowRight size={14} />
                </Link>
              </div>
              <div className="dashboard-nav">
                {[
                  {
                    id: "requests",
                    icon: Users,
                    label: translate("Zahtjevi", "Requests"),
                  },
                  {
                    id: "calendar",
                    icon: CalendarDays,
                    label: translate("Kalendar", "Calendar"),
                  },
                  {
                    id: "settings",
                    icon: Settings2,
                    label: translate(
                      "Usluge i dostupnost",
                      "Services & availability",
                    ),
                  },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSection(item.id)}
                    className={section === item.id ? "active" : ""}
                    aria-pressed={section === item.id}
                  >
                    <item.icon size={17} />
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {renderContent()}
          <div className="demo-reset">
            {resetPrompt ? (
              <>
                <span>
                  {translate(
                    "Vratiti sve probne podatke? Vaše demo promjene biće izgubljene.",
                    "Restore all sample data? Your demo changes will be lost.",
                  )}
                </span>
                <button
                  className="button button-outline button-sm"
                  onClick={restoreDemoData}
                >
                  {translate("Vrati podatke", "Restore data")}
                </button>
                <button
                  className="button button-quiet button-sm"
                  onClick={() => setResetPrompt(false)}
                >
                  {translate("Odustani", "Keep changes")}
                </button>
              </>
            ) : (
              <button
                className="text-link small"
                onClick={() => setResetPrompt(true)}
              >
                <RotateCcw size={13} />
                {translate(
                  "Vrati početne demo podatke",
                  "Restore initial sample data",
                )}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
