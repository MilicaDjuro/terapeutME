import type { Metadata } from "next";
import { DemoProvider } from "@/lib/demo-context";
import { Shell } from "@/components/shell";
import "./globals.css";
// metadata podešava naslov i opis u HTML-u. Nije tekst koji se prikazuje unutar stranice.
export const metadata: Metadata = {
  title: {
    default: "Terapeut.me — Podrška počinje razgovorom",
    template: "%s | Terapeut.me",
  },
  description:
    "Pronađite stručnjaka za mentalno zdravlje u Crnoj Gori. Izaberite uslugu i zatražite termin za susret uživo.",
};
/** Omotač svih Next.js stranica: dodaje HTML, zajedničke podatke, zaglavlje i footer. */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sr-Latn-ME">
      <body>
        <a href="#main-content" className="skip-link">
          Preskoči na sadržaj / Skip to content
        </a>
        {/* DemoProvider dijeli podatke, a Shell crta zaglavlje, footer i sadržaj stranice. */}
        <DemoProvider>
          <Shell>{children}</Shell>
        </DemoProvider>
      </body>
    </html>
  );
}
