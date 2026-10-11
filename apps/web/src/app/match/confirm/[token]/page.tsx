import {
  isPlacementState,
  isDeliveryState,
  scoringResult,
} from "../../../../server/scoring/family-state";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { placementTable, parseSeasonScoringRules, oversText } from "@desiauction/core/scoring";
import { teams } from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { SectionCard } from "@desiauction/ui";
import Link from "next/link";
import { currentSession } from "../../../../server/auth/actions";
import { confirmationTenant } from "../../../../server/competition/resolve";
import { readConfirmationToken } from "../../../../server/scoring/confirmation-token";
import { confirmationContext } from "../../../../server/scoring/confirmation";
import { inOrg } from "../../../../server/tenant";
import { ConfirmationForm } from "./confirmation-form";
import "../../../seasons/seasons.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Confirm match result",
  robots: { index: false, follow: false },
};
export default async function ConfirmationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!readConfirmationToken(token)) notFound();
  const session = await currentSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/match/confirm/${token}`)}`);
  const orgId = await confirmationTenant(session.personId, token);
  if (!orgId) notFound();
  const context = await inOrg(session.personId, orgId, async (db) => {
    const match = await confirmationContext(db, session.personId, token);
    if (!match) return null;
    const names = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(
        and(
          eq(teams.orgId, orgId),
          eq(teams.competitionId, match.fixture.competitionId),
          inArray(
            teams.id,
            (isPlacementState(match.state)
              ? match.state.teamIds
              : [match.fixture.homeTeamId, match.fixture.awayTeamId]
            ).filter((id): id is string => id !== null),
          ),
        ),
      );
    return { ...match, names: Object.fromEntries(names.map((team) => [team.id, team.name])) };
  });
  if (!context) notFound();
  const lobby = isPlacementState(context.state) ? context.state : null;
  const { result, score } = isPlacementState(context.state)
    ? { result: null, score: {} }
    : scoringResult(context.state, parseSeasonScoringRules(null));
  const deliveryState = isDeliveryState(context.state) ? context.state : null;
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <p>Signed in as {session.name ?? "team manager"}</p>
        <p>{context.fixture.fixtureNumber}</p>
        <h1>Is this result right?</h1>
        <SectionCard title="Recorded result">
          <dl>
            {lobby
              ? placementTable(lobby).map((row) => (
                  <div key={row.teamId}>
                    <dt>{context.names[row.teamId] ?? "Squad"}</dt>
                    <dd>
                      {row.placement} · {row.points} points · {row.kills} kills
                    </dd>
                  </div>
                ))
              : deliveryState
                ? deliveryState.innings
                    .filter((innings) => !innings.superOver)
                    .map((innings) => (
                      <div key={innings.no}>
                        <dt>{context.names[innings.battingTeamId] ?? "Team"}</dt>
                        <dd>
                          {innings.runs}/{innings.wickets} (
                          {oversText(innings.legalBalls, deliveryState.format?.ballsPerOver ?? 6)})
                        </dd>
                      </div>
                    ))
                : Object.entries(score).map(([side, values]) => (
                    <div key={side}>
                      <dt>
                        {context.names[
                          ("teams" in context.state
                            ? context.state.teams?.[side === "home" ? "home" : "away"]
                            : null) ?? ""
                        ] ?? "Team"}
                      </dt>
                      <dd>
                        {Object.entries(values)
                          .map(([key, value]) => `${String(value)} ${key}`)
                          .join(" · ")}
                      </dd>
                    </div>
                  ))}
          </dl>
          <p>
            {result?.winnerTeamId ? `${context.names[result.winnerTeamId] ?? "Winner"} won ` : ""}
            {result?.marginText ?? "Match finished"}
          </p>
          <Link href={`/m/${encodeURIComponent(context.match.shareToken)}?tab=scorecard`}>
            Check the full scorecard
          </Link>
        </SectionCard>
        <SectionCard title="What confirming does">
          <p>
            Your response records the opposing team’s confirmation. Verified and confirmed matches
            qualify for leaderboards. A disputed match stays flagged until an authorized review
            resolves it.
          </p>
          <p>
            A match may qualify automatically after 48 hours when it was scored live, had enough
            viewers and has no unresolved trust concerns.
          </p>
        </SectionCard>
        <ConfirmationForm token={token} />
      </div>
    </main>
  );
}
