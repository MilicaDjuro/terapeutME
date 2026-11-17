import type { Metadata } from "next";
import { LoginPage } from "@/features/auth-pages";
export const metadata: Metadata = { title: "Prijava" };
/** Otvara prijavu; identitet i lozinku provjerava NestJS API. */
export default function LoginRoute() {
  return <LoginPage />;
}
