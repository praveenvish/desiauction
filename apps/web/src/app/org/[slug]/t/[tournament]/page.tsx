import { notFound, redirect } from "next/navigation";

import { tournamentView } from "../../../../../server/orgs/catalogue";

export const metadata = { title: "Tournament · DesiAuction" };

/**
 * A door, not a page (2026-09-25 polish).
 *
 * This used to be a second, barer rendering of one tournament — the same
 * seasons as `/tournaments/{slug}` with fewer figures and a link across to
 * "the tournament workspace". Two pages for one object is how they drift, so
 * the club's own links now go straight to the workspace, and this address
 * survives only for old bookmarks: it resolves the tournament exactly as
 * before (non-members and unknown slugs still 404, indistinguishably) and
 * sends the reader on.
 */
export default async function TournamentRedirect({
  params,
}: {
  params: Promise<{ slug: string; tournament: string }>;
}) {
  const { slug, tournament } = await params;
  const view = await tournamentView(slug, tournament);
  if (view === null) {
    notFound();
  }
  redirect(`/tournaments/${view.tournament.slug}`);
}
