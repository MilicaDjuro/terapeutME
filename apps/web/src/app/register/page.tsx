import type { Metadata } from "next";
import { RegistrationPage } from "@/features/auth-pages";
export const metadata: Metadata = { title: "Registracija" };
/** Otvara registraciju u dva koraka sa serverskom potvrdom email koda. */
export default function RegistrationRoute() {
  return <RegistrationPage />;
}
