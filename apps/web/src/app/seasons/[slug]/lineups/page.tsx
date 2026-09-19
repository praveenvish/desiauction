import {
  ButtonLink,
  IconCalendar,
  IconCheckCircle,
  IconClock,
  IconList,
  IconMatch,
  IconUsers,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
  TeamChip,
} from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatWallDate, formatWallTime } from "../../../../lib/format-date";
import { lineupPageView } from "../../../../server/competition/lineup-actions";
import type { LineupFixture } from "../../../../server/competition/lineups";
import { LineupSideEditor } from "./lineup-side-editor";
import "../../seasons.css";
import "../_tabs/tabs.css";
import "./lineups.css";

export const metadata = { title: "Lineups · DesiAuction" };

/**
 * WHO PLAYED EACH MATCH (launch polish, Phase 3).
 *
 * The organizer ticks the players who took the field for each side. That is
 * the fact a player's profile counts as a match played — results alone are per
 * team and can never say which fifteen of a twenty-player squad were there.
 */
function kickoff(fixture: LineupFixture): string {
  if (fixture.kickoffAt === null) return "Date to be set";
  return `${formatWallDate(fixture.kickoffAt.slice(0, 10))} · ${formatWallTime(fixture.kickoffAt)}`;
}

/** How far this match's lineups have got: both in, one in, or none. */
function progress(fixture: LineupFixture): { label: string; tone: "green" | "amber" | "neutral" } {
  const inCount =
    (fixture.recorded.home !== null ? 1 : 0) + (fixture.recorded.away !== null ? 1 : 0);
  if (inCount === 2) return { label: "Both in", tone: "green" };
  if (inCount === 1) return { label: "1 of 2 in", tone: "amber" };
  return { label: "Not recorded", tone: "neutral" };
}

export default async function LineupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ fixture?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const view = await lineupPageView(slug, query.fixture ?? null);
  if (view === null) {
    notFound();
  }
  const { fixtures, selected, sides, announce } = view;
  const complete = fixtures.filter(
    (fixture) => fixture.recorded.home !== null && fixture.recorded.away !== null,
  ).length;
  const played = fixtures.filter((fixture) => fixture.status === "completed").length;
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <div className="st-head">
          <p className="st-head-lede">
            Tick who took the field. Each player&apos;s profile counts it as a match played.
          </p>
          <div className="st-actions">
            <ButtonLink href={`/seasons/${slug}/fixtures`} variant="secondary" size="sm">
              <IconList size={16} aria-hidden />
              Fixtures
            </ButtonLink>
          </div>
        </div>

        {fixtures.length === 0 ? (
          <SectionCard icon={<IconUsers />} title="Lineups">
            <div className="st-empty">
              <span className="st-empty-glyph" aria-hidden>
                <IconCalendar size={26} />
              </span>
              <h3>No matches yet</h3>
              <p>
                Lineups are recorded per match. Create the fixtures first, then come back after each
                game.
              </p>
              <div className="st-empty-actions">
                <ButtonLink href={`/seasons/${slug}/fixtures`} size="sm">
                  Go to fixtures
                </ButtonLink>
              </div>
            </div>
          </SectionCard>
        ) : (
          <>
            <StatGrid>
              <StatCard
                icon={<IconMatch />}
                tone="gold"
                value={fixtures.length}
                label="Matches"
                hint={`${String(played)} played`}
              />
              <StatCard
                icon={<IconCheckCircle />}
                tone="green"
                value={complete}
                label="Lineups complete"
                hint="Both sides recorded"
                progress={fixtures.length > 0 ? (complete / fixtures.length) * 100 : 0}
              />
              <StatCard
                icon={<IconClock />}
                tone="amber"
                value={fixtures.length - complete}
                label="Still to record"
                hint="One side or both missing"
              />
            </StatGrid>

            <div className="lu-layout">
              <SectionCard
                icon={<IconCalendar />}
                title="Matches"
                description={`${String(fixtures.length)} in kickoff order`}
                flush
                className="lu-matches"
              >
                <nav aria-label="Matches">
                  <ul className="lu-match-list">
                    {fixtures.map((fixture) => {
                      const current = fixture.id === selected?.id;
                      const state = progress(fixture);
                      return (
                        <li key={fixture.id}>
                          <Link
                            href={`/seasons/${slug}/lineups?fixture=${fixture.id}`}
                            className="lu-match"
                            aria-current={current ? "page" : undefined}
                            data-testid="lineup-match"
                          >
                            <span className="lu-match-top">
                              <span className="st-sub">{kickoff(fixture)}</span>
                              <Pill tone={state.tone}>{state.label}</Pill>
                            </span>
                            <span className="lu-match-teams">
                              <TeamChip color={fixture.home.color}>{fixture.home.name}</TeamChip>
                              <span className="lu-vs">vs</span>
                              <TeamChip color={fixture.away.color}>{fixture.away.name}</TeamChip>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              </SectionCard>

              {selected !== null ? (
                <SectionCard
                  icon={<IconUsers />}
                  title={`${selected.home.name} vs ${selected.away.name}`}
                  description={`${selected.number} · ${kickoff(selected)}`}
                  action={
                    <span className="lu-status">
                      <Pill tone={selected.status === "completed" ? "green" : "blue"}>
                        {selected.status.replace(/_/g, " ")}
                      </Pill>
                    </span>
                  }
                >
                  <div className="lu-sides">
                    {sides.map((side) => (
                      <LineupSideEditor
                        key={`${selected.id}:${side.teamId}`}
                        slug={slug}
                        fixtureId={selected.id}
                        side={side}
                        announce={announce[side.teamId]}
                      />
                    ))}
                  </div>
                  <p className="st-note lu-note">
                    A side that is never saved shows as “not recorded” on player profiles, never as
                    “didn’t play”. You can correct a lineup at any time.
                  </p>
                </SectionCard>
              ) : null}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
