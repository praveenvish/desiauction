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
import {
  auditLog,
  fixtureParticipants,
  fixtures,
  grounds,
  newId,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { formatKickoff } from "../../lib/format-date";
import type { CompetitionSummary } from "./competitions";

// THE FIXTURE AGGREGATE (M-IP3-3, CTO addition 1). This module is the ONLY place
// fixtures mutate: generate, create, edit, schedule, publish, reschedule, start,
// complete, cancel. Routes/services call it; nothing else writes fixture rows.
// Every decision comes from core (the lifecycle machine + the conflict engine);
// every mutation commits in a transaction WITH its audit row. Blocking conflicts
// (team/ground double-booking, window violations, malformed schedule data) are
// refused here — the invariants are machine-enforced, not UI-suggested.

/**
 * A conflict the organizer can act on. Core deals in fixture IDs — correct for a
 * pure engine, useless on screen: "two fixtures overlap at the same venue" three
 * times over names nothing an organizer can look up. Every conflict that leaves
 * this module carries the fixture numbers, the teams and the kickoff.
 */
export interface ConflictFixture {
  id: string;
  number: string;
  teams: string;
  kickoffAt: string | null;
}

export interface LabelledConflict extends Conflict {
  fixtures: ConflictFixture[];
  /** One sentence naming the fixtures involved — the toast and panel line. */
  summary: string;
}

export type ConflictRefusal = { ok: false; reason: "conflicts"; conflicts: LabelledConflict[] };

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
export async function conflictInputs(db: Db, orgId: string): Promise<FixtureForConflicts[]> {
  return db
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
    .where(eq(fixtures.orgId, orgId));
}

const homeTeams = alias(teams, "conflict_home_teams");
const awayTeams = alias(teams, "conflict_away_teams");

/**
 * Resolve every fixture a conflict set names into something an organizer can
 * find on the schedule. Candidate rows that do not exist yet (generation and
 * import both conflict-check BEFORE writing) keep their synthetic id and are
 * described by the caller's `pending` map.
 */
export async function labelConflicts(
  db: Db,
  conflicts: readonly Conflict[],
  pending: ReadonlyMap<string, ConflictFixture> = new Map(),
): Promise<LabelledConflict[]> {
  const ids = [...new Set(conflicts.flatMap((c) => c.fixtureIds))].filter((id) => !pending.has(id));
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: fixtures.id,
            number: fixtures.fixtureNumber,
            home: homeTeams.name,
            away: awayTeams.name,
            kickoffAt: fixtures.kickoffAt,
          })
          .from(fixtures)
          .leftJoin(homeTeams, eq(homeTeams.id, fixtures.homeTeamId))
          .leftJoin(awayTeams, eq(awayTeams.id, fixtures.awayTeamId))
          .where(inArray(fixtures.id, ids));
  const byId = new Map<string, ConflictFixture>(pending);
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      number: row.number,
      teams: `${row.home ?? "Unknown"} vs ${row.away ?? "Unknown"}`,
      kickoffAt: row.kickoffAt,
    });
  }
  return conflicts.map((conflict) => {
    const involved = conflict.fixtureIds.map(
      (id) => byId.get(id) ?? { id, number: "—", teams: "Unknown fixture", kickoffAt: null },
    );
    return { ...conflict, fixtures: involved, summary: conflictSummary(conflict, involved) };
  });
}

function conflictSummary(conflict: Conflict, involved: readonly ConflictFixture[]): string {
  const named = involved.map((f) => `${f.number} (${f.teams})`).join(" and ");
  const when = involved.find((f) => f.kickoffAt !== null)?.kickoffAt ?? null;
  const at = when === null ? "" : ` at ${formatKickoff(when)}`;
  if (involved.length > 1) {
    return `${named} — ${conflict.detail}${at}.`;
  }
  return `${named} — ${conflict.detail}.`;
}

function windowOf(competition: CompetitionSummary): {
  startsOn: string | null;
  endsOn: string | null;
} {
  return { startsOn: competition.startsOn, endsOn: competition.endsOn };
}

/** Blocking conflicts the candidate set is involved in, against the whole org. */
export async function blockingFor(
  db: Db,
  competition: CompetitionSummary,
  candidates: readonly FixtureForConflicts[],
  replaceIds: readonly string[],
  pending: ReadonlyMap<string, ConflictFixture> = new Map(),
): Promise<LabelledConflict[]> {
  const existing = (await conflictInputs(db, competition.orgId)).filter(
    (f) => !replaceIds.includes(f.id),
  );
  const all = detectConflicts([...existing, ...candidates], windowOf(competition));
  return labelConflicts(
    db,
    blockingConflicts(
      conflictsInvolving(
        all,
        candidates.map((c) => c.id),
      ),
    ),
    pending,
  );
}

/** Warnings + blockers for the whole competition — the dashboard's conflict panel. */
export async function competitionConflicts(
  db: Db,
  competition: CompetitionSummary,
): Promise<LabelledConflict[]> {
  const orgFixtures = await conflictInputs(db, competition.orgId);
  const mine = new Set(
    (
      await db
        .select({ id: fixtures.id })
        .from(fixtures)
        .where(eq(fixtures.competitionId, competition.id))
    ).map((r) => r.id),
  );
  return labelConflicts(
    db,
    conflictsInvolving(detectConflicts(orgFixtures, windowOf(competition)), [...mine]),
  );
}

interface FixtureRow {
  id: string;
  /** Null on a LOBBY (0058) — both together or neither, per the CHECK. */
  homeTeamId: string | null;
  awayTeamId: string | null;
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

  const baseSeq = await nextSeq(db, competition.id);
  const code = competitionCode(competition.name, competition.startsOn);
  const candidates: FixtureForConflicts[] = plan.fixtures.map((f, i) => ({
    id: `candidate-${String(baseSeq + i)}`,
    homeTeamId: f.homeTeamId,
    awayTeamId: f.awayTeamId,
    groundId: f.groundId,
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

export interface GeneratePreview {
  teams: number;
  count: number;
  rounds: number;
  firstDate: string;
  lastDate: string;
}

export type GeneratePreviewResult =
  | { ok: true; preview: GeneratePreview }
  | { ok: false; reason: "fixtures_exist" | GeneratePlanResultError };

/**
 * The same plan, costed but not written. 240 fixtures used to land blind — no
 * count, no date range, no confirmation — and a league asked to start 1 March
 * silently ended 28 June, discoverable only on page 10 of the schedule.
 * Deliberately reuses `planRoundRobin`, so the preview cannot drift from the
 * schedule it is previewing.
 */
export async function previewGeneration(
  db: Db,
  competition: CompetitionSummary,
  input: GenerateInput,
): Promise<GeneratePreviewResult> {
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
  const plan = planRoundRobin({
    teamIds: teamRows.map((t) => t.id),
    rounds: input.rounds,
    startDate: input.startDate,
    kickoffTimes: input.kickoffTimes,
    groundIds: input.groundIds,
    durationMinutes: input.durationMinutes,
  });
  if (!plan.ok) {
    return { ok: false, reason: plan.reason };
  }
  const dates = plan.fixtures.map((f) => f.kickoffAt.slice(0, 10)).sort();
  return {
    ok: true,
    preview: {
      teams: teamRows.length,
      count: plan.fixtures.length,
      rounds: plan.fixtures.reduce((max, f) => (f.round > max ? f.round : max), 0),
      firstDate: dates[0] ?? input.startDate,
      lastDate: dates[dates.length - 1] ?? input.startDate,
    },
  };
}

/**
 * Undo for a generation nobody wanted. `generateFixtures` refuses while any
 * non-cancelled fixture exists, and there was no delete, no bulk cancel and no
 * discard — undoing 240 fixtures meant 240 clicks. Cancelling every draft
 * releases their slots and clears the way to regenerate; published and started
 * fixtures are never touched, which is why this is drafts-only.
 */
export async function discardDrafts(
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
  for (const draft of drafts) {
    const result = await cancelFixture(db, competition, draft.id, actorId, "discarded draft");
    if (result.ok) {
      applied++;
    } else {
      skipped++;
    }
  }
  return { applied, skipped };
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

export interface LobbyFixtureInput {
  /** The squads dropping into this lobby. Scheduled, not discovered. */
  teamIds: readonly string[];
  groundId?: string;
  kickoffAt?: string;
  durationMinutes?: number;
  round?: number;
}

export type CreateLobbyResult =
  | { ok: true; fixtureId: string; number: string }
  | { ok: false; reason: "invalid_input" | "unknown_team" | "unknown_ground" };

/**
 * SCHEDULE A LOBBY: one match, many squads, no home and no away.
 *
 * The sibling of `createFixture`, and deliberately a separate function rather
 * than a mode of it. The two shapes validate different things — a duel refuses
 * a team playing itself, a lobby refuses a squad entered twice — and folding
 * them into one entry point would put an `if` at the top of every rule.
 *
 * Lands as a DRAFT, exactly as a hand-made duel does: scheduling is explicit
 * here and publishing is a separate, deliberate act.
 */
export async function createLobbyFixture(
  db: Db,
  competition: CompetitionSummary,
  actorId: string,
  input: LobbyFixtureInput,
): Promise<CreateLobbyResult> {
  const unique = [...new Set(input.teamIds)];
  /*
   * TWO IS A CONTEST; one squad is a practice session. The upper bound matches
   * the placement CHECK — a hundred squads in one lobby is a typo, not an
   * event — and a duplicate is refused here rather than left to the primary
   * key, so the caller gets a reason instead of a constraint name.
   */
  if (unique.length !== input.teamIds.length || unique.length < 2 || unique.length > 100) {
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
    .where(and(eq(teams.competitionId, competition.id), inArray(teams.id, unique)));
  if (teamRows.length !== unique.length) {
    // A squad from another season, or one that has been deleted. Refused whole:
    // a lobby missing a squad is a different match from the one asked for.
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
      // NO HOME AND NO AWAY. `fixtures_sides_check` requires both or neither,
      // so this is what makes the row a lobby rather than a broken duel.
      homeTeamId: null,
      awayTeamId: null,
      groundId: input.groundId ?? null,
      kickoffAt: input.kickoffAt ?? null,
      durationMinutes: input.durationMinutes ?? null,
      status: "draft",
      createdBy: actorId,
    });
    await tx.insert(fixtureParticipants).values(
      unique.map((teamId) => ({
        fixtureId: id,
        teamId,
        orgId: competition.orgId,
        competitionId: competition.id,
      })),
    );
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "fixture.created",
      scopeType: "org",
      scopeId: competition.orgId,
      subject: id,
      meta: { number, shape: "lobby", squads: String(unique.length) },
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

function candidateOf(row: FixtureRow): FixtureForConflicts {
  return {
    id: row.id,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    groundId: row.groundId,
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
    const blockers = await blockingFor(db, competition, [candidateOf(next)], [row.id]);
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
    [candidateOf({ ...next, status: "scheduled" })],
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
  const blockers = await blockingFor(db, competition, [candidateOf(next)], [row.id]);
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
