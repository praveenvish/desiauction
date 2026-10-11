import {
  auditLog,
  fixtureParticipants,
  fixtureOfficials,
  teamManagers,
  newId,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ScoringFixture } from "./authority";
import type { MatchEvent } from "@desiauction/core/scoring";

export interface TrustRevision {
  attempt: number;
  lastSeq: number;
}
export interface TrustEvidence {
  id: string;
  actor: string | null;
  action: string;
  at: Date;
  meta: Record<string, unknown>;
}
export async function trustEvidence(db: Db, fixture: { id: string; orgId: string }) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.scopeType, "org"),
        eq(auditLog.scopeId, fixture.orgId),
        eq(auditLog.subject, fixture.id),
      ),
    );
  return rows.map((row): TrustEvidence => ({
    ...row,
    meta:
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {},
  }));
}
/** The caller holds the match lock; explicit order survives clock ties/regressions. */
export async function appendTrustEvidence(
  db: Db,
  fixture: { id: string; orgId: string },
  actor: string,
  action: string,
  meta: Record<string, unknown>,
  now: Date,
) {
  const rows = await trustEvidence(db, fixture);
  const order =
    rows.reduce(
      (n, row) => (typeof row.meta.trustOrder === "number" ? Math.max(n, row.meta.trustOrder) : n),
      0,
    ) + 1;
  await db.insert(auditLog).values({
    id: newId(),
    actor,
    action,
    scopeType: "org",
    scopeId: fixture.orgId,
    subject: fixture.id,
    meta: { ...meta, trustOrder: order },
    at: now,
  });
}
export function sameTrustRevision(meta: Record<string, unknown>, revision: TrustRevision) {
  return meta.attempt === revision.attempt && meta.lastSeq === revision.lastSeq;
}
export async function representedTeams(db: Db, fixture: ScoringFixture, personId: string) {
  const sides = [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => id !== null);
  if (!sides.length) {
    const lobby = await db
      .select({ teamId: fixtureParticipants.teamId })
      .from(fixtureParticipants)
      .where(
        and(
          eq(fixtureParticipants.fixtureId, fixture.id),
          eq(fixtureParticipants.orgId, fixture.orgId),
          eq(fixtureParticipants.competitionId, fixture.competitionId),
        ),
      );
    sides.push(...lobby.map((row) => row.teamId));
  }
  if (!sides.length) return [];
  const direct = await db
    .select({ teamId: teamManagers.teamId })
    .from(teamManagers)
    .where(
      and(
        eq(teamManagers.orgId, fixture.orgId),
        eq(teamManagers.competitionId, fixture.competitionId),
        eq(teamManagers.personId, personId),
        inArray(teamManagers.teamId, sides),
        isNull(teamManagers.revokedAt),
      ),
    );
  const officials = await db
    .select({ id: fixtureOfficials.id })
    .from(fixtureOfficials)
    .where(
      and(
        eq(fixtureOfficials.fixtureId, fixture.id),
        eq(fixtureOfficials.orgId, fixture.orgId),
        eq(fixtureOfficials.competitionId, fixture.competitionId),
        eq(fixtureOfficials.personId, personId),
        eq(fixtureOfficials.role, "scorer"),
        isNull(fixtureOfficials.removedAt),
      ),
    );
  const evidence = await trustEvidence(db, fixture);
  const inherited = evidence
    .filter(
      (row) =>
        row.action === "match.claim.handover_redeemed" &&
        row.meta.inheritedAuthority === "d" &&
        officials.some((official) => official.id === row.meta.officialId),
    )
    .flatMap<unknown>((row) => {
      const values: readonly unknown[] = Array.isArray(row.meta.representedTeamIds)
        ? row.meta.representedTeamIds
        : [];
      return [...values];
    })
    .filter((id): id is string => typeof id === "string" && sides.includes(id));
  return [...new Set([...direct.map((row) => row.teamId), ...inherited])].sort();
}
export async function recordScoringAuthority(
  db: Db,
  fixture: ScoringFixture,
  actor: string,
  arm: "a" | "b" | "c" | "d",
  events: readonly MatchEvent[],
  now: Date,
  representedTeamId?: string,
) {
  if (!events.length) return;
  let represented: string[] = [];
  if (arm === "d") {
    represented = await representedTeams(db, fixture, actor);
    if (!fixture.homeTeamId && !fixture.awayTeamId) {
      const previous = (await trustEvidence(db, fixture))
        .filter((row) => row.actor === actor && row.action === "match.trust.scoring_authority")
        .sort((a, b) => Number(a.meta.trustOrder) - Number(b.meta.trustOrder))
        .at(-1);
      const stored: unknown =
        Array.isArray(previous?.meta.representedTeamIds) &&
        previous.meta.representedTeamIds.length === 1
          ? previous.meta.representedTeamIds[0]
          : undefined;
      const selected =
        representedTeamId ??
        (typeof stored === "string" && represented.includes(stored)
          ? stored
          : represented.length === 1
            ? represented[0]
            : undefined);
      represented = selected && represented.includes(selected) ? [selected] : [];
    }
  }
  await appendTrustEvidence(
    db,
    fixture,
    actor,
    "match.trust.scoring_authority",
    {
      authority: arm,
      representedTeamIds: represented,
      events: events.map((event) => ({
        eventId: event.eventId,
        seq: event.seq,
        attempt: event.attempt,
      })),
    },
    now,
  );
}

/** Evidence is authoritative only when it covers the actual accepted event. */
export function historicalAuthority(rows: readonly TrustEvidence[], events: readonly MatchEvent[]) {
  const relevant = events.filter((event) => event.attempt === events.at(-1)?.attempt);
  const arms = new Set<string>();
  const sides = new Set<string>();
  const scorers = new Set<string>();
  let complete = relevant.length > 0;
  for (const event of relevant) {
    const evidence = rows.find(
      (row) =>
        row.action === "match.trust.scoring_authority" &&
        row.actor === event.actorPersonId &&
        Array.isArray(row.meta.events) &&
        row.meta.events.some(
          (value: unknown) =>
            value !== null &&
            typeof value === "object" &&
            "eventId" in value &&
            value.eventId === event.eventId &&
            "seq" in value &&
            value.seq === event.seq &&
            "attempt" in value &&
            value.attempt === event.attempt,
        ),
    );
    const arm = evidence?.meta.authority;
    if (typeof arm !== "string" || !["a", "b", "c", "d"].includes(arm)) {
      complete = false;
      continue;
    }
    arms.add(arm);
    if (arm === "d") {
      scorers.add(event.actorPersonId);
      const represented = evidence?.meta.representedTeamIds;
      if (
        !Array.isArray(represented) ||
        represented.length !== 1 ||
        typeof represented[0] !== "string"
      )
        complete = false;
      else sides.add(represented[0]);
    }
  }
  const elevated = complete && !arms.has("d");
  return {
    complete,
    authority: {
      a: elevated && arms.has("a"),
      b: elevated && arms.has("b"),
      c: elevated && arms.has("c"),
      d: arms.has("d"),
    },
    representedTeamId:
      complete && arms.has("d") && sides.size === 1 ? ([...sides][0] ?? null) : null,
    scorerIds: [...scorers],
  };
}
export function effectiveTrustDecisions(rows: readonly TrustEvidence[], revision: TrustRevision) {
  const ordered = [...rows]
    .filter((row) => typeof row.meta.trustOrder === "number")
    .sort((a, b) => Number(a.meta.trustOrder) - Number(b.meta.trustOrder));
  let disputed = false;
  let organiserVerified = false;
  let manualHold = false;
  let platformExcluded = false;
  for (const row of ordered) {
    const same = sameTrustRevision(row.meta, revision);
    if (row.action === "match.trust.platform_excluded") platformExcluded = true;
    if (row.action === "match.trust.platform_verified" && same) platformExcluded = false;
    if (!same) continue;
    if (row.action === "match.trust.confirmation" && row.meta.verdict === "disputed") {
      disputed = true;
      organiserVerified = false;
    }
    if (row.action === "match.trust.kept_flagged") {
      manualHold = true;
      organiserVerified = false;
    }
    if (["match.trust.organizer_verified", "match.trust.platform_verified"].includes(row.action)) {
      organiserVerified = true;
      manualHold = false;
      // Retain disputed evidence as a reason; verification resolves its effect.
    }
  }
  return { disputed, organiserVerified, manualHold, platformExcluded };
}
