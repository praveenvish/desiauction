import { NoPhotoStyleProvider } from "@desiauction/ui";
import type { ReactNode } from "react";

import { MoneyUnitProvider } from "../../../components/money-unit";
import { seasonNoPhotoStyle } from "../../../server/competition/season-no-photo";
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
  // And how it draws a player with no photo (0107): initials or the cricketer.
  const [unit, noPhoto] = await Promise.all([seasonUnit(slug), seasonNoPhotoStyle(slug)]);
  return (
    <MoneyUnitProvider unit={unit}>
      <NoPhotoStyleProvider style={noPhoto}>{children}</NoPhotoStyleProvider>
    </MoneyUnitProvider>
  );
}
