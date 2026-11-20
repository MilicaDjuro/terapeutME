import { TherapistNotesPage } from "@/features/therapist-notes";
export const metadata = { title: "Privatne bilješke" };

/** Prima samo opcioni izbor klijenta; stvarno vlasništvo provjerava privatni API. */
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <TherapistNotesPage
      initialClientId={typeof params.client === "string" ? params.client : ""}
    />
  );
}
