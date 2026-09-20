import { PageIntro } from "@desiauction/ui";

import { SiblingLink } from "../sibling-link";
import Link from "next/link";
import { notFound } from "next/navigation";

import { lineupPageView } from "../../../../server/competition/lineup-actions";
import type { LineupFixture } from "../../../../server/competition/lineups";
import { LineupSideEditor } from "./lineup-side-editor";
import "./lineups.css";

export const metadata = { title: "Lineups · DesiAuction" };

/**
 * WHO PLAYED EACH MATCH (launch polish, Phase 3).
 *
 * The organizer ticks the players who took the field for each side. That is
 * the fact a player's profile counts as a match played — results alone are per
 * team and can never say which fifteen of a twenty-player squad were there.
 */
function sideState(count: number | null): string {
  return count === null ? "not recorded" : `${String(count)} played`;
}

function kickoff(fixture: LineupFixture): string {
  if (fixture.kickoffAt === null) return "Date to be set";
  const [date, time] = fixture.kickoffAt.split("T");
  const d = new Date(`${date ?? ""}T00:00:00`);
  const day = Number.isNaN(d.getTime())
    ? (date ?? "")
    : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return time !== undefined ? `${day} · ${time}` : day;
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
  return (
    <main className="lineups">
      <PageIntro
        subtitle="Tick who took the field. Each player's profile counts it as a match played."
        actions={<SiblingLink href={`/seasons/${slug}/registrations`} label="Registrations" />}
      />
      {fixtures.length === 0 ? (
        <section className="lineups-empty">
          <h2>No matches yet</h2>
          <p>
            Lineups are recorded per match. Create the fixtures first, then come back after each
            game.
          </p>
          <Link href={`/seasons/${slug}/fixtures`}>Go to fixtures</Link>
        </section>
      ) : (
        <div className="lineups-layout">
          <nav className="lineups-matches" aria-label="Matches">
            <ul>
              {fixtures.map((fixture) => {
                const current = fixture.id === selected?.id;
                const complete = fixture.recorded.home !== null && fixture.recorded.away !== null;
                return (
                  <li key={fixture.id}>
                    <Link
                      href={`/seasons/${slug}/lineups?fixture=${fixture.id}`}
                      className="lineups-match"
                      aria-current={current ? "page" : undefined}
                      data-testid="lineup-match"
                    >
                      <span className="lineups-match-when">{kickoff(fixture)}</span>
                      <strong>
                        {fixture.home.name} vs {fixture.away.name}
                      </strong>
                      <span
                        className={`lineups-match-state${complete ? " lineups-match-state--done" : ""}`}
                      >
                        {complete
                          ? "Both lineups in"
                          : `${fixture.home.name}: ${sideState(fixture.recorded.home)} · ${fixture.away.name}: ${sideState(fixture.recorded.away)}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {selected !== null ? (
            <section className="lineups-editor" aria-labelledby="lineups-match-title">
              <header className="lineups-editor-head">
                <h2 id="lineups-match-title">
                  {selected.home.name} vs {selected.away.name}
                </h2>
                <span>
                  {selected.number} · {kickoff(selected)}
                </span>
              </header>
              <div className="lineups-sides">
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
              <p className="lineups-note">
                A side that is never saved shows as “not recorded” on player profiles, never as
                “didn’t play”. You can correct a lineup at any time.
              </p>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
