import type { ReactNode } from "react";

import { requireOnboarded } from "../../server/auth/onboarding-gate";

/**
 * The authenticated layout, in the only shape this route tree can take.
 *
 * There is no `app/(console)` route group here — console routes sit at the top
 * level beside the public ones, and `/seasons/[slug]` mixes the two (its
 * `register` and `auction/spectate` children are deliberately public). So the
 * gate is mounted as a one-line `layout.tsx` on each console segment, all
 * re-exporting THIS component: one implementation, no per-route drift, and the
 * public surfaces are untouched because nothing was mounted above them.
 *
 * Layouts re-render whenever you navigate INTO their segment, which is the
 * coverage that matters: a deep link, a full reload, or a rail click from
 * another section all pass through it.
 */
export default async function OnboardedLayout({ children }: { children: ReactNode }) {
  await requireOnboarded();
  return <>{children}</>;
}
