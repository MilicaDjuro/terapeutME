import { TherapistProfile } from "@/features/profile";
import { therapists } from "@terapeut/domain";
/** Postavlja naslov browser taba iz probnog profila; izvršava se na Next.js serveru. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return {
    title:
      therapists.find((candidateTherapist) => candidateTherapist.id === id)
        ?.name || "Profil stručnjaka",
  };
}
/** Čita ID iz adrese /therapist/[id] i prosljeđuje ga prikazu profila. */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TherapistProfile id={id} />;
}
