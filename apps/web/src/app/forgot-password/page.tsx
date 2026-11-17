import type { Metadata } from "next";
import { ForgotPasswordPage } from "@/features/password-reset-pages";
export const metadata: Metadata = {
  title: "Obnova lozinke",
  robots: { index: false, follow: false },
};
/** Otvara javni formular za zahtjev email linka za obje vrste naloga. */
export default function ForgotPasswordRoute() {
  return <ForgotPasswordPage />;
}
