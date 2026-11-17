"use client";
import { useDemo } from "@/lib/demo-context";
import type { TherapistAccountProfile } from "@/lib/auth-client";

/** Dodaje profesionalna polja zajedničkom formularu; čuvanje vodi AccountProfileEditor. */
export function TherapistProfileFields({
  profile,
}: {
  profile: TherapistAccountProfile;
}) {
  const { translate } = useDemo();
  return (
    <>
      <label className="field">
        <span>{translate("Stručno zvanje", "Professional title")}</span>
        <input
          name="title"
          required
          maxLength={120}
          defaultValue={profile.title}
        />
      </label>
      <label className="field">
        <span id="therapist-biography-label">
          {translate("Biografija", "Biography")}
        </span>
        <textarea
          aria-labelledby="therapist-biography-label"
          name="biography"
          required
          rows={4}
          maxLength={400}
          defaultValue={profile.biography}
        />
      </label>
    </>
  );
}
