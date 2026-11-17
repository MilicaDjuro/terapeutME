"use client";
import { useDirectory } from "@/lib/directory-context";
import { useDemo } from "@/lib/demo-context";
import { useState } from "react";
import { ActionButton } from "./ui";

/** Prikazuje grešku API-ja umjesto lažnog praznog kataloga ili probnog fallback-a. */
export function DirectoryError() {
  const { error, refresh } = useDirectory();
  const { translate } = useDemo();
  const [retrying, setRetrying] = useState(false);
  /** Drži indikator do završetka novog čitanja kataloga, i kada API ponovo vrati grešku. */
  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }
  return (
    <div className="container page-space">
      <p role="alert">
        {translate(
          error,
          "The directory is unavailable. Check the API and try again.",
        )}
      </p>
      <ActionButton
        pending={retrying}
        pendingText={translate("Učitavanje…", "Loading…")}
        className="button button-outline"
        onClick={handleRetry}
      >
        {translate("Pokušaj ponovo", "Try again")}
      </ActionButton>
    </div>
  );
}
