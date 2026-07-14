import {
  blockingConflicts,
  canEditFixture,
  canRescheduleFixture,
  competitionCode,
  conflictsInvolving,
  detectConflicts,
  fixtureNumber,
  fixtureTransition,
  isValidKickoff,
  planRoundRobin,
  type Conflict,
  type FixtureEvent,
  type FixtureForConflicts,
  type FixtureStatus,
  type GeneratePlanInput,
} from "@desiauction/core";
import { auditLog, fixtures, grounds, newId, teams, type Db } from "@desiauction/db";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import type { CompetitionSummary } from "./competitions";

// THE FIXTURE AGGREGATE (M-IP3-3, CTO addition 1). This module is the ONLY place
// fixtures mutate: generate, create, edit, schedule, publish, reschedule, start,
// complete, cancel. Routes/services call it; nothing else writes fixture rows.
// Every decision comes from core (the lifecycle machine + the conflict engine);
// every mutation commits in a transaction WITH its audit row. Blocking conflicts
// (team/ground double-booking, window violations, malformed schedule data) are
// refused here — the invariants are machine-enforced, not UI-suggested.

export type ConflictRefusal = { ok: false; reason: "conflicts"; conflicts: Conflict[] };

export type FixtureMutationResult =
  | { ok: true; status: FixtureStatus }
  | ConflictRefusal
  | {
      ok: false;
      reason: "not_found" | "illegal_transition" | "guard_failed" | "invalid_input";
    };

/**
 * Conflict input = every fixture in the ORG (grounds are org-wide physical
 * resources — two competitions cannot share a ground simultaneously), with the
 * candidate's own competition window. Cross-competition window flags never
 * involve the candidate, so `conflictsInvolving` filters them out.
 */
async function conflictInputs(db: Db, orgId: string): Promise<FixtureForConflicts[]> {
  return db
    .select({
      id: fixtures.id,
      homeTeamId: fixtures.homeTeamId,
      awayTeamId: fixtures.awayTeamId,
      groundId: fixtures.groundId,
      venueId: grounds.venueId,
      kickoffAt: fixtures.kickoffAt,
      durationMinutes: fixtures.durationMinutes,
      status: fixtures.status,
    })
    .from(fixtures)
    .leftJoin(grounds, eq(grounds.id, fixtures.groundId))
    .where(eq(fixtures.orgId, orgId));
}

function windowOf(competition: CompetitionSummary): {
  startsOn: string | null;
  endsOn: string | null;
} {
  return { startsOn: competition.startsOn, endsOn: competition.endsOn };
}

/** Blocking conflicts the candidate set is involved in, against the whole org. */
async function blockingFor(
  db: Db,
  competition: CompetitionSummary,
  candidates: readonly FixtureForConflicts[],
  replaceIds: readonly string[],
): Promise<Conflict[]> {
  const existing = (await conflictInputs(db, competition.orgId)).filter(
    (f) => !replaceIds.includes(f.id),
  );
  const all = detectConflicts([...existing, ...candidates], windowOf(competition));
  return blockingConflicts(
    conflictsInvolving(
      all,
      candidates.map((c) => c.id),
    ),
  );
}

/** Warnings + blockers for the whole competition — the dashboard's conflict panel. */
export async function competitionConflicts(
  db: Db,
  competition: CompetitionSummary,
): Promise<Conflict[]> {
  const orgFixtures = await conflictInputs(db, competition.orgId);
  const mine = new Set(
    (
      await db
        .select({ id: fixtures.id })
        .from(fixtures)
        .where(eq(fixtures.competitionId, competition.id))
    ).map((r) => r.id),
  );
  return conflictsInvolving(detectConflicts(orgFixtures, windowOf(competition)), [...mine]);
}

async function venueOf(db: Db, groundId: string | null): Promise<string | null> {
  if (groundId === null) {
    return null;
  }
  const [row] = await db
    .select({ venueId: grounds.venueId })
    .from(grounds)
    .where(eq(grounds.id, groundId))
    .limit(1);
  return row?.venueId ?? null;
}

interface FixtureRow {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  groundId: string | null;
  kickoffAt: string | null;
  durationMinutes: number | null;
  status: FixtureStatus;
}

async function loadFixture(
  db: Db,
  competitionId: string,
  fixtureId: string,
): Promise<FixtureRow | undefined> {
  const [row] = await db
    .select({
      id: fixtures.id,
      homeTeamId: fixtures.homeTeamId,
      awayTeamId: fixtures.awayTeamId,
      groundId: fixtures.groundId,
      kickoffAt: fixtures.kickoffAt,
      durationMinutes: fixtures.durationMinutes,
      status: fixtures.status,
    })
    .from(fixtures)
    .where(and(eq(fixtures.id, fixtureId), eq(fixtures.competitionId, competitionId)))
    .limit(1);
  return row;
}

/** Per-competition creation sequence — the fixture number's stable source. */
async function nextSeq(db: Db, competitionId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${fixtures.seq}), 0)::int` })
    .from(fixtures)
    .where(eq(fixtures.competitionId, competitionId));
  return (row?.max ?? 0) + 1;
}

const LIFECYCLE_TIMESTAMPS: Partial<Record<FixtureEvent["type"], string>> = {
  publish: "publishedAt",
  start: "startedAt",
  complete: "completedAt",
  cancel: "cancelledAt",
};

/**
 * The aggregate's atomic unit: one machine-decided transition, one audit row,
 * one transaction. All lifecycle entry points below funnel through this.
 */
async function applyTransition(
  db: Db,
  competition: CompetitionSummary,
  row: FixtureRow,
  actorId: string,
  event: FixtureEvent,
  extraFields: Record<string, unknown> = {},
  extraMeta: Record<string, string> = {},
): Promise<FixtureMutationResult> {
  const decision = fixtureTransition(row.status, event, {
    hasKickoff: row.kickoffAt !== null,
    hasGround: row.groundId !== null,
  });
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }
  const stampField = LIFECYCLE_TIMESTAMPS[event.type];
  await db.transaction(async (tx) => {
    await tx
      .update(fixtures)
      .set({
        status: decision.next,
        ...(stampField !== undefined ? { [stampField]: new Date() } : {}),
        ...extraFields,
      })
      .where(eq(fixtures.id, row.id));
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: `fixture.${event.type}`,
      scopeType: "org",
      scopeId: competition.orgId,
      subject: row.id,
      meta: { from: row.status, to: decision.next, ...extraMeta },
    });
  });
  return { ok: true, status: decision.next };
}

// --- Generate (deterministic round robin) --------------------------------------

export interface GenerateInput {
  rounds: 1 | 2;
  startDate: string;
  kickoffTimes: readonly string[];
  groundIds: readonly string[];
  durationMinutes: number;
}

export type GenerateResult =
  | { ok: true; created: number }
  | ConflictRefusal
  | {
      ok: false;
      reason: "fixtures_exist" | "unknown_ground" | GeneratePlanResultError;
    };

type GeneratePlanResultError =
  | "too_few_teams"
  | "duplicate_team"
  | "no_grounds"
  | "invalid_start_date"
  | "invalid_kickoff_times"
  | "invalid_duration";

/**
 * Deterministic generation: teams ordered by (name, id), core plans the whole
 * schedule, numbers are allocated in plan order. Refused while any live fixture
 * exists — regeneration over a live schedule would corrupt stable numbers.
 * Generated fixtures land as DRAFTS; publishing is an explicit, separate step.
 */
export async function generateFixtures(
  db: Db,
  competition: CompetitionSummary,
  actorId: string,
  input: GenerateInput,
): Promise<GenerateResult> {
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(fixtures)
    .where(and(eq(fixtures.competitionId, competition.id), ne(fixtures.status, "cancelled")));
  if ((existing?.count ?? 0) > 0) {
    return { ok: false, reason: "fixtures_exist" };
  }
  const teamRows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.competitionId, competition.id))
    .orderBy(asc(teams.name), asc(teams.id));
  // Grounds must be this org's, active, and known (availability engine).
  if (input.groundIds.length > 0) {
    const known = await db
      .select({ id: grounds.id })
      .from(grounds)
      .where(
        and(
          eq(grounds.orgId, competition.orgId),
          eq(grounds.status, "active"),
          inArray(grounds.id, input.groundIds as string[]),
        ),
      );
    if (known.length !== new Set(input.groundIds).size) {
      return { ok: false, reason: "unknown_ground" };
    }
  }
  const planInput: GeneratePlanInput = {
    teamIds: teamRows.map((t) => t.id),
    rounds: input.rounds,
    startDate: input.startDate,
    kickoffTimes: input.kickoffTimes,
    groundIds: input.groundIds,
    durationMinutes: input.durationMinutes,
  };
  const plan = planRoundRobin(planInput);
  if (!plan.ok) {
    return { ok: false, reason: plan.reason };
  }

  const venueByGround = new Map<string, string | null>();
  for (const groundId of input.groundIds) {
    venueByGround.set(groundId, await venueOf(db, groundId));
  }
  const baseSeq = await nextSeq(db, competition.id);
  const code = competitionCode(competition.name, competition.startsOn);
  const candidates: FixtureForConflicts[] = plan.fixtures.map((f, i) => ({
    id: `candidate-${String(baseSeq + i)}`,
    homeTeamId: f.homeTeamId,
    awayTeamId: f.awayTeamId,
    groundId: f.groundId,
    venueId: venueByGround.get(f.groundId) ?? null,
    kickoffAt: f.kickoffAt,
    durationMinutes: f.durationMinutes,
    status: "draft",
  }));
  // The plan is internally conflict-free by construction; this guards against
  // collisions with OTHER competitions' fixtures on shared grounds + the window.
  const blockers = await blockingFor(db, competition, candidates, []);
  if (blockers.length > 0) {
    return { ok: false, reason: "conflicts", conflicts: blockers };
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < plan.fixtures.length; i++) {
      const f = plan.fixtures[i];
      if (f === undefined) {
        continue;
      }
      const seq = baseSeq + i;
      await tx.insert(fixtures).values({
        id: newId(),
        orgId: competition.orgId,
        competitionId: competition.id,
        fixtureNumber: fixtureNumber(code, seq),
        seq,
        round: f.round,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
        groundId: f.groundId,
        kickoffAt: f.kickoffAt,
        durationMinutes: f.durationMinutes,
        status: "draft",
        createdBy: actorId,
      });
    }
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "fixture.generated",
      scopeType: "org",
      scopeId: competition.orgId,
      subject: competition.id,
      meta: {
        count: String(plan.fixtures.length),
        rounds: String(input.rounds),
        startDate: input.startDate,
      },
    });
  });
  return { ok: true, created: plan.fixtures.length };
}

// --- Manual creation + editing --------------------------------------------------

export interface ManualFixtureInput {
  homeTeamId: string;
  awayTeamId: string;
  groundId?: string;
  kickoffAt?: string;
  durationMinutes?: number;
  round?: number;
}

export type CreateFixtureResult =
  | { ok: true; fixtureId: string; number: string }
  | { ok: false; reason: "invalid_input" | "unknown_team" | "unknown_ground" };

/** Manual scheduling: a hand-made fixture lands as a DRAFT (schedule is explicit). */
export async function createFixture(
  db: Db,
  competition: CompetitionSummary,
  actorId: string,
  input: ManualFixtureInput,
): Promise<CreateFixtureResult> {
  if (input.homeTeamId === input.awayTeamId) {
    return { ok: false, reason: "invalid_input" };
  }
  if (input.kickoffAt !== undefined && !isValidKickoff(input.kickoffAt)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (
    input.durationMinutes !== undefined &&
    (!Number.isInteger(input.durationMinutes) ||
      input.durationMinutes <= 0 ||
      input.durationMinutes > 1440)
  ) {
    return { ok: false, reason: "invalid_input" };
  }
  const teamRows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.competitionId, competition.id),
        inArray(teams.id, [input.homeTeamId, input.awayTeamId]),
      ),
    );
  if (teamRows.length !== 2) {
    return { ok: false, reason: "unknown_team" };
  }
  if (input.groundId !== undefined) {
    const [ground] = await db
      .select({ id: grounds.id })
      .from(grounds)
      .where(and(eq(grounds.id, input.groundId), eq(grounds.orgId, competition.orgId)))
      .limit(1);
    if (ground === undefined) {
      return { ok: false, reason: "unknown_ground" };
    }
  }
  const seq = await nextSeq(db, competition.id);
  const number = fixtureNumber(competitionCode(competition.name, competition.startsOn), seq);
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(fixtures).values({
      id,
      orgId: competition.orgId,
      competitionId: competition.id,
      fixtureNumber: number,
      seq,
      round: input.round ?? null,
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
      groundId: input.groundId ?? null,
      kickoffAt: input.kickoffAt ?? null,
      durationMinutes: input.durationMinutes ?? null,
      status: "draft",
      createdBy: actorId,
    });
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "fixture.created",
      scopeType: "org",
      scopeId: competition.orgId,
      subject: id,
      meta: { number },
    });
  });
  return { ok: true, fixtureId: id, number };
}

export interface FixturePatch {
  groundId?: string | null;
  kickoffAt?: string | null;
  durationMinutes?: number | null;
}

function patchedRow(row: FixtureRow, patch: FixturePatch): FixtureRow {
  return {
    ...row,
    groundId: patch.groundId !== undefined ? patch.groundId : row.groundId,
    kickoffAt: patch.kickoffAt !== undefined ? patch.kickoffAt : row.kickoffAt,
    durationMinutes:
      patch.durationMinutes !== undefined ? patch.durationMinutes : row.durationMinutes,
  };
}

function invalidPatch(patch: FixturePatch): boolean {
  if (
    patch.kickoffAt !== undefined &&
    patch.kickoffAt !== null &&
    !isValidKickoff(patch.kickoffAt)
  ) {
    return true;
  }
  return (
    patch.durationMinutes !== undefined &&
    patch.durationMinutes !== null &&
    (!Number.isInteger(patch.durationMinutes) ||
      patch.durationMinutes <= 0 ||
      patch.durationMinutes > 1440)
  );
}

async function candidateOf(db: Db, row: FixtureRow): Promise<FixtureForConflicts> {
  return {
    id: row.id,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    groundId: row.groundId,
    venueId: await venueOf(db, row.groundId),
    kickoffAt: row.kickoffAt,
    durationMinutes: row.durationMinutes,
    status: row.status,
  };
}

/**
 * Fixture editing (draft/scheduled only — published requires the reschedule
 * workflow, completed is immutable). Scheduled edits are conflict-checked.
 */
export async function editFixture(
  db: Db,
  competition: CompetitionSummary,
  fixtureId: string,
  actorId: string,
  patch: FixturePatch,
): Promise<FixtureMutationResult> {
  const row = await loadFixture(db, competition.id, fixtureId);
  if (row === undefined) {
    return { ok: false, reason: "not_found" };
  }
  if (!canEditFixture(row.status)) {
    return { ok: false, reason: "illegal_transition" };
  }
  if (invalidPatch(patch)) {
    return { ok: false, reason: "invalid_input" };
  }
  const next = patchedRow(row, patch);
  if (row.status === "scheduled") {
    // A scheduled fixture holds a live slot — the invariant check applies.
    const blockers = await blockingFor(db, competition, [await candidateOf(db, next)], [row.id]);
    if (blockers.length > 0) {
      return { ok: false, reason: "conflicts", conflicts: blockers };
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(fixtures)
      .set({
        groundId: next.groundId,
        kickoffAt: next.kickoffAt,
        durationMinutes: next.durationMinutes,
      })
      .where(eq(fixtures.id, row.id));
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "fixture.edited",
      scopeType: "org",
      scopeId: competition.orgId,
      subject: row.id,
      meta: {
        ...(patch.kickoffAt !== undefined
          ? { fromKickoff: row.kickoffAt ?? "", toKickoff: patch.kickoffAt ?? "" }
          : {}),
        ...(patch.groundId !== undefined
          ? { fromGround: row.groundId ?? "", toGround: patch.groundId ?? "" }
          : {}),
      },
    });
  });
  return { ok: true, status: row.status };
}

// --- Lifecycle operations --------------------------------------------------------

/** Draft → Scheduled. The slot goes live: blocking conflicts are refused. */
export async function scheduleFixture(
  db: Db,
  competition: CompetitionSummary,
  fixtureId: string,
  actorId: string,
  patch: FixturePatch = {},
): Promise<FixtureMutationResult> {
  const row = await loadFixture(db, competition.id, fixtureId);
  if (row === undefined) {
    return { ok: false, reason: "not_found" };
  }
  if (invalidPatch(patch)) {
    return { ok: false, reason: "invalid_input" };
  }
  const next = patchedRow(row, patch);
  const decision = fixtureTransition(
    row.status,
    { type: "schedule" },
    {
      hasKickoff: next.kickoffAt !== null,
      hasGround: next.groundId !== null,
    },
  );
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }
  const blockers = await blockingFor(
    db,
    competition,
    [await candidateOf(db, { ...next, status: "scheduled" })],
    [row.id],
  );
  if (blockers.length > 0) {
    return { ok: false, reason: "conflicts", conflicts: blockers };
  }
  // Pass the PATCHED row: the guard must see the kickoff/ground being applied.
  return applyTransition(
    db,
    competition,
    next,
    actorId,
    { type: "schedule" },
    {
      groundId: next.groundId,
      kickoffAt: next.kickoffAt,
      durationMinutes: next.durationMinutes,
    },
  );
}

export interface BulkLifecycleResult {
  applied: number;
  skipped: number;
}

/** Schedule every eligible draft (kickoff+ground present, conflict-free) at once. */
export async function scheduleAllDrafts(
  db: Db,
  competition: CompetitionSummary,
  actorId: string,
): Promise<BulkLifecycleResult> {
  const drafts = await db
    .select({ id: fixtures.id })
    .from(fixtures)
    .where(and(eq(fixtures.competitionId, competition.id), eq(fixtures.status, "draft")))
    .orderBy(asc(fixtures.seq));
  let applied = 0;
  let skipped = 0;
  // Sequential singles: each schedule sees the previous one's slot (identical to
  // N individual actions — the M-IP3-2 bulk contract).
  for (const draft of drafts) {
    const result = await scheduleFixture(db, competition, draft.id, actorId);
    if (result.ok) {
      applied++;
    } else {
      skipped++;
    }
  }
  return { applied, skipped };
}

/** Scheduled → Published: the schedule becomes the public record. */
export async function publishFixture(
  db: Db,
  competition: CompetitionSummary,
  fixtureId: string,
  actorId: string,
): Promise<FixtureMutationResult> {
  const row = await loadFixture(db, competition.id, fixtureId);
  if (row === undefined) {
    return { ok: false, reason: "not_found" };
  }
  return applyTransition(db, competition, row, actorId, { type: "publish" });
}

export async function publishAllScheduled(
  db: Db,
  competition: CompetitionSummary,
  actorId: string,
): Promise<BulkLifecycleResult> {
  const scheduled = await db
    .select({ id: fixtures.id })
    .from(fixtures)
    .where(and(eq(fixtures.competitionId, competition.id), eq(fixtures.status, "scheduled")))
    .orderBy(asc(fixtures.seq));
  let applied = 0;
  let skipped = 0;
  for (const row of scheduled) {
    const result = await publishFixture(db, competition, row.id, actorId);
    if (result.ok) {
      applied++;
    } else {
      skipped++;
    }
  }
  return { applied, skipped };
}

/**
 * The reschedule workflow — the ONLY way a published fixture moves (invariant:
 * published fixtures never silently change). Conflict-checked, provenance in
 * the audit row (old → new), status unchanged.
 */
export async function rescheduleFixture(
  db: Db,
  competition: CompetitionSummary,
  fixtureId: string,
  actorId: string,
  patch: FixturePatch,
): Promise<FixtureMutationResult> {
  const row = await loadFixture(db, competition.id, fixtureId);
  if (row === undefined) {
    return { ok: false, reason: "not_found" };
  }
  if (!canRescheduleFixture(row.status)) {
    return { ok: false, reason: "illegal_transition" };
  }
  if (invalidPatch(patch)) {
    return { ok: false, reason: "invalid_input" };
  }
  const next = patchedRow(row, patch);
  if (next.kickoffAt === null || next.groundId === null) {
    // A reschedule may move a fixture, never un-schedule it.
    return { ok: false, reason: "invalid_input" };
  }
  const blockers = await blockingFor(db, competition, [await candidateOf(db, next)], [row.id]);
  if (blockers.length > 0) {
    return { ok: false, reason: "conflicts", conflicts: blockers };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(fixtures)
      .set({
        groundId: next.groundId,
        kickoffAt: next.kickoffAt,
        durationMinutes: next.durationMinutes,
      })
      .where(eq(fixtures.id, row.id));
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "fixture.rescheduled",
      scopeType: "org",
      scopeId: competition.orgId,
      subject: row.id,
      meta: {
        fromKickoff: row.kickoffAt ?? "",
        toKickoff: next.kickoffAt,
        fromGround: row.groundId ?? "",
        toGround: next.groundId,
      },
    });
  });
  return { ok: true, status: row.status };
}

/** Published → InProgress (match day). */
export async function startFixture(
  db: Db,
  competition: CompetitionSummary,
  fixtureId: string,
  actorId: string,
): Promise<FixtureMutationResult> {
  const row = await loadFixture(db, competition.id, fixtureId);
  if (row === undefined) {
    return { ok: false, reason: "not_found" };
  }
  return applyTransition(db, competition, row, actorId, { type: "start" });
}

/** InProgress → Completed. Terminal: the fixture becomes immutable, permanently. */
export async function completeFixture(
  db: Db,
  competition: CompetitionSummary,
  fixtureId: string,
  actorId: string,
): Promise<FixtureMutationResult> {
  const row = await loadFixture(db, competition.id, fixtureId);
  if (row === undefined) {
    return { ok: false, reason: "not_found" };
  }
  return applyTransition(db, competition, row, actorId, { type: "complete" });
}

/** Any pre-terminal state → Cancelled. The slot is released; the row remains. */
export async function cancelFixture(
  db: Db,
  competition: CompetitionSummary,
  fixtureId: string,
  actorId: string,
  reason?: string,
): Promise<FixtureMutationResult> {
  const row = await loadFixture(db, competition.id, fixtureId);
  if (row === undefined) {
    return { ok: false, reason: "not_found" };
  }
  const note = reason?.trim() ?? "";
  return applyTransition(
    db,
    competition,
    row,
    actorId,
    { type: "cancel" },
    note !== "" ? { cancelReason: note.slice(0, 300) } : {},
    note !== "" ? { reason: note.slice(0, 300) } : {},
  );
}
