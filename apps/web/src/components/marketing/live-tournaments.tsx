import { ButtonLink } from "@desiauction/ui";
import { unstable_rethrow } from "next/navigation";

import { LANDING } from "../../content/marketing";
import { publicCompetitionsDirectory, type DirectoryEntry } from "../../server/competition/public";
import { formatDateRange } from "../../app/c/format";
import { TournamentCard, TournamentGrid } from "../public/tournament-card";
import { IconArrowRight } from "./icons";

/** How many rows the strip shows. Three, to match the page's other trios. */
const STRIP_SIZE = 3;

/**
 * THE SHOP WINDOW HAS A BAR.
 *
 * This strip is the page's only unsimulated proof, and it was showing whatever
 * sat at the top of the directory — which on any real deployment includes
 * seasons somebody published and then abandoned, and on a developer's machine
 * meant three rows reading "NIGHT CC 11912016" with two players between them.
 * Nothing costs a first impression more than obviously empty data in the
 * section whose whole job is to say "this is real".
 *
 * A season with no squad is not evidence. Eight is roughly the smallest number
 * that reads as a tournament rather than a test — and the /c directory is
 * deliberately NOT filtered, because an organizer's own published season must
 * always appear there, however small it is on its first day.
 */
const MIN_PLAYERS_TO_FEATURE = 8;

/**
 * The landing page's only database read.
 *
 * The home page must render when Postgres is down — that was a P0 defect on
 * this very page (a shell-level session lookup took `GET /` to a 500), and this
 * section would reintroduce it verbatim if it were allowed to throw. So the
 * query is wrapped exactly the way apps/web/src/app/layout.tsx wraps its own:
 * `unstable_rethrow` first, so Next's control-flow signals (redirect, notFound,
 * the dynamic-rendering bailout) pass through untouched and can never be
 * mistaken for an outage; then a log, so a real outage still announces itself;
 * then an empty list, which the caller renders as nothing at all.
 *
 * The degraded page is a home page missing one strip. The undegraded failure
 * would be no home page.
 */
async function liveTournaments(): Promise<DirectoryEntry[]> {
  try {
    // Default sort is "opportunity": open and live competitions surface first,
    // which is also the order a visitor most wants to see them in.
    const directory = await publicCompetitionsDirectory({ page: 1 });
    return directory.entries
      .filter((entry) => entry.playerCount >= MIN_PLAYERS_TO_FEATURE)
      .slice(0, STRIP_SIZE);
  } catch (error) {
    unstable_rethrow(error);
    // `no-console` is on for apps/web; this is the same deliberate exception the
    // root layout makes. The visitor is shown nothing, so stderr is the only
    // place the failure can surface at all.
    // eslint-disable-next-line no-console
    console.error("[landing] tournament directory unavailable; hiding the strip", error);
    return [];
  }
}

/**
 * Live tournaments — the only proof on this page that is not a simulation.
 *
 * Renders NOTHING when the directory is empty or unreachable: an empty shell
 * headed "Tournaments already on DesiAuction" would be the page's single worst
 * sentence, and a section that quietly disappears costs a visitor nothing.
 */
export async function LiveTournaments() {
  const entries = await liveTournaments();
  if (entries.length === 0) {
    return null;
  }
  return (
    <section
      className="mk-band mk-live-band"
      data-theme="floodlight"
      aria-labelledby="live-heading"
    >
      <div className="mk-container">
        <div className="mk-band-head mk-live-head">
          <div>
            <p className="mk-kicker">{LANDING.live.kicker}</p>
            <h2 id="live-heading" className="mk-h2">
              {LANDING.live.h2}
            </h2>
          </div>
          <p className="mk-live-sub">{LANDING.live.sub}</p>
        </div>
        {/* ONE CARD, WHEREVER A SEASON IS OFFERED. This strip used to draw
            its own — which knew about player counts the directory's card did
            not, and did not know about live auctions, so the same season was
            described differently one click apart. */}
        <TournamentGrid>
          {entries.map((entry) => (
            <TournamentCard
              key={entry.slug}
              tournament={{
                name: entry.name,
                slug: entry.slug,
                orgName: entry.orgName,
                sport: entry.sport,
                location: entry.location,
                dates: formatDateRange(entry.startsOn, entry.endsOn),
                open: entry.open,
                live: entry.live,
                teamCount: entry.teamCount,
                playerCount: entry.playerCount,
                logoUrl: entry.logoUrl,
                coverUrl: entry.coverUrl,
                entryCategory: entry.entryCategory,
              }}
            />
          ))}
        </TournamentGrid>
        <p className="mk-live-actions">
          <ButtonLink href={LANDING.live.cta.href} variant="ghost">
            {LANDING.live.cta.label}
            <IconArrowRight width={16} height={16} />
          </ButtonLink>
        </p>
      </div>
    </section>
  );
}
