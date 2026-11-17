"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Therapist } from "@terapeut/domain";

interface DirectoryContextValue {
  therapists: Therapist[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}
const DirectoryContext = createContext<DirectoryContextValue | null>(null);

/** Učitava javne profile iz API-ja; lokalni demo podaci nijesu izvor kataloga. */
export function DirectoryProvider({ children }: { children: React.ReactNode }) {
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latestRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(
    /** Ponovo čita bazu poslije registracije, fotografije ili povratka u tab. */
    async function refresh() {
      // Stariji odgovor ne smije vratiti obrisanu fotografiju preko novijih podataka.
      latestRequest.current?.abort();
      const controller = new AbortController();
      latestRequest.current = controller;
      try {
        const response = await fetch("/api/v1/therapists", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Katalog trenutno nije dostupan.");
        const data: { therapists: Therapist[] } = await response.json();
        if (!controller.signal.aborted) {
          setTherapists(data.therapists);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Katalog trenutno nije dostupan. Provjerite API i pokušajte ponovo.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [],
  );
  // Ponovni fokus čita aktuelne podatke, uključujući profil kreiran u drugom tabu.
  useEffect(() => {
    void refresh();
    /** Osvježava podatke kada korisnik ponovo vidi tab. */
    function handleVisibility() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    /** Uklanja slušač pri zatvaranju zajedničkog omotača. */
    function stopListening() {
      latestRequest.current?.abort();
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    return stopListening;
  }, [refresh]);
  return (
    <DirectoryContext.Provider value={{ therapists, loading, error, refresh }}>
      {children}
    </DirectoryContext.Provider>
  );
}

/** Daje javne profile iz baze, odvojeno od probnih zahtjeva i demo uloga. */
export function useDirectory() {
  const context = useContext(DirectoryContext);
  if (!context) throw new Error("useDirectory zahtijeva DirectoryProvider.");
  return context;
}
