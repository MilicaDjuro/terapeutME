import type { Metadata } from "next";
import { ResetPasswordPage } from "@/features/password-reset-pages";
export const metadata: Metadata = {
  title: "Nova lozinka",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
/** Otvara novu lozinku; jednokratni JWT fragment čita samo klijentska komponenta. */
export default function ResetPasswordRoute() {
  return <ResetPasswordPage />;
}
