import { sportPackFor } from "@desiauction/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { publicCompetitionView } from "../../../server/competition/public";
import { formatDateRange } from "../../c/format";
import "./embed.css";

/**
 * A PUBLISHED SEASON AS A CARD FOR ANOTHER WEBSITE (SEO-1 Phase 7).
 *
 * The only framable page (next.config.mjs, EMBED_CSP). Read-only and public by
 * construction: `publicCompetitionView` returns nothing for an unpublished
 * season, so a private one is a 404 here as everywhere. No player names, no
 * forms, no session-bound action — a framed page that offers nothing to click
 * but a link out. Never indexed: it would duplicate /c/[slug].
 */
export const metadata: Metadata = {
  title: "Season card",
  robots: { index: false, follow: true },
};

export default async function EmbedSeason({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await publicCompetitionView(slug);
  if (view === null) {
    notFound();
  }
  const url = `${env.PUBLIC_BASE_URL}/c/${view.slug}`;
  const live = view.auctionStatus === "live" || view.auctionStatus === "paused";
  const done = view.auctionStatus === "completed" || view.auctionStatus === "reconciled";
  const status = live
    ? "Auction live now"
    : view.open
      ? "Registration open"
      : done
        ? "Auction complete"
        : "Registration closed";
  const action = live ? "Watch live" : view.open ? "Register" : "View the season";
  const facts = [
    sportPackFor(view.sport).label,
    view.location,
    formatDateRange(view.startsOn, view.endsOn),
    view.teams.length > 0 ? `${String(view.teams.length)} teams` : null,
  ].filter((fact): fact is string => fact !== null && fact !== "");

  return (
    <main className="embed-card" data-testid="embed-card">
      <p className="embed-status" data-live={live ? "" : undefined}>
        {status}
      </p>
      <h1 className="embed-title">{view.name}</h1>
      <p className="embed-org">by {view.orgName}</p>
      <p className="embed-facts">{facts.join(" · ")}</p>
      <p className="embed-actions">
        <a className="embed-cta" href={url} target="_blank" rel="noopener">
          {action}
        </a>
        <a className="embed-brand" href={env.PUBLIC_BASE_URL} target="_blank" rel="noopener">
          Powered by DesiAuction
        </a>
      </p>
    </main>
  );
}
