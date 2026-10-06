import { Suspense } from "react";
import { Directory } from "@/features/directory";
export const metadata = { title: "Pronađi stručnjaka" };
/** Next.js ulaz za /psychotherapy; interaktivna pretraga se nalazi u features/directory.tsx. */
export default function DirectoryPage() {
  return (
    <Suspense fallback={<div className="loading">Učitavanje…</div>}>
      <Directory />
    </Suspense>
  );
}
