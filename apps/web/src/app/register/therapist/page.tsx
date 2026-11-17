import type { Metadata } from "next";
import { RegistrationPage } from "@/features/auth-pages";

export const metadata: Metadata = { title: "Registracija terapeuta" };

/** Otvara posebnu registraciju terapeuta; profil nastaje u bazi tek nakon email potvrde. */
export default function TherapistRegistrationRoute() {
  return <RegistrationPage therapist />;
}
