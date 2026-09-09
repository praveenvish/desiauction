/**
 * The Fixture & Venue domain (M-IP3-3). Scheduling only — no auction logic, no
 * scoring, no live match management. Three pure pieces live here:
 *
 *   1. the canonical Fixture lifecycle machine (Draft → Scheduled → Published →
 *      InProgress → Completed | Cancelled) — typed states, typed events, fail
 *      closed, illegal transitions unrepresentable;
 *   2. the deterministic scheduling engine (round-robin pairings + slot
 *      assignment) — identical inputs always produce identical fixtures, no
 *      randomness, no ambient time;
 *   3. the reusable conflict engine — structural, deterministic detection that
 *      future Auction scheduling and Match Operations consume unchanged.
 *
 * Kickoffs are LOCAL WALL-CLOCK strings ("YYYY-MM-DDTHH:MM"), matching the
 * competition's text dates: local-first tournaments run in one timezone, and
 * wall time keeps generation, comparison, import and export byte-deterministic.
 */

// --- Fixture lifecycle (canonical machine, M-IP3-3 directive) -----------------

export type FixtureStatus =
  "draft" | "scheduled" | "published" | "in_progress" | "completed" | "cancelled";

export const FIXTURE_STATUSES: readonly FixtureStatus[] = [
  "draft",
  "scheduled",
  "published",
  "in_progress",
  "completed",
  "cancelled",
];

export type FixtureEvent =
  | { type: "schedule" } // draft → scheduled (guard: kickoff + ground present)
  | { type: "publish" } // scheduled → published
  | { type: "start" } // published → in_progress (match day)
  | { type: "complete" } // in_progress → completed (terminal, immutable)
  | { type: "cancel" }; // any pre-completed state → cancelled (terminal)

const FIXTURE_EDGES: Record<FixtureStatus, ReadonlySet<FixtureEvent["type"]>> = {
  draft: new Set(["schedule", "cancel"]),
  scheduled: new Set(["publish", "cancel"]),
  published: new Set(["start", "cancel"]),
  in_progress: new Set(["complete", "cancel"]),
  // Completed fixtures are immutable; cancelled fixtures stay cancelled.
  completed: new Set([]),
  cancelled: new Set([]),
};

const FIXTURE_EVENT_TARGET: Record<FixtureEvent["type"], FixtureStatus> = {
  schedule: "scheduled",
  publish: "published",
  start: "in_progress",
  complete: "completed",
  cancel: "cancelled",
};

/** Inputs the schedule guard consults — the caller supplies proof, never intent. */
export interface FixtureReadiness {
  hasKickoff: boolean;
  hasGround: boolean;
}

export type FixtureTransition =
  { ok: true; next: FixtureStatus } | { ok: false; reason: "illegal_transition" | "guard_failed" };

/**
 * Upholds: only declared edges are legal; a fixture cannot be scheduled without
 * a kickoff and a ground. Completed and cancelled have no exits — completed
 * fixtures become immutable, permanently.
 */
export function fixtureTransition(
  from: FixtureStatus,
  event: FixtureEvent,
  readiness?: FixtureReadiness,
): FixtureTransition {
  if (!FIXTURE_EDGES[from].has(event.type)) {
    return { ok: false, reason: "illegal_transition" };
  }
  if (event.type === "schedule") {
    const ready = readiness !== undefined && readiness.hasKickoff && readiness.hasGround;
    if (!ready) {
      return { ok: false, reason: "guard_failed" };
    }
  }
  return { ok: true, next: FIXTURE_EVENT_TARGET[event.type] };
}

/** Full edits (teams, everything) are legal only before the schedule is public. */
export function canEditFixture(status: FixtureStatus): boolean {
  return status === "draft" || status === "scheduled";
}

/**
 * Moving kickoff/ground on a PUBLISHED fixture must go through the reschedule
 * workflow (audited, conflict-checked) — never a silent edit (invariant).
 */
export function canRescheduleFixture(status: FixtureStatus): boolean {
  return status === "scheduled" || status === "published";
}

// --- Deterministic fixture number (CTO addition 3) -----------------------------
// MPL26-F001: competition code + zero-padded sequence. Derived once at fixture
// creation and stored — stable forever, human-searchable, never a database id.

/**
 * Deterministic competition code: initials of the name's words (max 4), plus the
 * two-digit start year when known. "Malad Premier League" + 2026 → "MPL26".
 */
export function competitionCode(name: string, startsOn: string | null): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w !== "");
  const first = words[0] ?? "";
  const initials =
    words.length >= 2
      ? words
          .slice(0, 4)
          .map((w) => w.charAt(0))
          .join("")
      : first.slice(0, 3);
  const base = initials === "" ? "CUP" : initials;
  const year = startsOn?.match(/^\d{4}/)?.[0]?.slice(2) ?? "";
  return `${base}${year}`;
}

export function fixtureNumber(code: string, seq: number): string {
  return `${code}-F${String(seq).padStart(3, "0")}`;
}

// --- Wall-clock helpers (shared by generator + conflict engine) ----------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const KICKOFF_RE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidKickoff(kickoff: string): boolean {
  if (!KICKOFF_RE.test(kickoff)) {
    return false;
  }
  // Reject impossible calendar dates (2026-02-31) that pass the shape check.
  return kickoffToMinutes(kickoff) !== null;
}

/**
 * Wall-clock minutes on a fixed axis (UTC arithmetic on the wall time — no
 * server-timezone dependence). Null when malformed or an impossible date.
 */
export function kickoffToMinutes(kickoff: string): number | null {
  if (!KICKOFF_RE.test(kickoff)) {
    return null;
  }
  const [datePart, timePart] = kickoff.split("T") as [string, string];
  const [y, m, d] = datePart.split("-").map(Number) as [number, number, number];
  const [hh, mm] = timePart.split(":").map(Number) as [number, number];
  const ms = Date.UTC(y, m - 1, d, hh, mm);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return ms / 60_000;
}

/** Deterministic date arithmetic on YYYY-MM-DD strings (UTC — no DST drift). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

// --- Deterministic round-robin generator (pure, CTO scheduling engine) ---------

export interface RoundRobinPairing {
  round: number; // 1-based
  match: number; // 1-based within the round
  homeTeamId: string;
  awayTeamId: string;
}

/**
 * Circle-method round robin over the teams IN THE GIVEN ORDER (the caller fixes
 * the order; identical inputs → identical pairings). Odd team counts get a bye.
 * Each pair meets exactly once per leg; `rounds: 2` replays every pairing with
 * home/away swapped. No randomness anywhere.
 *
 * HOME ADVANTAGE. The seat rule below balances home and away as evenly as the
 * parity of the fixture count allows — max imbalance 1, for every team, at every
 * size (asserted for N = 2..16 in the tests). Two facts make it work:
 *
 *   - a rotating team occupies every seat 1..n-1 exactly once across a leg, so
 *     "the earlier seat is home" hands it half-1 homes and half-1 aways, plus
 *     the one round it spends in seat n-1 facing the fixed seat;
 *   - that last fixture is the only free choice left, so it alternates on round
 *     parity — which also splits the FIXED seat's own leg evenly.
 *
 * The previous rule keyed home on `(r + i)` parity. In the circle method a
 * rotating team's seat advances in lockstep with the round, so `r + i` held
 * constant parity for that team and the alternation never fired: one team took
 * every one of its fixtures away (0 home in 15, at 16 teams). Double round
 * robin hid it because leg 2 mirrors leg 1 and the two legs cancel — which is
 * exactly why leg 2 is still a pure mirror here.
 */
export function roundRobinPairings(teamIds: readonly string[], rounds: 1 | 2): RoundRobinPairing[] {
  const circle: (string | null)[] = [...teamIds];
  if (circle.length % 2 === 1) {
    circle.push(null); // bye
  }
  const n = circle.length;
  const perLeg = n - 1;
  const half = n / 2;
  const pairings: RoundRobinPairing[] = [];
  for (let leg = 0; leg < rounds; leg++) {
    const arr = [...circle];
    for (let r = 0; r < perLeg; r++) {
      const round = leg * perLeg + r + 1;
      let match = 1;
      for (let i = 0; i < half; i++) {
        const a = arr[i] ?? null;
        const b = arr[n - 1 - i] ?? null;
        if (a === null || b === null) {
          continue; // bye
        }
        // The earlier seat hosts; the fixed seat's own fixture alternates on
        // round parity. Leg 2 mirrors leg 1, so a double robin stays perfect.
        const seatHosts = i === 0 ? r % 2 === 0 : true;
        const homeFirst = leg === 0 ? seatHosts : !seatHosts;
        pairings.push({
          round,
          match,
          homeTeamId: homeFirst ? a : b,
          awayTeamId: homeFirst ? b : a,
        });
        match++;
      }
      // Rotate: keep arr[0] fixed, move the last element to position 1.
      const last = arr[n - 1] ?? null;
      arr.splice(n - 1, 1);
      arr.splice(1, 0, last);
    }
  }
  return pairings;
}

export interface GeneratePlanInput {
  teamIds: readonly string[]; // caller-ordered (e.g. by team name) for determinism
  rounds: 1 | 2;
  startDate: string; // YYYY-MM-DD
  kickoffTimes: readonly string[]; // HH:MM, in the order slots fill each day
  groundIds: readonly string[]; // rotation order; ≥ 1
  durationMinutes: number;
}

export interface PlannedFixture {
  round: number;
  match: number;
  homeTeamId: string;
  awayTeamId: string;
  groundId: string;
  kickoffAt: string; // YYYY-MM-DDTHH:MM
  durationMinutes: number;
}

export type GeneratePlanResult =
  | { ok: true; fixtures: PlannedFixture[] }
  | {
      ok: false;
      reason:
        | "too_few_teams"
        | "duplicate_team"
        | "no_grounds"
        | "invalid_start_date"
        | "invalid_kickoff_times"
        | "invalid_duration";
    };

/**
 * The deterministic slot assigner. Rounds fill consecutive days in order; within
 * a day, slots iterate kickoff times × grounds. A round never shares a day with
 * another round, and a team appears at most once per round — so the generated
 * schedule is conflict-free BY CONSTRUCTION (team- and ground-wise) before the
 * conflict engine ever sees it. Pure: same input, same fixtures, forever.
 */
export function planRoundRobin(input: GeneratePlanInput): GeneratePlanResult {
  if (input.teamIds.length < 2) {
    return { ok: false, reason: "too_few_teams" };
  }
  if (new Set(input.teamIds).size !== input.teamIds.length) {
    return { ok: false, reason: "duplicate_team" };
  }
  if (input.groundIds.length === 0) {
    return { ok: false, reason: "no_grounds" };
  }
  if (!DATE_RE.test(input.startDate) || kickoffToMinutes(`${input.startDate}T00:00`) === null) {
    return { ok: false, reason: "invalid_start_date" };
  }
  if (input.kickoffTimes.length === 0 || input.kickoffTimes.some((t) => !TIME_RE.test(t))) {
    return { ok: false, reason: "invalid_kickoff_times" };
  }
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    input.durationMinutes > 1440
  ) {
    return { ok: false, reason: "invalid_duration" };
  }

  const pairings = roundRobinPairings(input.teamIds, input.rounds);
  const slotsPerDay = input.kickoffTimes.length * input.groundIds.length;
  const fixtures: PlannedFixture[] = [];
  let dayOffset = 0;
  let currentRound = 0;
  let slotInDay = 0;
  for (const pairing of pairings) {
    if (pairing.round !== currentRound) {
      // A new round always starts on a fresh day (structural conflict safety).
      if (currentRound !== 0) {
        dayOffset += 1;
      }
      currentRound = pairing.round;
      slotInDay = 0;
    }
    if (slotInDay >= slotsPerDay) {
      dayOffset += 1;
      slotInDay = 0;
    }
    const timeIndex = Math.floor(slotInDay / input.groundIds.length);
    const groundIndex = slotInDay % input.groundIds.length;
    fixtures.push({
      round: pairing.round,
      match: pairing.match,
      homeTeamId: pairing.homeTeamId,
      awayTeamId: pairing.awayTeamId,
      groundId: input.groundIds[groundIndex] as string,
      kickoffAt: `${addDays(input.startDate, dayOffset)}T${input.kickoffTimes[timeIndex] as string}`,
      durationMinutes: input.durationMinutes,
    });
    slotInDay++;
  }
  return { ok: true, fixtures };
}

// --- The reusable conflict engine (CTO addition 4) ------------------------------
// Structural, deterministic, no heuristics. Future Auction scheduling and Match
// Operations consume THIS engine — scheduling logic exists nowhere else.

/**
 * There is deliberately no "venue overlap" here. Two grounds at one venue
 * hosting simultaneous matches is the entire reason a venue has two grounds —
 * flagging it made the generator's own output (from the grounds the UI offered)
 * arrive pre-loaded with 120 conflicts at 240 fixtures, and taught organizers to
 * ignore the panel. The same ground twice over is `ground_double_booking`, which
 * is a real, blocking invariant.
 */
export type ConflictType =
  | "team_double_booking"
  | "ground_double_booking"
  | "invalid_duration"
  | "invalid_kickoff"
  | "duplicate_fixture"
  | "outside_competition_dates";

/**
 * blocking = violates a permanent invariant (simultaneous team/ground, dates
 * outside the competition, malformed schedule data) — the aggregate refuses it.
 * warning = structurally suspicious (a same-day rematch) — surfaced to the
 * organizer, who decides.
 */
export type ConflictSeverity = "blocking" | "warning";

export const CONFLICT_SEVERITY: Record<ConflictType, ConflictSeverity> = {
  team_double_booking: "blocking",
  ground_double_booking: "blocking",
  invalid_duration: "blocking",
  invalid_kickoff: "blocking",
  duplicate_fixture: "warning",
  outside_competition_dates: "blocking",
};

export interface FixtureForConflicts {
  id: string;
  /** Null on a LOBBY (0058) — a battle royale match has no home and no away. */
  homeTeamId: string | null;
  awayTeamId: string | null;
  groundId: string | null;
  kickoffAt: string | null; // YYYY-MM-DDTHH:MM wall clock
  durationMinutes: number | null;
  status: FixtureStatus;
}

export interface Conflict {
  type: ConflictType;
  severity: ConflictSeverity;
  fixtureIds: string[]; // sorted — deterministic identity for a conflict
  detail: string;
}

export interface CompetitionWindow {
  startsOn: string | null; // YYYY-MM-DD
  endsOn: string | null;
}

interface Interval {
  start: number;
  end: number;
}

function intervalOf(fixture: FixtureForConflicts): Interval | null {
  if (fixture.kickoffAt === null || fixture.durationMinutes === null) {
    return null;
  }
  const start = kickoffToMinutes(fixture.kickoffAt);
  if (start === null || fixture.durationMinutes <= 0) {
    return null;
  }
  return { start, end: start + fixture.durationMinutes };
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * A LOBBY SHARES NO TEAM WITH ANYTHING HERE.
 *
 * Both its team columns are null, and `null === null` is true — so without this
 * guard every pair of lobbies scheduled at the same time would be reported as a
 * team double-booking, on a fixture that names no team at all. The nulls are an
 * absence, not a shared identity.
 *
 * A lobby's squads live in `fixture_participants` and this function cannot see
 * them, so two overlapping lobbies drawing on the same squads are NOT caught
 * here. They are still caught as a ground clash when they share a ground, which
 * is how a venue-bound event actually collides.
 */
function sharesTeam(a: FixtureForConflicts, b: FixtureForConflicts): boolean {
  if (a.homeTeamId === null || b.homeTeamId === null) {
    return false;
  }
  return (
    a.homeTeamId === b.homeTeamId ||
    a.homeTeamId === b.awayTeamId ||
    a.awayTeamId === b.homeTeamId ||
    a.awayTeamId === b.awayTeamId
  );
}

/**
 * The two teams that make a fixture a repeat of another.
 *
 * A LOBBY IS NEVER A DUPLICATE. Its columns are both null, so every lobby would
 * key to the same "~" and a season's second match would be flagged as a repeat
 * of its first. Keyed on the fixture's own id instead, which no other fixture
 * can equal — a lobby is a duplicate of nothing.
 */
function pairKey(a: FixtureForConflicts): string {
  if (a.homeTeamId === null || a.awayTeamId === null) {
    return `lobby~${a.id}`;
  }
  return [a.homeTeamId, a.awayTeamId].sort().join("~");
}

function conflict(type: ConflictType, ids: string[], detail: string): Conflict {
  return { type, severity: CONFLICT_SEVERITY[type], fixtureIds: [...ids].sort(), detail };
}

const CONFLICT_ORDER: readonly ConflictType[] = [
  "team_double_booking",
  "ground_double_booking",
  "duplicate_fixture",
  "invalid_kickoff",
  "invalid_duration",
  "outside_competition_dates",
];

/**
 * Detect every structural conflict in a fixture set. Cancelled fixtures never
 * conflict (they hold no slot). Deterministic: same input set (any order) →
 * same conflict list, sorted by (type, fixture ids). No heuristics, no time
 * reads — pure interval and identity arithmetic.
 */
export function detectConflicts(
  fixtures: readonly FixtureForConflicts[],
  window?: CompetitionWindow,
): Conflict[] {
  const conflicts: Conflict[] = [];
  const active = fixtures
    .filter((f) => f.status !== "cancelled")
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const fixture of active) {
    // Per-fixture shape checks.
    if (fixture.kickoffAt !== null && !isValidKickoff(fixture.kickoffAt)) {
      conflicts.push(
        conflict("invalid_kickoff", [fixture.id], `unparseable kickoff "${fixture.kickoffAt}"`),
      );
    }
    if (fixture.kickoffAt === null && fixture.status !== "draft") {
      conflicts.push(
        conflict("invalid_kickoff", [fixture.id], "a scheduled fixture needs a kickoff"),
      );
    }
    if (
      fixture.durationMinutes !== null &&
      (!Number.isInteger(fixture.durationMinutes) ||
        fixture.durationMinutes <= 0 ||
        fixture.durationMinutes > 1440)
    ) {
      conflicts.push(
        conflict(
          "invalid_duration",
          [fixture.id],
          `duration ${String(fixture.durationMinutes)} minutes is outside 1–1440`,
        ),
      );
    }
    if (fixture.kickoffAt !== null && isValidKickoff(fixture.kickoffAt) && window !== undefined) {
      const date = fixture.kickoffAt.slice(0, 10);
      if (
        (window.startsOn !== null && date < window.startsOn) ||
        (window.endsOn !== null && date > window.endsOn)
      ) {
        conflicts.push(
          conflict(
            "outside_competition_dates",
            [fixture.id],
            `${date} is outside the competition window`,
          ),
        );
      }
    }
  }

  // Pairwise checks (ids ascending → deterministic emission). Intervals, pair
  // keys and dates are computed ONCE per fixture, not per pair — kickoff parsing
  // inside the O(n²) loop dominated at 500+ fixtures (measured, M-IP3-4).
  const intervals = active.map(intervalOf);
  const pairKeys = active.map(pairKey);
  const dates = active.map((f) => f.kickoffAt?.slice(0, 10) ?? null);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i] as FixtureForConflicts;
      const b = active[j] as FixtureForConflicts;
      const ia = intervals[i] ?? null;
      const ib = intervals[j] ?? null;
      const overlap = ia !== null && ib !== null && overlaps(ia, ib);
      if (overlap && sharesTeam(a, b)) {
        conflicts.push(
          conflict("team_double_booking", [a.id, b.id], "a team is booked twice at once"),
        );
      }
      if (overlap && a.groundId !== null && a.groundId === b.groundId) {
        conflicts.push(
          conflict("ground_double_booking", [a.id, b.id], "the ground hosts two fixtures at once"),
        );
      }
      if (dates[i] !== null && dates[i] === dates[j] && pairKeys[i] === pairKeys[j]) {
        conflicts.push(
          conflict("duplicate_fixture", [a.id, b.id], "the same teams meet twice on one day"),
        );
      }
    }
  }

  return conflicts.sort((x, y) => {
    const order = CONFLICT_ORDER.indexOf(x.type) - CONFLICT_ORDER.indexOf(y.type);
    if (order !== 0) {
      return order;
    }
    const xa = x.fixtureIds.join("~");
    const ya = y.fixtureIds.join("~");
    return xa < ya ? -1 : xa > ya ? 1 : 0;
  });
}

/** The conflicts a candidate mutation is involved in (the aggregate's refusal set). */
export function conflictsInvolving(
  conflicts: readonly Conflict[],
  fixtureIds: readonly string[],
): Conflict[] {
  const ids = new Set(fixtureIds);
  return conflicts.filter((c) => c.fixtureIds.some((id) => ids.has(id)));
}

export function blockingConflicts(conflicts: readonly Conflict[]): Conflict[] {
  return conflicts.filter((c) => c.severity === "blocking");
}

// --- Venue / ground vocabulary --------------------------------------------------

export type GroundSurface = "turf" | "matting" | "astroturf" | "concrete" | "other";

export const GROUND_SURFACES: readonly GroundSurface[] = [
  "turf",
  "matting",
  "astroturf",
  "concrete",
  "other",
];

export function isGroundSurface(value: string): value is GroundSurface {
  return (GROUND_SURFACES as readonly string[]).includes(value);
}

export type GroundStatus = "active" | "unavailable";

export const GROUND_STATUSES: readonly GroundStatus[] = ["active", "unavailable"];

export function isGroundStatus(value: string): value is GroundStatus {
  return (GROUND_STATUSES as readonly string[]).includes(value);
}
