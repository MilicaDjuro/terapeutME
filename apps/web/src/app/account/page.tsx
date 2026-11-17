import type { Metadata } from "next";
import { AccountPage } from "@/features/account";
export const metadata: Metadata = {
  title: "Moj nalog",
  robots: { index: false, follow: false },
};
/** Otvara vlastiti nalog; API vraća podatke samo vlasnika važeće sesije. */
export default function AccountRoute() {
  return <AccountPage />;
}
