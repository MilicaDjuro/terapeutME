import { Suspense } from "react";
import { Dashboard } from "@/features/dashboard";
export const metadata = { title: "Moj pregled" };
/** Next.js ulaz za radni prostor; Dashboard čeka provjeru stvarnog naloga. */
export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="loading">Učitavanje…</div>}>
      <Dashboard />
    </Suspense>
  );
}
