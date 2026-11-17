"use client";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";

/** Broji svako otvaranje; oznaka događaja sprečava samo duplo slanje istog prikaza. */
export function ProfileViewTracker({ therapistId }: { therapistId: string }) {
  const { user, loading, error } = useAuth();
  const visit = useRef<{
    therapistId: string;
    viewId: string;
    sent: boolean;
  } | null>(null);
  useEffect(() => {
    if (loading || error) return;
    if (!visit.current || visit.current.therapistId !== therapistId)
      visit.current = { therapistId, viewId: crypto.randomUUID(), sent: false };
    if (visit.current.sent) return;
    const viewId = visit.current.viewId;
    visit.current.sent = true;
    /** Analitika ne blokira profil ni rezervaciju ako mreža trenutno nije dostupna. */
    async function recordView() {
      try {
        const response = await fetch(
          `/api/v1/analytics/profiles/${encodeURIComponent(therapistId)}/view`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ viewId }),
          },
        );
        if (!response.ok)
          console.warn(
            "Pregled profila nije zabilježen: provjerite analytics API i sesiju.",
          );
      } catch {
        console.warn(
          "Pregled profila nije zabilježen: provjerite vezu sa serverom.",
        );
      }
    }
    // Novo otvaranje/refresh dobija novu oznaku. Strict Mode i promjena auth stanja nijesu novi klikovi.
    void recordView();
  }, [therapistId, user?.id, user?.role, loading, error]);
  return null;
}
