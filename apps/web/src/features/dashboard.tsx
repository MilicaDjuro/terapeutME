"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, Settings2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { accountHome } from "@/lib/auth-client";
import { Loading } from "@/components/ui";
import { ScheduleEditor } from "./schedule-editor";
import { ServerBookings } from "./server-bookings";
import { ClientMaterials } from "./materials";

/** Otvara radni prostor prijavljenog terapeuta; URL parametri ne mijenjaju ulogu ni vlasnika. */
export function Dashboard() {
  const { user, loading, error, refreshAccount } = useAuth();
  const { translate } = useDemo();
  const router = useRouter();

  // Čekamo provjeru JWT sesije prije preusmjeravanja; mrežna greška ostavlja mogućnost ponovnog pokušaja.
  useEffect(() => {
    if (loading || error) return;
    if (!user) router.replace("/login");
    else if (user.role !== "THERAPIST") router.replace(accountHome(user));
  }, [user, loading, error, router]);

  if (error)
    return (
      <div className="container page-space">
        <h1>{translate("Pregled nije dostupan", "Dashboard unavailable")}</h1>
        <p role="alert">{error}</p>
        <button className="button button-primary" onClick={refreshAccount}>
          {translate("Pokušaj ponovo", "Try again")}
        </button>
      </div>
    );
  if (loading || !user || user.role !== "THERAPIST") return <Loading />;

  return (
    <div className="container page-space account-page">
      <div className="dashboard-intro">
        <div>
          <span className="eyebrow">
            {translate("VAŠ RADNI PROSTOR", "YOUR WORKSPACE")}
          </span>
          <h1>
            {translate(
              `Dobar dan, ${user.firstName}.`,
              `Hello, ${user.firstName}.`,
            )}
          </h1>
          <p>
            {translate(
              "Zahtjevi i termini na jednom mjestu. Organizujte svoj rad kada vam odgovara.",
              "Your requests and sessions in one place. Organize your work at your own pace.",
            )}
          </p>
        </div>
        <div className="booking-actions">
          <Link href="/dashboard/analytics" className="button button-outline">
            <BarChart3 size={16} />{" "}
            {translate("Analitika profila", "Profile analytics")}
          </Link>
          <a href="#my-materials" className="button button-outline">
            {translate("Materijali i zadaci", "Materials and homework")}
          </a>
          <Link href="/account" className="button button-outline">
            <Settings2 size={16} />{" "}
            {translate("Uredi profil terapeuta", "Edit therapist profile")}
          </Link>
        </div>
      </div>
      <ServerBookings key={`bookings-${user.id}`} />
      <ClientMaterials key={`materials-${user.id}`} />
      <ScheduleEditor key={user.id} />
    </div>
  );
}
