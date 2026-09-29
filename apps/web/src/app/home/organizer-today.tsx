import {
  ButtonLink,
  IconArrowRight,
  IconBolt,
  IconCalendar,
  IconCheckCircle,
  IconTrophy,
  Pill,
  SectionCard,
} from "@desiauction/ui";
import Link from "next/link";

import { cardAmount } from "../../lib/money";
import { formatCount } from "../../lib/plural";
import { dateTile, formatDayDate, formatWallTime } from "../../lib/format-date";
import type { SeasonOverviewView } from "../../server/competition/actions";
import type { OrganizerFixture } from "../../server/competition/fixtures";
import type { StandingsPageView } from "../../server/competition/fixture-actions";
import { awaitsResult } from "../seasons/[slug]/_tabs/fixture-status";
import { monogram } from "../../components/season-hero/season-hero";
import "./organizer-today.css";

/**
 * THE ORGANIZER'S MATCH DAY (census 13).
 *
 * Once the season is on, home was still the setup page: a tall hero of things
 * that do not change (crest, dates, a five-step road all ticked), four figures
 * frozen since auction night, a one-row "Your seasons" table repeating the
 * hero, the owed results said twice, and the organizer's own recent clicks.
 * What an organizer opens the app for on a match day is what is waiting on
 * them, what is next, and where the table stands — in that order.
 *
 * Only for a season whose auction is done and whose matches are on the books;
 * every earlier stage keeps the setup home.
 */

export interface TodayJob {
  key: string;
  label: string;
  detail: string;
  href: string;
  verb?: string;
}

function when(kickoffAt: string | null, today: string): string {
  if (kickoffAt === null) return "Date to be set";
  const day = kickoffAt.slice(0, 10);
  const time =
    kickoffAt.length > 10 ? formatWallTime(kickoffAt.replace(" ", "T").slice(0, 16)) : null;
  const date = day === today ? "Today" : formatDayDate(day);
  return time === null ? date : `${date} · ${time}`;
}

function sides(fixture: OrganizerFixture): string {
  return fixture.homeTeamId === null
    ? `Lobby · ${String(fixture.squadCount)} squads`
    : `${fixture.homeTeamName ?? "TBA"} v ${fixture.awayTeamName ?? "TBA"}`;
}

export function OrganizerToday({
  overview,
  fixtures,
  jobs,
  table,
  otherSeasons,
  today,
}: {
  overview: SeasonOverviewView;
  /** The organizer's schedule strip (owed first, then from today). */
  fixtures: readonly OrganizerFixture[];
  /** Everything else waiting on this organizer, most urgent first. */
  jobs: readonly TodayJob[];
  table: StandingsPageView | null;
  /** The organizer's other seasons, for a quiet switch line. */
  otherSeasons: readonly { slug: string; name: string }[];
  today: string;
}) {
  const season = overview.competition;
  const base = `/seasons/${season.slug}`;
  const mine = fixtures.filter((fixture) => fixture.competitionSlug === season.slug);
  const owed = mine.filter((fixture) => awaitsResult(fixture, today));
  const live = mine.filter(
    (fixture) => fixture.status === "in_progress" && !awaitsResult(fixture, today),
  );
  const todays = mine.filter(
    (fixture) => fixture.status === "published" && fixture.kickoffAt?.slice(0, 10) === today,
  );
  const upcoming = mine.filter(
    (fixture) =>
      fixture.status === "published" &&
      fixture.kickoffAt !== null &&
      fixture.kickoffAt.slice(0, 10) > today,
  );
  const played = Math.max(0, overview.fixtureCount - overview.fixturesOpen);
  const leader = table?.standings.rows[0];
  const numbers = [
    `${formatCount(overview.teamCount)} teams`,
    `${formatCount(overview.approvedPlayers)} players`,
    overview.lotsTotal > 0
      ? `${String(overview.lotsSold)} of ${String(overview.lotsTotal)} sold`
      : null,
    overview.purseCommitted !== undefined
      ? `${cardAmount(season.auctionUnit, overview.purseCommitted)} committed`
      : null,
  ].filter((part): part is string => part !== null);
  const nothing = owed.length + live.length + todays.length + jobs.length === 0;

  return (
    <div className="ot" data-testid="organizer-today">
      {/* ---- one line: which season, where it is, the door to it ---- */}
      <header className="ot-head" data-testid="organizer-today-head">
        <span className="ot-crest" aria-hidden>
          {monogram(season.name)}
        </span>
        <span className="ot-head-text">
          <strong>{season.name}</strong>
          <span className="ot-head-meta">
            <Pill tone="green" dot>
              {live.length > 0 ? "Match day · live" : "Season on"}
            </Pill>
            <span>
              Matches · {formatCount(played)} of {formatCount(overview.fixtureCount)} played
            </span>
          </span>
        </span>
        <Link href={base} className="ot-open">
          Open season
          <IconArrowRight size={14} aria-hidden />
        </Link>
      </header>

      {/* ---- TODAY: everything waiting on this organizer, in one list ---- */}
      <SectionCard
        icon={<IconBolt />}
        concept={nothing ? "done" : "alert"}
        title="Today"
        description={
          nothing
            ? upcoming[0] !== undefined
              ? `Nothing waiting on you. Next match ${when(upcoming[0].kickoffAt, today)}.`
              : "Nothing waiting on you."
            : undefined
        }
        data-testid="organizer-today-jobs"
      >
        {nothing ? null : (
          <ul className="ot-jobs">
            {owed.map((fixture) => (
              <li key={fixture.id} data-kind="owed">
                <span className="ot-job-text">
                  <strong>{sides(fixture)}</strong>
                  <span>
                    {when(fixture.kickoffAt, today)}
                    {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
                  </span>
                </span>
                <span className="ot-due">
                  <Pill tone="amber">Result due</Pill>
                </span>
                <ButtonLink
                  href={`${base}/fixtures?match=${fixture.id}`}
                  size="sm"
                  data-testid={`today-score-${fixture.id}`}
                >
                  Enter score
                </ButtonLink>
              </li>
            ))}
            {live.map((fixture) => (
              <li key={fixture.id} data-kind="live">
                <span className="ot-job-text">
                  <strong>{sides(fixture)}</strong>
                  <span>
                    Being played now
                    {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
                  </span>
                </span>
                <ButtonLink href={`${base}/fixtures?match=${fixture.id}`} size="sm">
                  Enter score
                </ButtonLink>
              </li>
            ))}
            {todays.map((fixture) => (
              <li key={fixture.id} data-kind="today">
                <span className="ot-job-text">
                  <strong>{sides(fixture)}</strong>
                  <span>
                    {when(fixture.kickoffAt, today)}
                    {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
                  </span>
                </span>
                <ButtonLink
                  href={`${base}/fixtures?match=${fixture.id}`}
                  size="sm"
                  variant="secondary"
                >
                  Open
                </ButtonLink>
              </li>
            ))}
            {jobs.map((job) => (
              <li key={job.key} data-kind="job">
                <span className="ot-job-text">
                  <strong>{job.label}</strong>
                  <span>{job.detail}</span>
                </span>
                <ButtonLink href={job.href} size="sm" variant="secondary">
                  {job.verb ?? "Open"}
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="ot-duo">
        {/* ---- NEXT UP: the matches still to come (owed ones live above) ---- */}
        <SectionCard
          icon={<IconCalendar />}
          concept="fixtures"
          title="Next up"
          action={
            <Link href={`${base}/fixtures`} className="home-more">
              Full schedule
              <IconArrowRight size={14} aria-hidden />
            </Link>
          }
          data-testid="organizer-today-next"
        >
          {upcoming.length === 0 ? (
            <p className="ot-quiet">No more matches on the schedule yet.</p>
          ) : (
            <ul className="ot-next">
              {upcoming.slice(0, 3).map((fixture) => {
                const tile =
                  fixture.kickoffAt === null ? null : dateTile(fixture.kickoffAt.slice(0, 10));
                return (
                  <li key={fixture.id}>
                    <span className="home-date" aria-hidden>
                      <b>{tile?.day.padStart(2, "0") ?? "--"}</b>
                      <span>{tile?.month.toUpperCase() ?? "TBD"}</span>
                    </span>
                    <span className="ot-job-text">
                      <strong>{sides(fixture)}</strong>
                      <span>
                        {when(fixture.kickoffAt, today)}
                        {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {/* ---- THE TABLE: what an organizer is asked about at the ground ---- */}
        {table !== null && table.standings.rows.length > 0 ? (
          <SectionCard
            icon={<IconTrophy />}
            concept="results"
            title="Table"
            description={
              leader !== undefined && leader.played > 0
                ? `${leader.teamName} lead on ${String(leader.points)} ${leader.points === 1 ? "pt" : "pts"}`
                : undefined
            }
            action={
              <Link href={`${base}/standings`} className="home-more">
                Full table
                <IconArrowRight size={14} aria-hidden />
              </Link>
            }
            data-testid="organizer-today-table"
          >
            <table className="ot-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Team</th>
                  <th scope="col">P</th>
                  <th scope="col">W</th>
                  <th scope="col">Pts</th>
                </tr>
              </thead>
              <tbody>
                {table.standings.rows.slice(0, 3).map((row, index) => (
                  <tr key={row.teamId}>
                    <td>{index + 1}</td>
                    <th scope="row">{row.teamName}</th>
                    <td>{row.played}</td>
                    <td>{row.won}</td>
                    <td>
                      <strong>{row.points}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        ) : null}
      </div>

      {/* ---- the season's size, said once and quietly ---- */}
      <p className="ot-numbers" data-testid="organizer-today-numbers">
        <IconCheckCircle size={16} aria-hidden />
        {numbers.join(" · ")}
      </p>
      {otherSeasons.length > 0 ? (
        <p className="ot-others">
          Your other seasons:{" "}
          {otherSeasons.map((other, index) => (
            <span key={other.slug}>
              {index > 0 ? " · " : ""}
              <Link href={`/home?season=${encodeURIComponent(other.slug)}`}>{other.name}</Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
