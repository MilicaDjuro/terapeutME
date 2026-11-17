import { Suspense } from "react";
import { DemoDashboard } from "@/features/demo-dashboard";
export const metadata = { title: "Demo pregled" };

/** Čuva odvojeni demo tok rezervacija; probne uloge ne mijenjaju stvarni nalog. */
export default function DemoDashboardPage() {
  return (
    <Suspense fallback={<div className="loading">Učitavanje…</div>}>
      <DemoDashboard />
    </Suspense>
  );
}
