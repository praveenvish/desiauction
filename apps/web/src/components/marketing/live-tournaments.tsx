import { ButtonLink } from "@desiauction/ui";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";

import { LANDING } from "../../content/marketing";
import { publicCompetitionsDirectory, type DirectoryEntry } from "../../server/competition/public";
import { formatDateRange } from "../../app/c/format";
import { IconArrowRight, IconCalendar, IconMapPin } from "./icons";

/** How many rows the strip shows. Three, to match the page's other trios. */
const STRIP_SIZE = 3;

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
    return directory.entries.slice(0, STRIP_SIZE);
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
 * "Malad Cricket Club" → "MC". The crest fallback, and the reason near-identical
 * names still read as distinct rows: the local database is full of e2e residue
 * ("Night Cup 10472893"), and the founder's screenshot has to look designed
 * rather than duplicated. Each card leads with the ORGANIZER's monogram and
 * name, so two seasons of the same cup are told apart by who runs them.
 */
function monogram(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => {
        const cp = word.codePointAt(0);
        return cp === undefined ? "" : String.fromCodePoint(cp);
      })
      .join("")
      .toUpperCase() || "—"
  );
}

/**
 * The one status line each card may carry. `DirectoryEntry` knows only two
 * facts — the auction is watchable now, or registration is open — so those are
 * the only two things said. Everything else (draft, setup, finished) is a status
 * the entry cannot distinguish, and a card that guessed would be inventing.
 */
function statusOf(entry: DirectoryEntry): { label: string; tone: "live" | "open" } | null {
  if (entry.live) {
    return { label: "Auction live now", tone: "live" };
  }
  if (entry.open) {
    return { label: "Registration open", tone: "open" };
  }
  return null;
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
        <ul className="mk-live-list">
          {entries.map((entry) => {
            const status = statusOf(entry);
            return (
              <li key={entry.slug} className="mk-live-card">
                {/* Organizer first, deliberately. Two seasons of the same cup
                    carry near-identical names, and in the local database the
                    e2e residue makes that the norm rather than the exception —
                    leading with who runs it is what keeps the row looking
                    designed instead of duplicated. */}
                <p className="mk-live-org">
                  <span className="mk-live-crest" aria-hidden="true">
                    {monogram(entry.orgName)}
                  </span>
                  {entry.orgName}
                </p>
                {/* The link stretches over the whole card (::after), so the
                    accessible name stays the tournament name alone — the city,
                    dates and status read as the row's own detail rather than
                    being swallowed into one enormous link name. */}
                <h3 className="mk-live-name">
                  <Link href={`/c/${entry.slug}`}>{entry.name}</Link>
                </h3>
                <p className="mk-live-meta">
                  <span>
                    <IconCalendar width={15} height={15} />
                    {formatDateRange(entry.startsOn, entry.endsOn)}
                  </span>
                  {entry.location === null ? null : (
                    <span>
                      <IconMapPin width={15} height={15} />
                      {entry.location}
                    </span>
                  )}
                </p>
                {status === null ? null : (
                  <p className={`mk-live-status mk-live-status--${status.tone}`}>
                    <i aria-hidden="true" />
                    {status.label}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
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
