import { BookingFlow } from "@/features/booking-flow";
export const metadata = { title: "Izaberi termin" };
/** Čita ID iz adrese i otvara tok izbora usluge i termina za tog terapeuta. */
export default async function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BookingFlow id={id} />;
}
