import { OnlineSession } from "@/features/online-session";
export const metadata = {
  title: "Online seansa",
  robots: { index: false, follow: false },
};
/** Otvara privatni ekran; sam identifikator u adresi nikome ne daje dozvolu za poziv. */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return <OnlineSession bookingId={bookingId} />;
}
