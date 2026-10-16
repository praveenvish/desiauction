import type { MatchState } from "@desiauction/core/scoring";
import { ballFacts, matches, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";

/** Rebuildable projection of effective deliveries; original events remain intact. */
export function finalizedBallFacts(
  fixture: { id: string; orgId: string; competitionId: string },
  state: MatchState,
  trustLevel: string,
): (typeof ballFacts.$inferInsert)[] {
  if (!state.format) throw new Error("Finalized deliveries require the frozen format");
  const format = state.format;
  return state.innings.flatMap((innings) =>
    innings.overs.flatMap((over, index) =>
      over.balls.map((ball) => ({
        fixtureId: fixture.id,
        seq: ball.seq,
        orgId: fixture.orgId,
        competitionId: fixture.competitionId,
        inningsNo: innings.no,
        overNo: index + 1,
        ballInOver: Number(ball.over.split(".")[1]),
        legal: ball.legal,
        phase:
          index + 1 <= format.powerplayOvers
            ? "powerplay"
            : index + 1 >= format.deathFromOver
              ? "death"
              : "middle",
        batterId: ball.strikerId,
        batterHand: ball.batterHand ?? null,
        bowlerId: ball.bowlerId,
        bowlerStyle: ball.bowlerStyle ?? null,
        runsBat: ball.runsBat,
        // Primary-extra analytics amount; canonical innings retain all team extras.
        extras: ball.extras.wides
          ? ball.extras.wides
          : ball.extras.noBall
            ? ball.total - ball.runsBat - (ball.extras.byes ?? 0) - (ball.extras.legByes ?? 0)
            : (ball.extras.byes ?? ball.extras.legByes ?? 0),
        extraKind: ball.extras.wides
          ? "wide"
          : ball.extras.noBall
            ? "no_ball"
            : ball.extras.byes
              ? "bye"
              : ball.extras.legByes
                ? "leg_bye"
                : null,
        boundary: ball.boundary ?? null,
        zone: ball.shot?.zone ?? null,
        angle: ball.shot?.angle ?? null,
        wicketKind: ball.wicket?.kind ?? null,
        playerOutId: ball.wicket?.playerOutId ?? null,
        // A multi-fielder dismissal has no single attributable fielder.
        fielderId:
          ball.wicket?.kind === "caught_and_bowled"
            ? ball.bowlerId
            : ball.wicket?.fielderIds.length === 1 &&
                (ball.wicket.unknownFielderCount ?? 0) === 0 &&
                (ball.wicket.substituteFielderIds?.length ?? 0) === 0
              ? (ball.wicket.fielderIds[0] ?? null)
              : null,
        wicketX: ball.wicket?.where?.x ?? null,
        wicketY: ball.wicket?.where?.y ?? null,
        timeOfDay: ball.conditions.timeOfDay ?? null,
        ballType: ball.conditions.ball?.type ?? null,
        groundType: ball.conditions.ground ?? null,
        pitch: ball.conditions.pitch ?? null,
        trustLevel,
        formatKey: format.key,
      })),
    ),
  );
}

/** Caller holds the match lock in the finalization transaction. */
export async function persistFinalizedBallFacts(
  db: Db,
  fixture: { id: string; orgId: string; competitionId: string },
  state: MatchState,
): Promise<void> {
  const [match] = await db
    .select({ trustLevel: matches.trustLevel })
    .from(matches)
    .where(eq(matches.fixtureId, fixture.id));
  if (!match) throw new Error("Finalized match is missing");
  const rows = finalizedBallFacts(fixture, state, match.trustLevel);
  await db.delete(ballFacts).where(eq(ballFacts.fixtureId, fixture.id));
  if (rows.length) await db.insert(ballFacts).values(rows);
}
