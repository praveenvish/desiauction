import { NoPhotoStyleProvider, TeamBadgeProvider } from "@desiauction/ui";
import type { ReactNode } from "react";

import { seasonNoPhotoStyle } from "../../../server/competition/season-no-photo";
import { seasonTeamBadge } from "../../../server/competition/season-team-badge";

/**
 * THE PUBLIC SEASON PAGES DRAW A MISSING PHOTO THE SEASON'S WAY (0107).
 *
 * The showcase, the squads, a team page and a player page all show players who
 * may have no photo; the season chose initials or the cricketer, and this hands
 * that choice to every `PlayerImage` below. No gate: each page keeps its own
 * visibility check, and an unknown slug simply reads the default.
 */
export default async function PublicSeasonLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [noPhoto, badge] = await Promise.all([seasonNoPhotoStyle(slug), seasonTeamBadge(slug)]);
  return (
    <NoPhotoStyleProvider style={noPhoto}>
      <TeamBadgeProvider badge={badge}>{children}</TeamBadgeProvider>
    </NoPhotoStyleProvider>
  );
}
