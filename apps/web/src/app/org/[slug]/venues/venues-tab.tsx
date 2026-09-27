import { IconChevronRight } from "@desiauction/ui";
import Link from "next/link";

import type { VenuesView } from "../../../../server/competition/fixture-actions";
import { dateRange } from "../../../tournaments/season-card";
import { VenuesPanel } from "./venues-panel";
import "./venues.css";

/**
 * THE CLUB'S VENUES, AS A CLUB TAB (2026-09-27).
 *
 * Venues was its own page, reached from one button at the foot of the
 * Tournaments tab, and it dropped the club's header on the way. It is now a tab
 * beside Members and Money & roles; `/org/[slug]/venues` redirects here so the
 * schedule's "add a venue" links still land.
 */
export interface VenueSeason {
  id: string;
  slug: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  matches: number;
}

export function VenuesTab({
  slug,
  view,
  seasons,
}: {
  slug: string;
  view: VenuesView;
  seasons: readonly VenueSeason[];
}) {
  const hasGrounds = view.venues.some((venue) => venue.grounds.length > 0);
  return (
    <div className="vn-layout">
      <div className="vn-main">
        <p className="vn-lede" data-testid="venues-heading">
          Grounds and when they&apos;re free — matches are scheduled onto them.
        </p>
        <VenuesPanel slug={slug} venues={view.venues} canManage={view.viewer.canManage} />
      </div>
      {/* The seasons these grounds serve, and what each is waiting on. */}
      {seasons.length > 0 ? (
        <aside
          className="vn-seasons-aside"
          aria-labelledby="vn-seasons-title"
          data-testid="venues-seasons"
        >
          <h2 id="vn-seasons-title">Seasons that play here</h2>
          <p>
            {hasGrounds
              ? "Their fixtures are scheduled onto these grounds."
              : "Fixtures and lineups wait on a ground — add one first."}
          </p>
          <ul className="vn-seasons">
            {seasons.map((season) => (
              <li key={season.id}>
                <Link href={`/seasons/${season.slug}/fixtures`} className="vn-season">
                  <span className="vn-season-text">
                    <strong>{season.name}</strong>
                    <span>
                      {[
                        dateRange(season.startsOn, season.endsOn),
                        season.matches > 0
                          ? `${String(season.matches)} ${season.matches === 1 ? "match" : "matches"} scheduled`
                          : "No matches yet",
                      ]
                        .filter((part): part is string => part !== null && part !== "")
                        .join(" · ")}
                    </span>
                  </span>
                  <IconChevronRight size={16} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
