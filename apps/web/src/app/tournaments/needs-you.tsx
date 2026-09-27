import { ButtonLink, IconArrowRight, IconCheckCircle, IconPin } from "@desiauction/ui";
import Link from "next/link";

import { formatWallTime } from "../../lib/format-date";
import { formatCount } from "../../lib/plural";
import type { OrganizerFixture } from "../../server/competition/fixtures";
import type { SeasonRow } from "../../server/competition/tournament-actions";
import { SeasonRoad } from "./season-road";
import { dateRange } from "./season-card";
import { STAGE_LABEL, initialsOf, nextStep, seasonStage } from "./season-stage";

/**
 * "NEEDS YOU NOW" — the top of the tournaments index (2026-09-27).
 *
 * It replaced a floodlit banner that featured ONE season in 350px and then
 * listed that same season again right under itself. An organizer comes here to
 * find what is waiting on them, so the band is a to-do list: one compact card
 * per season still in flight, each with its road, a few real figures and the
 * ONE next step as a button (Review 2, Go to the auction, Enter score). Beside
 * it, the next matches across every season they run.
 */

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function dayTile(kickoffAt: string): { weekday: string; day: string } {
  const [y, m, d] = kickoffAt
    .slice(0, 10)
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return { weekday: WEEKDAY[date.getUTCDay()] ?? "", day: String(d ?? "") };
}

export function NeedsYou({
  seasons,
  tournamentNames,
  upcoming,
  today,
}: {
  seasons: readonly SeasonRow[];
  /** The tournament each season is an edition of, by tournament id. */
  tournamentNames: ReadonlyMap<string, string>;
  upcoming: readonly OrganizerFixture[];
  today: string;
}) {
  if (seasons.length === 0 && upcoming.length === 0) {
    return null;
  }
  return (
    <section className="tx-now" aria-labelledby="tx-now-title" data-testid="tg-featured">
      <header className="tx-section-head">
        <h2 id="tx-now-title">Needs you now</h2>
        <p>Seasons in progress, and the one thing each is waiting for</p>
      </header>
      <div className="tx-now-grid" data-count={String(seasons.length)}>
        {seasons.map((season) => (
          <NowCard
            key={season.id}
            season={season}
            parent={
              season.tournamentId !== null
                ? (tournamentNames.get(season.tournamentId) ?? season.orgName)
                : "One-off season"
            }
            today={today}
          />
        ))}
        {seasons.length === 0 ? (
          <article className="tx-caught-up">
            <IconCheckCircle size={22} aria-hidden />
            <span>Nothing is waiting on you. Every season is finished or yet to start.</span>
          </article>
        ) : null}
        {upcoming.length > 0 ? <ComingUp fixtures={upcoming} /> : null}
      </div>
    </section>
  );
}

function NowCard({ season, parent, today }: { season: SeasonRow; parent: string; today: string }) {
  const stage = seasonStage(season, today);
  const step = nextStep(season, today);
  const when = dateRange(season.startsOn, season.endsOn);
  return (
    <article className="tx-now-card" data-testid="tx-now-card" data-stage={stage}>
      <div className="tx-now-top">
        <span className="tx-crest" aria-hidden>
          {initialsOf(season.name)}
        </span>
        <div className="tx-now-id">
          <Link href={`/seasons/${season.slug}`} className="tx-now-name">
            {season.name}
          </Link>
          <span className="tx-now-parent">
            {parent}
            {season.tournamentId !== null && season.orgName !== "" ? ` · ${season.orgName}` : ""}
          </span>
        </div>
        {season.running ? (
          <span className="tx-pill" data-tone="running">
            Now running
          </span>
        ) : null}
      </div>
      <div className="tx-now-road">
        <SeasonRoad season={season} />
        <span className="tx-stage-word">{STAGE_LABEL[stage]}</span>
      </div>
      <ul className="tx-figures">
        {when !== null ? <li>{when}</li> : null}
        {season.counts.teams > 0 ? (
          <li>
            <strong>{formatCount(season.counts.teams)}</strong>{" "}
            {season.counts.teams === 1 ? "team" : "teams"}
          </li>
        ) : null}
        {(season.counts.approved ?? 0) > 0 ? (
          <li>
            <strong>{formatCount(season.counts.approved ?? 0)}</strong> players
          </li>
        ) : null}
      </ul>
      {step !== null ? (
        <div className="tx-now-step">
          <span className="tx-now-why">{step.why}</span>
          <ButtonLink href={`/seasons/${season.slug}`} variant="ghost" size="sm">
            Open
          </ButtonLink>
          <ButtonLink
            href={step.href}
            variant={step.urgent ? "primary" : "secondary"}
            size="sm"
            data-testid="tx-next-step"
          >
            {step.label}
          </ButtonLink>
        </div>
      ) : null}
    </article>
  );
}

function ComingUp({ fixtures }: { fixtures: readonly OrganizerFixture[] }) {
  return (
    <aside className="tx-coming" aria-labelledby="tx-coming-title">
      <h3 id="tx-coming-title">Coming up</h3>
      <ul>
        {fixtures.map((fixture) => {
          const tile = fixture.kickoffAt === null ? null : dayTile(fixture.kickoffAt);
          const teams =
            fixture.homeTeamId === null
              ? `Lobby · ${String(fixture.squadCount)} squads`
              : `${fixture.homeTeamName ?? "TBA"} v ${fixture.awayTeamName ?? "TBA"}`;
          return (
            <li key={fixture.id}>
              <span className="tx-day" aria-hidden>
                <span>{tile?.weekday ?? "—"}</span>
                <strong>{tile?.day ?? ""}</strong>
              </span>
              <span className="tx-coming-text">
                <Link href={`/seasons/${fixture.competitionSlug}/fixtures?match=${fixture.id}`}>
                  {teams}
                </Link>
                <span>
                  {fixture.kickoffAt !== null
                    ? formatWallTime(fixture.kickoffAt)
                    : "Time to be set"}
                  {fixture.groundName !== null ? (
                    <>
                      {" · "}
                      <IconPin size={12} aria-hidden />
                      {fixture.groundName}
                    </>
                  ) : null}
                  {" · "}
                  {fixture.competitionName}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <Link href={`/seasons/${fixtures[0]?.competitionSlug ?? ""}/fixtures`} className="tx-more">
        Full schedule
        <IconArrowRight size={14} aria-hidden />
      </Link>
    </aside>
  );
}
