import { DemoBookingFlow } from "@/features/demo-booking-flow";
/** Odvojeni demo čuva stari lokalni tok; javno zakazivanje koristi serverske rezervacije. */
export default async function DemoBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DemoBookingFlow id={id} />;
}
