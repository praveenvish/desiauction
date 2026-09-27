"use client";

import { IconArrowRight, IconCalendar, IconChevronRight } from "@desiauction/ui";
import Link from "next/link";

import { FormDialog } from "../../components/form-dialog";
import { formatCount } from "../../lib/plural";
import type { SeasonRow } from "../../server/competition/tournament-actions";
import { dateRange } from "./season-card";
import { SeasonRoad } from "./season-road";
import { STAGE_LABEL, initialsOf, seasonStage, type StageKey } from "./season-stage";
import type { AccordionGroup } from "./tournament-accordion";

/** A tournament (or the one-off bucket) as the index browses it. */
export interface BrowsableGroup extends AccordionGroup {
  /** Epoch ms — a number, so it cannot drift across the server boundary. */
  createdAt: number;
  /** "Cricket" — resolved on the server from the latest season's sport. */
  sportLabel?: string | undefined;
}

/**
 * A TOURNAMENT, AS A CARD (2026-09-27): who it is (crest, club, sport, since
 * when), what it amounts to, and every edition with where it stands — then its
 * two doors, a new season and the tournament's own page.
 *
 * It replaced an accordion whose head was a row of three KPI chips and whose
 * body started closed, so the index showed a tournament's name and hid the
 * seasons that were the reason to open it.
 */

/** Editions past this fold behind "All N seasons" — the tournament page lists them all. */
const SHOWN = 3;

const STAGE_TONE: Record<StageKey, string> = {
  setup: "neutral",
  registration: "info",
  auction: "warning",
  season: "success",
  finished: "neutral",
};

export function StagePill({ stage }: { stage: StageKey }) {
  return (
    <span className="tx-pill" data-tone={STAGE_TONE[stage]}>
      {STAGE_LABEL[stage]}
    </span>
  );
}

export function TournamentCard({
  group,
  today,
  showAll,
}: {
  group: BrowsableGroup;
  today: string;
  /** While the list is filtered, every matching edition shows. */
  showAll: boolean;
}) {
  const seasons = group.seasons;
  const latest = seasons[0];
  const shown = showAll ? seasons : seasons.slice(0, SHOWN);
  const matches = seasons.reduce((sum, season) => sum + season.counts.matches, 0);
  const firstYear = seasons
    .map((season) => season.startsOn?.slice(0, 4))
    .filter((year): year is string => year !== undefined)
    .sort()[0];
  const standalone = group.kind === "standalone";
  const identity = [
    group.meta,
    group.sportLabel,
    firstYear !== undefined ? `since ${firstYear}` : null,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" · ");

  return (
    <article className="tx-card" data-testid={`tg-${group.key}`} data-kind={group.kind}>
      <header className="tx-card-head">
        <span className="tx-crest" data-size="lg" data-kind={group.kind} aria-hidden>
          {standalone ? <IconCalendar size={22} /> : initialsOf(group.name)}
        </span>
        <div className="tx-card-id">
          {group.href !== undefined ? (
            <Link href={group.href} className="tx-card-name">
              {group.name}
            </Link>
          ) : (
            <span className="tx-card-name">{group.name}</span>
          )}
          <span className="tx-card-meta">{identity}</span>
        </div>
        {latest !== undefined && !standalone ? (
          <StagePill stage={seasonStage(latest, today)} />
        ) : null}
      </header>

      <ul className="tx-figures tx-card-figures">
        <li>
          {seasons.length === 0 ? (
            "no seasons yet"
          ) : (
            <>
              <strong>{formatCount(seasons.length)}</strong>{" "}
              {seasons.length === 1 ? "season" : "seasons"}
            </>
          )}
        </li>
        {latest !== undefined && latest.counts.teams > 0 ? (
          <li>
            <strong>{formatCount(latest.counts.teams)}</strong>{" "}
            {latest.counts.teams === 1 ? "team" : "teams"}
          </li>
        ) : null}
        {latest !== undefined && (latest.counts.approved ?? 0) > 0 ? (
          <li>
            <strong>{formatCount(latest.counts.approved ?? 0)}</strong> players
          </li>
        ) : null}
        {matches > 0 ? (
          <li>
            <strong>{formatCount(matches)}</strong> {matches === 1 ? "match" : "matches"}
          </li>
        ) : null}
      </ul>

      <div className="tx-editions">
        <span className="tx-editions-label">{standalone ? "Seasons" : "Editions"}</span>
        {seasons.length === 0 ? (
          <p className="tx-editions-empty">
            {group.canCreateSeason
              ? "No seasons yet — start this year's with “New season”."
              : "No seasons yet. Ask an owner to add a season."}
          </p>
        ) : (
          <ul>
            {shown.map((season) => (
              <li key={season.id}>
                <EditionRow season={season} today={today} />
              </li>
            ))}
          </ul>
        )}
        {!showAll && seasons.length > SHOWN && group.href !== undefined ? (
          <Link href={group.href} className="tx-editions-all">
            All {formatCount(seasons.length)} seasons
            <IconArrowRight size={14} aria-hidden />
          </Link>
        ) : null}
      </div>

      <footer className="tx-card-foot">
        {group.canCreateSeason ? (
          <FormDialog
            title={group.seasonDialogTitle}
            triggerLabel={standalone ? "+ One-off season" : "+ New season"}
            variant="secondary"
            size="sm"
            triggerTestId={`add-season-${group.key}`}
          >
            {group.seasonForm}
          </FormDialog>
        ) : null}
        {group.href !== undefined ? (
          <Link href={group.href} className="tx-card-open">
            Open tournament
            <IconArrowRight size={16} aria-hidden />
          </Link>
        ) : null}
      </footer>
    </article>
  );
}

function EditionRow({ season, today }: { season: SeasonRow; today: string }) {
  const when = dateRange(season.startsOn, season.endsOn);
  const stage = seasonStage(season, today);
  return (
    <Link href={`/seasons/${season.slug}`} className="tx-edition" data-testid="tg-season">
      <span className="tx-edition-id">
        <strong>{season.name}</strong>
        <span>
          {[when, season.location].filter((part) => part !== null).join(" · ") || "Dates to be set"}
        </span>
      </span>
      <SeasonRoad season={season} size="sm" />
      {season.running ? (
        <span className="tx-pill" data-tone="running">
          Now running
        </span>
      ) : (
        <StagePill stage={stage} />
      )}
      <IconChevronRight size={18} className="tx-edition-go" aria-hidden />
    </Link>
  );
}
