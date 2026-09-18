import { SPORTS, sportPackFor } from "@desiauction/core";
import Link from "next/link";
import { redirect } from "next/navigation";

import { compactINR } from "../../lib/inr";
import { currentSession } from "../../server/auth/actions";
import { playerCareer, playerMatches, type CareerMatch } from "../../server/player/career";
import { playerProfileFor, profileCompletenessFor } from "../../server/player/profile";
import "./me.css";

export const metadata = { title: "My sports · DesiAuction" };

/**
 * MY SPORTS — every tournament, match and sport, in one place (launch polish,
 * Phase 3). The founder's ask, verbatim: "what all tournaments they have
 * played, what all matches they have played, which all sports they have
 * played". The career used to live one sport per page with no index, and had
 * no matches at all — results were per team. Matches now come from lineups
 * (0074), with "didn't play" and "not recorded" kept apart.
 *
 * Self view only: the person id is the session's, never a parameter.
 */

const RESULT_LABEL: Record<NonNullable<CareerMatch["result"]>, string> = {
  won: "Won",
  lost: "Lost",
  tied: "Tied",
  no_result: "No result",
};

const ENTRY_LABEL: Record<string, string> = {
  submitted: "Waiting for approval",
  approved: "In the pool",
  waitlisted: "Waitlisted",
  rejected: "Not accepted",
  withdrawn: "Withdrawn",
  draft: "Not submitted",
};

const PLAYED_LABEL: Record<CareerMatch["played"], string> = {
  played: "Played",
  bench: "In the squad",
  unknown: "Not recorded",
};

function matchDate(kickoffAt: string | null): string {
  if (kickoffAt === null) return "—";
  const d = new Date(`${kickoffAt.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? kickoffAt.slice(0, 10)
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function seasonYear(startsOn: string | null): string {
  return startsOn === null ? "—" : startsOn.slice(0, 4);
}

export default async function MySportsPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/me");
  }
  if (session.name === null || session.name.trim() === "") {
    redirect("/onboarding");
  }
  const [query, career, matches, profile, completeness] = await Promise.all([
    searchParams,
    playerCareer(session.personId),
    playerMatches(session.personId),
    playerProfileFor(session.personId),
    profileCompletenessFor(session.personId),
  ]);

  // Sports this person actually played, in the platform's own order.
  const played = new Set(career.seasons.map((season) => season.sport));
  const sports = SPORTS.filter((pack) => played.has(pack.key));
  const filter = sports.some((pack) => pack.key === query.sport) ? query.sport : undefined;
  const seasons = career.seasons
    .filter((season) => filter === undefined || season.sport === filter)
    .slice()
    .reverse();
  const shownMatches = matches.filter((match) => filter === undefined || match.sport === filter);
  const matchesPlayed = matches.filter((match) => match.played === "played").length;

  const bySport = sports.map((pack) => ({
    key: pack.key,
    label: pack.label,
    seasons: career.seasons.filter((season) => season.sport === pack.key).length,
    matches: matches.filter((match) => match.sport === pack.key && match.played === "played")
      .length,
  }));
  const maxSeasons = Math.max(1, ...bySport.map((row) => row.seasons));

  // The one contained surface: what is coming, if anything is.
  const waiting = career.seasons.find((season) => season.status === "submitted");
  const inPool = career.seasons.find(
    (season) => season.status === "approved" && season.auction === null && season.teamName === null,
  );
  const upcoming = waiting ?? inPool;

  const initials = session.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <main className="me">
      <section className="me-profile" aria-label="Profile">
        <span className="me-avatar" aria-hidden>
          {initials}
        </span>
        <div className="me-who">
          <h2 className="me-name">{session.name}</h2>
          <p className="me-meta">
            {[profile.location, sports.map((pack) => pack.label).join(" · ")]
              .filter((part) => part !== null && part !== "")
              .join(" · ") || "Your record starts with your first tournament."}
          </p>
        </div>
        {completeness.done < completeness.total ? (
          <Link href="/account" className="me-complete">
            Profile {completeness.done} of {completeness.total} — finish it
          </Link>
        ) : null}
      </section>

      <dl className="me-figures" aria-label="Career totals">
        {[
          ["Tournaments", String(career.totals.seasons)],
          ["Matches played", String(matchesPlayed)],
          ["Teams", String(career.totals.teams)],
          ["Times sold", String(career.totals.soldCount)],
          [
            "Highest price",
            career.totals.highestPrice === null ? "—" : compactINR(career.totals.highestPrice),
          ],
        ].map(([label, value]) => (
          <div key={label} className="me-figure">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {upcoming !== undefined ? (
        <section className="me-next" aria-labelledby="me-next-title" data-testid="me-next">
          <p className="me-next-eyebrow">Coming up · {upcoming.competitionName}</p>
          <h2 id="me-next-title">
            {upcoming.status === "submitted"
              ? "Your registration is with the organizer"
              : "You're in the auction pool"}
          </h2>
          <p>
            {upcoming.status === "submitted"
              ? "You'll get a message the moment they approve it."
              : "We'll message you the moment a team buys you."}
          </p>
        </section>
      ) : null}

      {sports.length > 1 ? (
        <nav className="me-filter" aria-label="Filter by sport">
          <Link href="/me" aria-current={filter === undefined ? "page" : undefined}>
            All sports
          </Link>
          {sports.map((pack) => (
            <Link
              key={pack.key}
              href={`/me?sport=${pack.key}`}
              aria-current={filter === pack.key ? "page" : undefined}
            >
              {pack.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="me-layout">
        <div className="me-main">
          <section aria-labelledby="me-tournaments" data-testid="me-tournaments">
            <header className="me-head">
              <h2 id="me-tournaments">Tournaments</h2>
              <span>{seasons.length}</span>
            </header>
            {seasons.length === 0 ? (
              <p className="me-empty">
                No tournaments yet. <Link href="/c">Find one to play</Link>.
              </p>
            ) : (
              <ul className="me-rows">
                {seasons.map((season) => {
                  const pack = sportPackFor(season.sport);
                  const verdict =
                    season.auction === null
                      ? season.teamName !== null
                        ? "In the squad"
                        : (ENTRY_LABEL[season.status] ?? season.status)
                      : season.auction.kind === "sold"
                        ? `Sold · ${compactINR(season.auction.soldPrice)}`
                        : season.auction.kind === "unsold"
                          ? "Unsold"
                          : season.auction.kind === "icon"
                            ? "Icon player"
                            : "Retained";
                  return (
                    <li key={season.registrationId}>
                      <Link href={`/seasons/${season.competitionSlug}/register`} className="me-row">
                        <span className="me-year">{seasonYear(season.startsOn)}</span>
                        <span className="me-row-main">
                          <strong>{season.competitionName}</strong>
                          <span>
                            {[pack.label, season.orgName, season.teamName]
                              .filter((part) => part !== null)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="me-verdict">{verdict}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="me-matches" data-testid="me-matches">
            <header className="me-head">
              <h2 id="me-matches">Matches</h2>
              <span>{shownMatches.length}</span>
            </header>
            {shownMatches.length === 0 ? (
              <p className="me-empty">
                Matches appear here once your team plays and the organizer records the lineup.
              </p>
            ) : (
              <table className="me-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Match</th>
                    <th scope="col">Result</th>
                    <th scope="col">You</th>
                  </tr>
                </thead>
                <tbody>
                  {shownMatches.map((match) => (
                    <tr key={match.fixtureId}>
                      <td className="me-num">{matchDate(match.kickoffAt)}</td>
                      <td>
                        <strong>
                          {match.teamName} vs {match.opponentName}
                        </strong>
                        <span>
                          {sportPackFor(match.sport).label} · {match.competitionName}
                        </span>
                      </td>
                      <td>
                        <span className={`me-result me-result--${match.result ?? "live"}`}>
                          {match.result === null ? "In progress" : RESULT_LABEL[match.result]}
                        </span>
                      </td>
                      <td className={`me-played me-played--${match.played}`}>
                        {PLAYED_LABEL[match.played]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <aside className="me-side">
          {bySport.length > 0 ? (
            <section aria-labelledby="me-by-sport">
              <header className="me-head">
                <h2 id="me-by-sport">By sport</h2>
              </header>
              <ul className="me-sports">
                {bySport.map((row) => (
                  <li key={row.key}>
                    <div className="me-sport-line">
                      <Link href={`/me/${row.key}`}>{row.label}</Link>
                      <span>
                        {row.seasons} season{row.seasons === 1 ? "" : "s"} · {row.matches} match
                        {row.matches === 1 ? "" : "es"}
                      </span>
                    </div>
                    <span className="me-bar" aria-hidden>
                      <i style={{ width: `${String((row.seasons / maxSeasons) * 100)}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="me-privacy">
            <strong>Who sees this page?</strong> Only you. Clubs see what you enter for their
            season; your share card shows only what you choose.
          </p>
        </aside>
      </div>
    </main>
  );
}
