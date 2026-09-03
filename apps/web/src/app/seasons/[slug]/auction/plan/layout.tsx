import type { ReactNode } from "react";

import { requireOnboarded } from "../../../../../server/auth/onboarding-gate";

/**
 * The name gate, for the same reason the room next door has it: an owner who
 * accepted their invite and came straight here may still have no name, and a
 * nameless account becomes a raw phone number on every sheet the night
 * produces. The gate passes its own address so the interruption returns the
 * owner to their plan, not to /home.
 *
 * Not a `loading.tsx`: a Suspense boundary above a gated page commits a 200
 * before the gate runs, and the redirect never reaches the browser.
 */
export default async function PlanLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireOnboarded(`/seasons/${slug}/auction/plan`);
  return <>{children}</>;
}
