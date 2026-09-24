import type { ReactNode } from "react";

import { MoneyUnitProvider } from "../../../components/money-unit";
import { seasonUnit } from "../../../server/competition/season-unit";

/**
 * EVERY SEASON SURFACE SPEAKS ITS SEASON'S UNIT (0091) — rupees or points.
 *
 * Mounted at the season root so the auction room, its projector screens, the
 * teams tab and the player sheet all read one answer without each page
 * threading it through. No gate here, deliberately: this tree has public
 * children, and "/seasons: the public children under [slug] rule out a gate
 * layout here" still holds — every page keeps its own. Not a Suspense
 * boundary either (no `loading.tsx`), so a page's `notFound()` and
 * `redirect()` still reach the browser as real status codes.
 */
export default async function SeasonLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <MoneyUnitProvider unit={await seasonUnit(slug)}>{children}</MoneyUnitProvider>;
}
