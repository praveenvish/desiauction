import { scoringEngine } from "./engine";
import {
  parseSeasonScoringRules,
  publicLiveProjection,
  selectDelayedEntry,
  type PublicScoringState as PublicLiveState,
  type RaidClockContext,
  type PublicScorecard,
  type PublicCharts,
  type OverlayProjection,
} from "@desiauction/core/scoring";
import {
  scoringPublicAccess,
  competitions,
  fixtures,
  matches,
  matchLiveState,
  withTenantDb,
  type Db,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, exists, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { styleLabel } from "@desiauction/core";
import { registrations, organizations, teamManagers } from "@desiauction/db";
import { aggregateFacts, withSample } from "../insights/sample";
import { slowestBowlingMatchup } from "../insights/batter";
import type { PublicOverlay } from "./overlay-types";
import { dbHandle, systemDb } from "../db";
import type { StoredLiveState } from "./live-state";
import { SCORING_SYSTEM_ACTOR } from "./system-actor";
import { resultDetailsProjection, type PublicResultDetails } from "./result-details";

export interface PublicAccessProof {
  t?: string;
  s?: string;
}
export interface PublicViewerIdentity {
  fixtureId: string;
  orgId: string;
}
export function publicAccessProof(raw: unknown): PublicAccessProof | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const proof: PublicAccessProof = {};
  for (const key of ["t", "s"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || value[key].length === 0 || value[key].length > 128)
      return null;
    proof[key] = value[key];
  }
  return proof;
}
/** Whole-match void withdraws publication without disclosing a newer snapshot. */
export function publicMatchAvailable() {
  return ne(matches.phase, "void");
}
function gated(reader: Db, fixtureId: string, proof: PublicAccessProof) {
  return reader
    .select({ fixtureId: fixtures.id, orgId: fixtures.orgId })
    .from(fixtures)
    .innerJoin(matches, eq(matches.fixtureId, fixtures.id))
    .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
    .where(scoringPublicAccess(fixtureId, proof))
    .limit(1);
}
/** Closed public DTO; ring history and any additional stored keys stay private. */
export async function publicViewerIdentity(
  fixtureId: string,
  proof: PublicAccessProof,
  reader: Db = systemDb,
): Promise<PublicViewerIdentity | null> {
  const [row] = await gated(reader, fixtureId, proof);
  return row ? { fixtureId: row.fixtureId, orgId: row.orgId } : null;
}
async function selectedPublicEntry(
  fixtureId: string,
  proof: PublicAccessProof,
  now = new Date(),
  reader: Db = systemDb,
): Promise<{
  live: PublicLiveState;
  clock?: RaidClockContext;
  scorecard?: PublicScorecard;
  charts?: PublicCharts;
  resultDetails?: PublicResultDetails;
  overlay?: OverlayProjection;
} | null> {
  const [identity] = await gated(reader, fixtureId, proof);
  if (!identity) return null;
  // Recheck access in the projection statement, so revocation between reads cannot disclose it.
  const [row] = await reader
    .select({
      state: matchLiveState.state,
      trust: matches.trustLevel,
      phase: matches.phase,
      rules: competitions.scoringRules,
      sport: competitions.sport,
    })
    .from(fixtures)
    .innerJoin(matches, eq(matches.fixtureId, fixtures.id))
    .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
    .innerJoin(
      matchLiveState,
      and(
        eq(matchLiveState.fixtureId, fixtures.id),
        eq(matchLiveState.orgId, fixtures.orgId),
        eq(matchLiveState.competitionId, fixtures.competitionId),
      ),
    )
    .where(scoringPublicAccess(fixtureId, proof))
    .limit(1);
  if (!row) return null;
  const engine = scoringEngine(row.sport);
  if (!engine) return null;
  const stored = row.state as StoredLiveState;
  const delay = parseSeasonScoringRules(row.rules).publicDelaySeconds;
  let selected:
    | {
        state: PublicLiveState;
        scorecard?: PublicScorecard;
        charts?: PublicCharts;
        resultDetails?: PublicResultDetails;
        overlay?: OverlayProjection;
      }
    | undefined = {
    state: stored,
    ...(stored.scorecard ? { scorecard: stored.scorecard } : {}),
    ...(stored.charts ? { charts: stored.charts } : {}),
    ...(stored.resultDetails ? { resultDetails: stored.resultDetails } : {}),
    ...(stored.overlay ? { overlay: stored.overlay } : {}),
  };
  selected = selectDelayedEntry(
    selected,
    Array.isArray(stored.history) ? stored.history : [],
    row.trust,
    delay,
    now.getTime(),
  );
  const projected = selected ? publicLiveProjection(selected.state, engine.family) : null;
  return selected && projected
    ? {
        live: { ...projected, trust: row.trust },
        ...(projected.family === "raid" || projected.family === "timed"
          ? {
              clock: {
                serverAtMs: now.getTime(),
                delayMs: row.trust === "verified" ? 0 : delay * 1000,
              },
            }
          : {}),
        ...(selected.overlay?.seq === selected.state.seq ? { overlay: selected.overlay } : {}),
        ...(selected.scorecard && selected.scorecard.seq === selected.state.seq
          ? { scorecard: scorecardProjection(selected.scorecard) }
          : {}),
        ...(selected.charts && selected.charts.seq === selected.state.seq
          ? { charts: chartsProjection(selected.charts) }
          : {}),
        ...(row.phase !== "void" &&
        selected.state.result &&
        selected.resultDetails &&
        selected.resultDetails.seq === selected.state.seq
          ? { resultDetails: resultDetailsProjection(selected.resultDetails) }
          : {}),
      }
    : null;
}
/** Explicit nested chart fields exclude any additional stored private data. */
function chartsProjection(charts: PublicCharts): PublicCharts {
  return {
    v: charts.v,
    seq: charts.seq,
    ballsPerOver: charts.ballsPerOver,
    innings: charts.innings.map((innings) => ({
      no: innings.no,
      battingTeamId: innings.battingTeamId,
      superOver: innings.superOver,
      runs: innings.runs,
      wickets: innings.wickets,
      legalBalls: innings.legalBalls,
      currentBatterIds: [...innings.currentBatterIds],
      batters: innings.batters.map(({ id, name, initials }) => ({ id, name, initials })),
      shots: innings.shots.map(({ seq, batterId, angle, runs, boundary }) => ({
        seq,
        batterId,
        angle,
        runs,
        boundary,
      })),
      overs: innings.overs.map(({ number, complete, legalBalls, runs, wickets }) => ({
        number,
        complete,
        legalBalls,
        runs,
        wickets,
      })),
      points: innings.points.map(
        ({ seq, kind, runs, wickets, legalBalls, completedOvers, ballsInOver, subsequent }) => ({
          seq,
          kind,
          runs,
          wickets,
          legalBalls,
          completedOvers,
          ballsInOver,
          subsequent,
        }),
      ),
      adjustments: innings.adjustments.map(
        ({ seq, kind, runs, wickets, legalBalls, subsequent }) => ({
          seq,
          kind,
          runs,
          wickets,
          legalBalls,
          subsequent,
        }),
      ),
    })),
  };
}
/** Closed scorecard rows cannot carry additional stored private keys. */
function scorecardProjection(card: PublicScorecard): PublicScorecard {
  return {
    v: card.v,
    seq: card.seq,
    ballsPerOver: card.ballsPerOver,
    innings: card.innings.map(({ battingTeamId, superOver, batting, bowling, extras }) => ({
      battingTeamId,
      superOver,
      batting: batting.map(
        ({
          id,
          name,
          initials,
          runs,
          balls,
          fours,
          sixes,
          dismissal,
          attribution,
          notOut,
          retiredHurt,
        }) => ({
          id,
          name,
          initials,
          runs,
          balls,
          fours,
          sixes,
          dismissal,
          ...(attribution
            ? {
                attribution: {
                  bowler: attribution.bowler
                    ? {
                        id: attribution.bowler.id,
                        name: attribution.bowler.name,
                        initials: attribution.bowler.initials,
                      }
                    : null,
                  fielders: attribution.fielders.map(
                    ({
                      id: fielderId,
                      name: fielderName,
                      initials: fielderInitials,
                      substitute,
                    }) => ({
                      id: fielderId,
                      name: fielderName,
                      initials: fielderInitials,
                      substitute,
                    }),
                  ),
                  unknownFielders: attribution.unknownFielders,
                },
              }
            : {}),
          notOut,
          retiredHurt,
        }),
      ),
      bowling: bowling.map(
        ({ id, name, initials, legalBalls, overs, maidens, runs, wickets, wides, noBalls }) => ({
          id,
          name,
          initials,
          legalBalls,
          overs,
          maidens,
          runs,
          wickets,
          wides,
          noBalls,
        }),
      ),
      extras: {
        wides: extras.wides,
        noBalls: extras.noBalls,
        byes: extras.byes,
        legByes: extras.legByes,
        penalty: extras.penalty,
      },
    })),
  };
}
export async function publicLive(
  fixtureId: string,
  proof: PublicAccessProof,
  now = new Date(),
  reader: Db = systemDb,
): Promise<PublicLiveState | null> {
  return (await selectedPublicEntry(fixtureId, proof, now, reader))?.live ?? null;
}
/** One selected released snapshot for both score facts and optional raid clock headers. */
export async function publicLiveEnvelope(
  fixtureId: string,
  proof: PublicAccessProof,
  now = new Date(),
  reader: Db = systemDb,
) {
  const entry = await selectedPublicEntry(fixtureId, proof, now, reader);
  return entry ? { live: entry.live, ...(entry.clock ? { clock: entry.clock } : {}) } : null;
}
function closedOverlay(value: OverlayProjection | undefined): OverlayProjection | null {
  if (!value) return null;
  const delivery = value.lastDelivery;
  return {
    seq: value.seq,
    attempt: value.attempt,
    inningsNo: value.inningsNo,
    betweenOvers: (value.betweenOvers as unknown) === true,
    lastDelivery: delivery
      ? {
          seq: delivery.seq,
          boundary: delivery.boundary === 4 || delivery.boundary === 6 ? delivery.boundary : null,
          dismissal: (delivery.dismissal as unknown) === true,
          sting:
            delivery.sting === "four" || delivery.sting === "six" || delivery.sting === "wicket"
              ? delivery.sting
              : null,
        }
      : null,
  };
}
export function overlayRepresentationEtag(value: PublicOverlay): string {
  return `"overlay-${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
}
/** Only a selected delayed striker can request a publicly eligible historical statistic. */
export async function publicLiveOverlay(
  fixtureId: string,
  proof: PublicAccessProof,
  now = new Date(),
  reader: Db = systemDb,
): Promise<PublicOverlay | null> {
  const selected = await selectedPublicEntry(fixtureId, proof, now, reader);
  if (!selected) return null;
  const result: PublicOverlay = {
    live: selected.live,
    overlay: closedOverlay(selected.overlay),
    stat: null,
  };
  const striker = selected.live.batters.find((batter) => batter.onStrike);
  if (result.overlay?.betweenOvers && striker) {
    const [subject] = await reader
      .select({ personId: registrations.personId, orgId: fixtures.orgId })
      .from(fixtures)
      .innerJoin(matches, eq(matches.fixtureId, fixtures.id))
      .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
      .innerJoin(organizations, eq(organizations.id, fixtures.orgId))
      .innerJoin(
        registrations,
        and(
          eq(registrations.id, striker.id),
          eq(registrations.orgId, fixtures.orgId),
          eq(registrations.competitionId, fixtures.competitionId),
        ),
      )
      .where(
        and(
          scoringPublicAccess(fixtureId, proof),
          eq(competitions.visibility, "public"),
          eq(organizations.kind, "club"),
          eq(registrations.status, "approved"),
          sql`(${registrations.dateOfBirth} IS NULL OR ${registrations.dateOfBirth}::date <= (${now.toISOString()}::timestamptz::date - interval '18 years')::date)`,
        ),
      )
      .limit(1);
    if (subject?.personId) {
      const groups = await aggregateFacts(
        reader,
        { kind: "public", ...subject },
        "batting",
        "bowler_style",
        { excludeFixtureId: fixtureId },
        now,
      );
      const matchup = slowestBowlingMatchup({
        bowlingTypes: groups.map((row) => ({
          ...withSample(row),
          strikeRate: row.balls ? (row.runs * 100) / row.balls : null,
        })),
      });
      if (matchup)
        result.stat = {
          subject: Array.from(striker.name)
            .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
            .join("")
            .slice(0, 160),
          style: (styleLabel(matchup.style) ?? matchup.style).slice(0, 80),
          rate: matchup.rate,
          sample: { balls: matchup.sample.balls, matches: matchup.sample.matches },
        };
    }
  }
  const current = await selectedPublicEntry(fixtureId, proof, now, reader);
  return current &&
    current.live.seq === selected.live.seq &&
    current.live.trust === selected.live.trust
    ? result
    : null;
}
export async function publicLiveScorecard(
  fixtureId: string,
  proof: PublicAccessProof,
  now = new Date(),
  reader: Db = systemDb,
): Promise<{ live: PublicLiveState; scorecard: PublicScorecard } | null> {
  const selected = await selectedPublicEntry(fixtureId, proof, now, reader);
  return selected?.scorecard ? { live: selected.live, scorecard: selected.scorecard } : null;
}
export async function publicLiveCharts(
  fixtureId: string,
  proof: PublicAccessProof,
  now = new Date(),
  reader: Db = systemDb,
): Promise<{ live: PublicLiveState; charts: PublicCharts } | null> {
  const selected = await selectedPublicEntry(fixtureId, proof, now, reader);
  return selected?.charts ? { live: selected.live, charts: selected.charts } : null;
}
export async function publicLiveResult(
  fixtureId: string,
  proof: PublicAccessProof,
  now = new Date(),
  reader: Db = systemDb,
): Promise<{
  live: PublicLiveState;
  resultDetails: PublicResultDetails | null;
  clock?: RaidClockContext;
} | null> {
  const selected = await selectedPublicEntry(fixtureId, proof, now, reader);
  return selected
    ? {
        live: selected.live,
        resultDetails: selected.resultDetails ?? null,
        ...(selected.clock ? { clock: selected.clock } : {}),
      }
    : null;
}
/** The scorer holding this match, or a manager of either side: their views do not count. */
export async function isMatchInsider(
  fixtureId: string,
  personId: string,
  reader: Db = systemDb,
): Promise<boolean> {
  const [row] = await reader
    .select({ id: matches.fixtureId })
    .from(matches)
    .innerJoin(fixtures, eq(fixtures.id, matches.fixtureId))
    .where(
      and(
        eq(matches.fixtureId, fixtureId),
        or(
          eq(matches.scorerPersonId, personId),
          exists(
            reader
              .select({ id: teamManagers.id })
              .from(teamManagers)
              .where(
                and(
                  eq(teamManagers.personId, personId),
                  isNull(teamManagers.revokedAt),
                  or(
                    eq(teamManagers.teamId, sql`${fixtures.homeTeamId}`),
                    eq(teamManagers.teamId, sql`${fixtures.awayTeamId}`),
                  ),
                ),
              ),
          ),
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}
/** Anonymous metric, gated again inside the app-role tenant transaction. */
export async function flushPublicViewer(
  identity: PublicViewerIdentity,
  proofs: readonly PublicAccessProof[],
  count: number,
  handle: DbHandle = dbHandle,
): Promise<boolean> {
  return withTenantDb(
    handle,
    { personId: SCORING_SYSTEM_ACTOR, orgId: identity.orgId },
    async (db) => {
      let allowed = false;
      for (const proof of proofs) {
        const [current] = await gated(db, identity.fixtureId, proof);
        if (current?.orgId === identity.orgId) {
          allowed = true;
          break;
        }
      }
      if (!allowed) return false;
      // The gate is repeated atomically in the UPDATE as well.
      const permitted = db
        .select({ id: fixtures.id })
        .from(fixtures)
        .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
        .where(
          and(
            eq(fixtures.orgId, identity.orgId),
            or(...proofs.map((proof) => scoringPublicAccess(identity.fixtureId, proof))),
          ),
        );
      await db
        .update(matches)
        .set({ viewerPeak: sql`greatest(${matches.viewerPeak}, ${count})` })
        .where(
          and(
            eq(matches.fixtureId, identity.fixtureId),
            eq(matches.orgId, identity.orgId),
            inArray(matches.fixtureId, permitted),
          ),
        );
      return true;
    },
  );
}
