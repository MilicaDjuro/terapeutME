import { Suspense } from "react";
import { Dashboard } from "@/features/dashboard";
export const metadata = { title: "Moj pregled" };
/** Next.js ulaz za /dashboard; Suspense prikazuje učitavanje dok se čitaju URL parametri. */
export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="loading">Učitavanje…</div>}>
      <Dashboard />
    </Suspense>
  );
}
