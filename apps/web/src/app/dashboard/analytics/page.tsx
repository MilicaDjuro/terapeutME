import { ProfileAnalyticsPage } from "@/features/profile-analytics";
export const metadata = { title: "Analitika profila" };

/** Otvara zasebnu stranicu; API dodatno provjerava ulogu i vlasništvo nad podacima. */
export default function AnalyticsPage() {
  return <ProfileAnalyticsPage />;
}
