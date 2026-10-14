"use server";

import {
  auctionOf,
  createPracticeAuction,
  practiceOf,
  type AuctionRecord,
} from "@desiauction/auction";
import {
  isPracticeSquadSize,
  practiceAuctionConfig,
  practiceLotCount,
  commandRefusalMessage,
  isTransportCommandId,
  type CommandAck,
  type AuctionStatus,
  type PracticeSquadSize,
} from "@desiauction/core";
import {
  auctionOwnerInvites,
  auctions,
  lots,
  paddleGrants,
  paddles,
  people,
  registrations,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { commandOutcome } from "../../app/seasons/[slug]/auction/command-state";
import type { PracticeIntentResult } from "../../lib/practice-intent";
import { currentSession } from "../auth/actions";
import { canCompetition } from "../competition/authz";
import { type CompetitionSummary } from "../competition/competitions";
import { resolveMemberCompetition } from "../competition/resolve";
import { dbHandle } from "../db";
import { endPractice, endPracticeCommand } from "./practice-engine";

/*
 * THE PRACTICE AUCTION, FROM THE ORGANISER'S SIDE (0101).
 *
 * One card on the auction page: pick 2 or 3 players per team, Start, watch the
 * owners arrive, run it from the usual cockpit, Run again or End. Everything
 * here is the season's manager's — the same people who set the room up — and
 * the practice itself is made and ended through the same aggregate and engine
 * as the night.
 */

/** Where one team stands in the practice, in the organiser's words. */
export type PracticeTeamState =
  /** Their owner is in the room with the paddle in hand. */
  | "ready"
  /** They have an owner who has not picked up the practice paddle yet. */
  | "waiting"
  /** Nobody owns this team yet, so the organiser bids for it. */
  | "organiser";

export interface PracticeTeam {
  id: string;
  name: string;
  ownerName: string | null;
  state: PracticeTeamState;
}

export interface PracticeCard {
  personId: string;
  realAuctionId: string | null;
  /** Null when the season has no auction set up yet. */
  realStatus: AuctionStatus | null;
  teamCount: number;
  /** Players a practice can draw from (approved first, then submitted). */
  playerCount: number;
  /** Why Start is not offered right now, in a sentence — null when it is. */
  blocked: string | null;
  practice: {
    id: string;
    status: AuctionStatus;
    perTeam: PracticeSquadSize;
    lotCount: number;
    teams: PracticeTeam[];
  } | null;
}

export type PracticeActionResult = { ok: true; practiceId?: string } | { ok: false; error: string };

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

/**
 * The season's manager, in their club's tenant, or null. `orConduct` also
 * admits the appointed auctioneer — for ENDING a practice only, which runs in
 * their cockpit and costs nothing; starting one stays with the season's
 * managers, who own the room it borrows.
 */
async function manageGate(
  slug: string,
  orConduct = false,
): Promise<{ personId: string; competition: CompetitionSummary } | null> {
  const session = await requireSession();
  const competition = await resolveMemberCompetition(session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const allowed = await inOrg(
    session.personId,
    competition,
    async (db) =>
      (await canCompetition(db, session.personId, scope, "competition.manage")) ||
      (orConduct && (await canCompetition(db, session.personId, scope, "auction.conduct"))),
  );
  return allowed ? { personId: session.personId, competition } : null;
}

function inOrg<T>(
  personId: string,
  competition: { orgId: string },
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return withTenantDb(dbHandle, { personId, orgId: competition.orgId }, fn);
}

/** Who owns which team on the real auction: accepted links and grants. */
async function realOwners(db: Db, real: AuctionRecord): Promise<Map<string, string[]>> {
  const [accepted, granted] = await Promise.all([
    db
      .select({ teamId: auctionOwnerInvites.teamId, personId: auctionOwnerInvites.acceptedBy })
      .from(auctionOwnerInvites)
      .where(
        and(
          eq(auctionOwnerInvites.auctionId, real.id),
          isNotNull(auctionOwnerInvites.acceptedBy),
          isNull(auctionOwnerInvites.revokedAt),
        ),
      ),
    db
      .select({ teamId: paddleGrants.teamId, personId: paddleGrants.personId })
      .from(paddleGrants)
      .where(and(eq(paddleGrants.auctionId, real.id), isNull(paddleGrants.revokedAt))),
  ]);
  const owners = new Map<string, string[]>();
  for (const row of [...accepted, ...granted]) {
    if (row.personId === null) {
      continue;
    }
    const list = owners.get(row.teamId) ?? [];
    if (!list.includes(row.personId)) {
      list.push(row.personId);
    }
    owners.set(row.teamId, list);
  }
  return owners;
}

async function practiceTeams(
  db: Db,
  competitionId: string,
  real: AuctionRecord,
  practice: AuctionRecord,
): Promise<PracticeTeam[]> {
  const [teamRows, owners, held] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.competitionId, competitionId))
      .orderBy(asc(teams.name)),
    realOwners(db, real),
    db
      .select({ teamId: paddles.teamId, personId: paddles.personId })
      .from(paddles)
      .where(and(eq(paddles.auctionId, practice.id), isNull(paddles.releasedAt))),
  ]);
  const ownerIds = [...new Set([...owners.values()].flat())];
  const names =
    ownerIds.length === 0
      ? []
      : await db
          .select({ id: people.id, name: people.name })
          .from(people)
          .where(inArray(people.id, ownerIds));
  const nameOf = new Map(names.map((row) => [row.id, row.name]));
  const holderOf = new Map(held.map((row) => [row.teamId, row.personId]));
  return teamRows.map((team) => {
    const teamOwners = owners.get(team.id) ?? [];
    const holder = holderOf.get(team.id);
    const ownerName =
      teamOwners.map((id) => nameOf.get(id) ?? null).find((name) => name !== null) ?? null;
    let state: PracticeTeamState;
    if (teamOwners.length === 0) {
      state = "organiser";
    } else if (holder !== undefined && teamOwners.includes(holder)) {
      state = "ready";
    } else {
      state = "waiting";
    }
    return { id: team.id, name: team.name, ownerName, state };
  });
}

/** The practice card on the auction page — the season's managers only. */
export async function practiceCardView(slug: string): Promise<PracticeCard | null> {
  const gate = await manageGate(slug);
  if (gate === null) {
    return null;
  }
  const { competition } = gate;
  return inOrg(gate.personId, competition, async (db) => {
    const [real, teamCountRow, playerCountRow] = await Promise.all([
      auctionOf(db, competition.id),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(teams)
        .where(eq(teams.competitionId, competition.id)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(registrations)
        .where(
          and(
            eq(registrations.competitionId, competition.id),
            inArray(registrations.status, ["approved", "submitted"]),
          ),
        ),
    ]);
    const teamCount = teamCountRow[0]?.count ?? 0;
    const playerCount = playerCountRow[0]?.count ?? 0;
    const practice =
      real !== null && real.status === "scheduled" ? await practiceOf(db, competition.id) : null;
    const blocked =
      real === null
        ? "Set up your auction first — the practice uses its teams and owners."
        : real.status !== "scheduled"
          ? "The real auction has started, so the practice is over."
          : teamCount < 2
            ? "Add at least two teams first."
            : playerCount === 0
              ? "Add some players first — the practice sells a few of them, for pretend."
              : null;
    return {
      personId: gate.personId,
      realAuctionId: real?.id ?? null,
      realStatus: real?.status ?? null,
      teamCount,
      playerCount,
      blocked,
      practice:
        practice === null || real === null
          ? null
          : {
              id: practice.id,
              status: practice.status,
              perTeam: practice.config.squadMax === 3 ? 3 : 2,
              lotCount: await db
                .select({ count: sql<number>`count(*)::int` })
                .from(lots)
                .where(eq(lots.auctionId, practice.id))
                .then((rows) => rows[0]?.count ?? 0),
              teams: await practiceTeams(db, competition.id, real, practice),
            },
    };
  });
}

/**
 * Practices one season may start in a day. Each is a few dozen rows that are
 * kept (the log is append-only), so a stuck button or a script pressing Run
 * again must not be able to grow a season without end. Twenty is far beyond
 * any real rehearsal.
 */
const PRACTICES_PER_DAY = 20;

/** Make a practice: every team, its owners, and teams × perTeam + 2 players. */
async function startPractice(
  personId: string,
  competition: CompetitionSummary,
  perTeam: PracticeSquadSize,
  expectedRealId?: string,
): Promise<PracticeActionResult> {
  return inOrg(personId, competition, async (db) => {
    const real = await auctionOf(db, competition.id);
    if (real === null || (expectedRealId !== undefined && real.id !== expectedRealId)) {
      return { ok: false, error: "The auction room changed. Review the current practice." };
    }
    const [today] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auctions)
      .where(
        and(
          eq(auctions.competitionId, competition.id),
          eq(auctions.kind, "practice"),
          sql`${auctions.createdAt} > now() - interval '1 day'`,
        ),
      );
    if ((today?.count ?? 0) >= PRACTICES_PER_DAY) {
      return {
        ok: false,
        error: `That's ${String(PRACTICES_PER_DAY)} practices today — the daily limit. You can start another tomorrow.`,
      };
    }
    const [teamCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(teams)
      .where(eq(teams.competitionId, competition.id));
    const lotCount = practiceLotCount(teamCountRow?.count ?? 0, perTeam);
    const created = await createPracticeAuction(
      db,
      real,
      personId,
      practiceAuctionConfig(real.config, perTeam),
      lotCount,
    );
    return created.ok
      ? { ok: true, practiceId: created.auctionId }
      : { ok: false, error: commandRefusalMessage(created.reason) };
  });
}

export async function startPracticeAction(
  slug: string,
  perTeam: number,
): Promise<PracticeActionResult> {
  const gate = await manageGate(slug);
  if (gate === null) {
    return { ok: false, error: "Only the season's organisers can run a practice." };
  }
  if (!isPracticeSquadSize(perTeam)) {
    return { ok: false, error: "Pick 2 or 3 players per team." };
  }
  return startPractice(gate.personId, gate.competition, perTeam);
}

/** End the running practice. Everyone in it moves to the real auction's room. */
export async function endPracticeAction(slug: string): Promise<PracticeActionResult> {
  const gate = await manageGate(slug, true);
  if (gate === null) {
    return { ok: false, error: "Only the season's organisers can end a practice." };
  }
  const practice = await inOrg(gate.personId, gate.competition, (db) =>
    practiceOf(db, gate.competition.id),
  );
  if (practice === null) {
    return { ok: true };
  }
  return (await endPractice(practice.id, gate.personId))
    ? { ok: true }
    : { ok: false, error: "Couldn't reach the auction service. Try again in a moment." };
}

/** Pinned-room variant; never let an old cockpit end a newer practice. */
export async function endPracticeCommandAction(
  slug: string,
  practiceId: string,
  commandId: string,
): Promise<CommandAck> {
  const refuse = (reason: string): CommandAck => ({
    commandId,
    accepted: false,
    reason,
    version: 0,
  });
  if (!isTransportCommandId(commandId)) return refuse("invalid_command_id");
  const gate = await manageGate(slug, true);
  if (gate === null) return refuse("not_authorized");
  const practice = await inOrg(gate.personId, gate.competition, (db) =>
    practiceOf(db, gate.competition.id),
  );
  if (practice?.id !== practiceId) return refuse("room_changed");
  return endPracticeCommand(practice.id, gate.personId, commandId);
}

/**
 * Start over: end this practice and make a fresh one with the same size —
 * full purses, the same sample players, and every owner who has joined since.
 */
export async function runPracticeAgainAction(slug: string): Promise<PracticeActionResult> {
  const gate = await manageGate(slug);
  if (gate === null) {
    return { ok: false, error: "Only the season's organisers can run a practice." };
  }
  const practice = await inOrg(gate.personId, gate.competition, (db) =>
    practiceOf(db, gate.competition.id),
  );
  const perTeam: PracticeSquadSize = practice?.config.squadMax === 3 ? 3 : 2;
  if (practice !== null && !(await endPractice(practice.id, gate.personId))) {
    return { ok: false, error: "Couldn't reach the auction service. Try again in a moment." };
  }
  return startPractice(gate.personId, gate.competition, perTeam);
}

/** Identity-bound lifecycle; intent IDs correlate replies, not durable server deduplication. */
export async function practiceIntentAction(
  slug: string,
  kind: "start" | "again" | "end",
  realAuctionId: string,
  expectedPracticeId: string | null,
  perTeam: number,
  intentId: string,
): Promise<PracticeIntentResult> {
  const result = (
    state: PracticeIntentResult["kind"],
    stage: PracticeIntentResult["stage"],
    message: string,
    ended = false,
    practiceId?: string,
  ): PracticeIntentResult => ({
    intentId,
    kind: state,
    stage,
    message,
    ended,
    ...(practiceId ? { practiceId } : {}),
  });
  if (
    !isTransportCommandId(intentId) ||
    !isTransportCommandId(realAuctionId) ||
    (expectedPracticeId !== null && !isTransportCommandId(expectedPracticeId)) ||
    !["start", "again", "end"].includes(kind) ||
    !isPracticeSquadSize(perTeam)
  )
    return result("refused", "before-write", "The practice request is invalid.");
  const gate = await manageGate(slug, kind === "end");
  if (gate === null)
    return result(
      "refused",
      "before-write",
      "You no longer have permission for this practice action.",
    );
  const current = await inOrg(gate.personId, gate.competition, async (db) => ({
    real: await auctionOf(db, gate.competition.id),
    practice: await practiceOf(db, gate.competition.id),
  }));
  if (current.real?.id !== realAuctionId || current.real.status !== "scheduled")
    return result(
      "refused",
      "before-write",
      "The real auction changed or started. Review the current room.",
    );
  if (
    kind === "start"
      ? current.practice !== null || expectedPracticeId !== null
      : expectedPracticeId === null || current.practice?.id !== expectedPracticeId
  )
    return result(
      "refused",
      "before-write",
      "The practice changed. This action has not been sent.",
    );
  if (kind === "again" && perTeam !== (current.practice?.config.squadMax === 3 ? 3 : 2))
    return result(
      "refused",
      "before-write",
      "The practice size changed. Review the current practice.",
    );
  let ended = false;
  if (kind !== "start" && expectedPracticeId !== null) {
    let outcome;
    try {
      outcome = commandOutcome(
        await endPracticeCommand(expectedPracticeId, gate.personId, intentId),
        intentId,
      );
    } catch {
      return result(
        "unknown",
        "end",
        "Practice end is unconfirmed; no new practice was attempted.",
      );
    }
    if (outcome.kind !== "accepted") {
      // An illegal-transition response is not an acceptance. Read this exact old
      // identity; never treat a different active practice as proof of this action.
      if (outcome.kind === "refused" && outcome.ack.reason === "illegal_transition") {
        const [old] = await inOrg(gate.personId, gate.competition, (db) =>
          db
            .select({ status: auctions.status })
            .from(auctions)
            .where(
              and(
                eq(auctions.id, expectedPracticeId),
                eq(auctions.competitionId, gate.competition.id),
                eq(auctions.kind, "practice"),
              ),
            ),
        );
        ended = old?.status === "abandoned";
      }
      if (!ended)
        return result(
          outcome.kind === "refused" ? "refused" : "unknown",
          "end",
          outcome.kind === "refused" ? commandRefusalMessage(outcome.ack.reason) : outcome.message,
        );
    } else ended = true;
    if (kind === "end")
      return result("accepted", "complete", "The selected practice is ended.", true);
  }
  try {
    // The creation helper revalidates the exact real identity. The canonical
    // writer locks its scheduled status and active-practice uniqueness.
    const created = await startPractice(gate.personId, gate.competition, perTeam, realAuctionId);
    if (!created.ok)
      return result(
        "refused",
        "create",
        `${ended ? "The selected practice ended. " : ""}${created.error}`,
        ended,
      );
    if (!created.practiceId)
      return result("unknown", "create", "Practice creation could not be verified.", ended);
    return result("accepted", "complete", "A new practice is ready.", ended, created.practiceId);
  } catch {
    return result(
      "unknown",
      "create",
      `${ended ? "The selected practice ended. " : ""}New practice creation is unconfirmed. Review before starting another.`,
      ended,
    );
  }
}

/** Minimal current state for End-capable conductors without manager-card disclosure. */
export async function practiceLifecycleContext(slug: string, realAuctionId: string) {
  const gate = await manageGate(slug, true);
  if (!gate) return null;
  return inOrg(gate.personId, gate.competition, async (db) => {
    const real = await auctionOf(db, gate.competition.id);
    if (real?.id !== realAuctionId) return null;
    const practice = await practiceOf(db, gate.competition.id);
    return {
      personId: gate.personId,
      realAuctionId: real.id,
      realStatus: real.status,
      practiceId: practice?.id ?? null,
      practiceStatus: practice?.status ?? null,
    };
  });
}
