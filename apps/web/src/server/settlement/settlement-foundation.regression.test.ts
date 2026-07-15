// PERMANENT SETTLEMENT FOUNDATION REGRESSION SUITE (IP-5, M-IP5-1).
//
// Encodes the frozen contract of the Foundation against LIVE Postgres: intake
// pinned from the FROZEN auction log, deterministic replay, disposable
// projections, checkpoint equivalence, double-entry that always balances,
// wallets that equal the journal fold, idempotent commands, append-only history,
// fail-closed corruption detection, recovery that reproduces identical bytes,
// the capability partition, and RLS read+write proofs on the six new tables.
//
// The auction it settles is a REAL auction, conducted through the FROZEN IP-4
// aggregate — not a fixture. If settlement could not consume the real thing, this
// suite would not go green.
//
// The `it` blocks run in order and share one case: the money story is a night,
// not a set of disconnected assertions.
import {
  DEFAULT_AUCTION_CONFIG,
  canonicalJson,
  hasCapability,
  registrationNumber,
  replayAuction,
} from "@desiauction/core";
import {
  auctionOf,
  auctionView,
  createAuction,
  issuePaddle,
  loadEvents,
  placeBid,
  queueAllLots,
  transitionAuction,
  transitionLot,
  type AuctionRecord,
} from "@desiauction/auction";
import {
  auditLog,
  createDb,
  grants as grantsTable,
  journalCheckpoints,
  journalLegs,
  journalPostings,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  registrations as registrationsTable,
  sessions,
  settlementCases,
  settlementEvents,
  settlementObligations,
  type DbHandle,
} from "@desiauction/db";
import {
  canonicalJournalBytes,
  caseControlAccount,
  duesAccount,
  hasSettlementCapability,
  outstandingOf,
  replayCase,
  replayJournal,
  statementOf,
  trialBalance,
  waivedAccount,
  walletOf,
  wallets,
  type SettlementCapability,
} from "@desiauction/settlement";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { auctionReady } from "../auction/auction-ready";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import {
  advanceCompetition,
  createCompetition,
  createTeam,
  resolveCompetition,
  type CompetitionSummary,
} from "../competition/competitions";
import { grantsFor } from "../orgs/authz";
import { createOrg } from "../orgs/orgs";
import {
  canSettlement,
  issueSettlementGrant,
  revokeSettlementGrant,
  settlementActor,
} from "./authz";
import { settlementDeps, type SettlementDeps } from "./deps";
import { recoverCase, recoverJournal, verifyJournal } from "./recovery";
import {
  caseFold,
  closeCase,
  computeCaseObligations,
  journalFold,
  loadJournal,
  openCase,
  reopenCase,
  runCoordination,
  settleCase,
  verifyCase,
  voidCase,
  waiveObligation,
  type SettlementActor,
} from "./writer";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9198${RUN}1`;
const PHONE_OFFICER = `+9197${RUN}2`;
const PHONE_OUTSIDER = `+9196${RUN}3`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OFFICER, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91944${RUN}`;
/** Small on purpose: the checkpoint chain is exercised for real, not in theory. */
const CHECKPOINT_CADENCE = 2;

// Band A base = ₹50,000; band B base = ₹25,000 (DEFAULT_AUCTION_CONFIG). The
// first bid on a lot may be the base itself, so these are valid on the ladder.
const SALE_A = 5_000_000;
const SALE_B = 2_500_000;
const TIGERS_DUE = SALE_A * 2; // two band-A players
const LIONS_DUE = SALE_B; // one band-B player

let owner = "";
let officer = "";
let outsider = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const paddleIds: string[] = [];

let deps: SettlementDeps;
let actor: SettlementActor;
let ownerActor: SettlementActor;
let caseId = "";

const tigers = (): string => teamIds[0] ?? "";
const lions = (): string => teamIds[1] ?? "";

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select({ code: otpInbox.code })
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(otpInbox.createdAt);
  const result = await verifyOtp(db, phone, row?.code ?? "");
  if (!result.ok) {
    throw new Error("login failed");
  }
  return result.personId;
}

/** Seed one APPROVED registration (the pool path is IP-3 regression-covered). */
async function seedApproved(name: string, suffix: string, band: string): Promise<void> {
  const personId = newId();
  await db.insert(people).values({ id: personId, phone: `${SEED_PHONE_PREFIX}${suffix}`, name });
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId: org.id,
    competitionId: comp.id,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
    basePriceBand: band,
  });
}

/** A lot resolved by its player's name (lot order derives from ULIDs — not predictable). */
async function lotByPlayer(playerName: string): Promise<{ id: string }> {
  const view = await auctionView(db, auction);
  const lot = view.lots.find((row) => row.playerName === playerName);
  if (lot === undefined) {
    throw new Error(`lot for ${playerName}`);
  }
  return { id: lot.id };
}

/** Conduct a REAL auction night through the FROZEN IP-4 aggregate. */
async function conductAuctionNight(): Promise<void> {
  const current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) {
    throw new Error("competition");
  }
  const ready = await auctionReady(db, current);
  const created = await createAuction(db, comp, ready, owner, DEFAULT_AUCTION_CONFIG);
  if (!created.ok) {
    throw new Error(`createAuction: ${created.reason}`);
  }
  const record = await auctionOf(db, comp.id);
  if (record === null) {
    throw new Error("no auction");
  }
  auction = record;

  for (const teamId of teamIds) {
    // The conductor holds paddles in M-IP4-1 conduct: person = owner.
    const issued = await issuePaddle(db, auction, owner, teamId, owner);
    if (!issued.ok) {
      throw new Error(`issuePaddle: ${issued.reason}`);
    }
    paddleIds.push(issued.paddleId);
  }
  await queueAllLots(db, auction, owner);
  const opened = await transitionAuction(db, auction, owner, "open");
  if (!opened.ok) {
    throw new Error("open");
  }
  // The in-memory record still says `scheduled`; the lot-open guard reads
  // `auction.status`, so reload it now that the night is live.
  auction = (await auctionOf(db, comp.id)) ?? auction;

  const sales = [
    { player: "Tiger One", paddle: paddleIds[0], amount: SALE_A },
    { player: "Tiger Two", paddle: paddleIds[0], amount: SALE_A },
    { player: "Lion One", paddle: paddleIds[1], amount: SALE_B },
  ];
  for (const sale of sales) {
    const lot = await lotByPlayer(sale.player);
    const open = await transitionLot(db, auction, lot.id, owner, "open");
    if (!open.ok) {
      throw new Error(`lot open: ${sale.player}`);
    }
    const bid = await placeBid(db, auction, owner, {
      lotId: lot.id,
      paddleId: sale.paddle ?? "",
      amountRaw: sale.amount,
      bidderAuthorized: true,
    });
    if (!bid.ok) {
      throw new Error(`bid ${sale.player}: ${bid.code}`);
    }
    const sold = await transitionLot(db, auction, lot.id, owner, "sell");
    if (!sold.ok) {
      throw new Error(`sell ${sale.player}`);
    }
  }
  const completed = await transitionAuction(db, auction, owner, "complete");
  if (!completed.ok) {
    throw new Error("complete");
  }
}

/**
 * THE CROSS-AGGREGATE CONSERVATION LAW of the Foundation: what a team owes in
 * the CASE is exactly what its dues wallet says in the JOURNAL. Asserted after
 * every money movement — if a future command ever moves one without the other,
 * this is the assertion that catches it.
 */
async function expectBooksAgreeWithCase(): Promise<void> {
  const fold = await caseFold(deps, caseId);
  const journal = await journalFold(deps, org.id);
  expect(fold).not.toBeNull();
  expect(journal).not.toBeNull();
  if (fold === null || journal === null) {
    return;
  }
  expect(trialBalance(journal).balanced).toBe(true);
  for (const obligation of Object.values(fold.projection.obligations)) {
    const wallet = walletOf(journal, duesAccount(caseId, obligation.teamId));
    expect(wallet?.balance).toBe(outstandingOf(obligation));
  }
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  officer = await login(PHONE_OFFICER);
  outsider = await login(PHONE_OUTSIDER);

  org = await createOrg(db, owner, `Settle ${RUN}`);

  comp = await createCompetition(db, org.id, owner, {
    name: `Season ${RUN}`,
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });

  for (const name of ["Tigers", "Lions"]) {
    const team = await createTeam(db, org.id, comp.id, owner, name);
    if (!team.ok) {
      throw new Error("team");
    }
    teamIds.push(team.team.id);
  }

  // draft → setup → registration_open → seed pool → registration_closed.
  let current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) {
    throw new Error("competition");
  }
  await advanceCompetition(db, current, owner, "setup");
  current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) {
    throw new Error("competition");
  }
  await advanceCompetition(db, current, owner, "registration_open");

  await seedApproved("Tiger One", "a01", "A");
  await seedApproved("Tiger Two", "a02", "A");
  await seedApproved("Lion One", "a03", "B");

  current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) {
    throw new Error("competition");
  }
  await advanceCompetition(db, current, owner, "registration_closed");
  comp = (await resolveCompetition(db, owner, comp.slug)) ?? comp;
  await conductAuctionNight();

  deps = settlementDeps(db, { checkpointCadence: CHECKPOINT_CADENCE });
  // Money authority is granted EXPLICITLY — org:owner is not a treasurer, which
  // the authorization suite below proves.
  const granted = await issueSettlementGrant(db, owner, org.id, officer, "settlement:controller");
  if (!granted.ok) {
    throw new Error(`grant: ${granted.reason}`);
  }
  actor = await settlementActor(db, officer, org.id);
  ownerActor = await settlementActor(db, owner, org.id);
}, 120_000);

afterAll(async () => {
  const caseRows = await db
    .select({ id: settlementCases.id })
    .from(settlementCases)
    .where(eq(settlementCases.orgId, org.id));
  const caseIds = caseRows.map((row) => row.id);
  await db.delete(journalLegs).where(eq(journalLegs.orgId, org.id));
  await db.delete(journalPostings).where(eq(journalPostings.orgId, org.id));
  await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, org.id));
  if (caseIds.length > 0) {
    await db.delete(settlementObligations).where(inArray(settlementObligations.caseId, caseIds));
  }
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, org.id));
  await db.delete(settlementCases).where(eq(settlementCases.orgId, org.id));
  await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
  await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await db.delete(sessions).where(inArray(sessions.personId, [owner, officer, outsider]));
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  await db.delete(people).where(like(people.phone, `${SEED_PHONE_PREFIX}%`));
  await handle.sql.end({ timeout: 5 });
}, 60_000);

describe("M-IP5-1 · Intake — the frozen auction becomes a statement of account", () => {
  it("opens a case on the completed auction and PINS the frozen log", async () => {
    const ack = await openCase(deps, actor, {
      commandId: newId(),
      auctionId: auction.id,
      basis: "committed",
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      return;
    }
    caseId = ack.caseId;

    const sourceEvents = await loadEvents(db, auction.id);
    const [row] = await db
      .select()
      .from(settlementCases)
      .where(eq(settlementCases.id, caseId))
      .limit(1);
    expect(row?.status).toBe("opened");
    expect(row?.basis).toBe("committed");
    expect(row?.sourceEventCount).toBe(sourceEvents.length);
    expect(row?.sourceDigest).toHaveLength(64); // sha-256 of the canonical log bytes
  });

  it("refuses a second case on the same auction, and an auction it cannot see", async () => {
    expect(
      await openCase(deps, actor, {
        commandId: newId(),
        auctionId: auction.id,
        basis: "committed",
      }),
    ).toMatchObject({ ok: false, reason: "case_exists" });

    expect(
      await openCase(deps, actor, { commandId: newId(), auctionId: newId(), basis: "committed" }),
    ).toMatchObject({ ok: false, reason: "unknown_auction" });
  });

  it("verifies the source against the pin, recording the fold digest", async () => {
    expect((await verifyCase(deps, actor, caseId, newId())).ok).toBe(true);

    const fold = await caseFold(deps, caseId);
    expect(fold?.projection.status).toBe("verified");

    // The recorded fold digest IS the digest of the FROZEN reducer's own fold —
    // settlement never re-implements auction replay, it consumes it.
    const replay = replayAuction(await loadEvents(db, auction.id));
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(fold?.projection.foldDigest).toBe(deps.digest(canonicalJson(replay.projection)));
    }
  });

  it("computes obligations from the frozen fold — what a team spent is what it owes", async () => {
    expect((await computeCaseObligations(deps, actor, caseId, newId())).ok).toBe(true);

    const rows = await db
      .select()
      .from(settlementObligations)
      .where(eq(settlementObligations.caseId, caseId));
    const byTeam = new Map(rows.map((row) => [row.teamId, row.amount]));
    expect(byTeam.get(tigers())).toBe(TIGERS_DUE); // two players at ₹50,000
    expect(byTeam.get(lions())).toBe(LIONS_DUE); // one player at ₹30,000

    const fold = await caseFold(deps, caseId);
    expect(fold?.projection.status).toBe("settling");
  });

  it("posts the dues to the org journal — ONE cause, ONE balanced posting", async () => {
    const journal = await journalFold(deps, org.id);
    if (journal === null) {
      throw new Error("journal");
    }
    const postings = Object.values(journal.postings);
    expect(postings).toHaveLength(1);
    expect(postings[0]?.template).toBe("obligation");
    expect(postings[0]?.legs).toHaveLength(3); // two dues debits + one control credit
    expect(postings[0]?.sourceStream).toBe(`case:${caseId}`); // provenance

    expect(walletOf(journal, duesAccount(caseId, tigers()))?.balance).toBe(TIGERS_DUE);
    expect(walletOf(journal, duesAccount(caseId, lions()))?.balance).toBe(LIONS_DUE);
    expect(walletOf(journal, caseControlAccount(caseId))?.balance).toBe(TIGERS_DUE + LIONS_DUE);
    await expectBooksAgreeWithCase();
  });
});

describe("M-IP5-1 · The money model", () => {
  it("stores NO balance anywhere — there is no column to tamper with", async () => {
    const columns = await handle.sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('settlement_cases','settlement_obligations','journal_postings','journal_legs')
        and column_name in ('balance','outstanding','total','remaining')`;
    expect(columns).toHaveLength(0);
  });

  it("wallet == journal fold, and the books balance at EVERY seq", async () => {
    const events = await deps.store.loadStream("journal", org.id);
    for (let cut = 1; cut <= events.length; cut += 1) {
      const replay = replayJournal(events.slice(0, cut));
      expect(replay.ok).toBe(true);
      if (replay.ok) {
        expect(trialBalance(replay.projection).balanced).toBe(true);
      }
    }
    const journal = await journalFold(deps, org.id);
    if (journal === null) {
      throw new Error("journal");
    }
    for (const wallet of wallets(journal)) {
      const lines = statementOf(journal, wallet.account);
      const debits = lines
        .filter((line) => line.direction === "debit")
        .reduce((sum, line) => sum + line.amount, 0);
      const credits = lines
        .filter((line) => line.direction === "credit")
        .reduce((sum, line) => sum + line.amount, 0);
      expect(debits).toBe(wallet.debits);
      expect(credits).toBe(wallet.credits);
    }
  });

  it("waives a debt under override — bounded, audited, and VISIBLE in its own account", async () => {
    expect(
      await waiveObligation(deps, actor, caseId, newId(), {
        teamId: lions(),
        amount: LIONS_DUE + 1,
        reason: "sponsor covered it",
      }),
    ).toMatchObject({ ok: false, reason: "amount_exceeds_outstanding" });

    expect(
      (
        await waiveObligation(deps, actor, caseId, newId(), {
          teamId: lions(),
          amount: LIONS_DUE,
          reason: "sponsor covered it",
        })
      ).ok,
    ).toBe(true);

    const journal = await journalFold(deps, org.id);
    if (journal === null) {
      throw new Error("journal");
    }
    expect(walletOf(journal, duesAccount(caseId, lions()))?.balance).toBe(0);
    // Forgiveness lands in `waived` — never a quiet zeroing of the debt.
    expect(walletOf(journal, waivedAccount(caseId))?.balance).toBe(LIONS_DUE);
    await expectBooksAgreeWithCase();

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, org.id), eq(auditLog.action, "settlement.ObligationWaived")))
      .limit(1);
    expect((audit?.meta as { reason?: string } | undefined)?.reason).toBe("sponsor covered it");
  });

  it("refuses to settle while a rupee is outstanding", async () => {
    expect(await settleCase(deps, actor, caseId, newId())).toMatchObject({
      ok: false,
      reason: "obligations_outstanding",
    });
  });
});

describe("M-IP5-1 · Commands — idempotent, authorized, append-only", () => {
  it("returns the ORIGINAL ack for a duplicate commandId, and appends nothing", async () => {
    const commandId = newId();
    const input = { teamId: tigers(), amount: 1_000_000, reason: "goodwill" };

    const first = await waiveObligation(deps, actor, caseId, commandId, input);
    expect(first).toMatchObject({ ok: true, status: "accepted" });

    const before = await deps.store.loadStream("case", caseId);
    const journalBefore = await deps.store.loadStream("journal", org.id);

    const replayed = await waiveObligation(deps, actor, caseId, commandId, input);
    expect(replayed).toMatchObject({ ok: true, status: "duplicate" });
    if (first.ok && replayed.ok) {
      expect(replayed.seq).toBe(first.seq);
    }
    // Neither stream grew: a duplicate command is not a second waiver.
    expect(await deps.store.loadStream("case", caseId)).toHaveLength(before.length);
    expect(await deps.store.loadStream("journal", org.id)).toHaveLength(journalBefore.length);
    await expectBooksAgreeWithCase();
  });

  it("refuses commands from someone without the capability — including the org owner", async () => {
    const stranger = await settlementActor(db, outsider, org.id);
    expect(await settleCase(deps, stranger, caseId, newId())).toMatchObject({
      ok: false,
      reason: "not_authorized",
    });

    // The org owner conducts the auction. He is NOT a treasurer.
    expect(
      await waiveObligation(deps, ownerActor, caseId, newId(), {
        teamId: tigers(),
        amount: 1,
        reason: "nope",
      }),
    ).toMatchObject({ ok: false, reason: "not_authorized" });
  });

  it("keeps history append-only: every prior event's BYTES survive the next command", async () => {
    const before = await deps.store.loadStream("case", caseId);
    expect(
      (
        await waiveObligation(deps, actor, caseId, newId(), {
          teamId: tigers(),
          amount: 1_000_000,
          reason: "second goodwill",
        })
      ).ok,
    ).toBe(true);

    const after = await deps.store.loadStream("case", caseId);
    expect(after.length).toBe(before.length + 1);
    expect(canonicalJson(after.slice(0, before.length))).toBe(canonicalJson(before));
    // The seq stays dense and strictly increasing — the total order is a fact.
    expect(after.map((event) => event.seq)).toEqual(
      Array.from({ length: after.length }, (_, index) => index + 1),
    );
    await expectBooksAgreeWithCase();
  });
});

describe("M-IP5-1 · Coordination — one cause, one posting, forever", () => {
  it("re-derives a policy effect lost to a crash, and re-running changes nothing", async () => {
    // Simulate a crash BETWEEN the case commit and the journal commit: the case
    // event stands; its journal consequence never landed. (The journal stays
    // contiguous — this is a missing append, not a hole punched in history.)
    const journalEvents = await deps.store.loadStream("journal", org.id);
    const last = journalEvents[journalEvents.length - 1];
    expect(last?.type).toBe("JournalPosted");
    if (last === undefined) {
      return;
    }
    const postingId = last.payload["postingId"] as string;
    await db.delete(journalLegs).where(eq(journalLegs.postingId, postingId));
    await db.delete(journalPostings).where(eq(journalPostings.id, postingId));
    await db
      .delete(settlementEvents)
      .where(
        and(
          eq(settlementEvents.streamType, "journal"),
          eq(settlementEvents.streamId, org.id),
          eq(settlementEvents.seq, last.seq),
        ),
      );
    await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, org.id));

    const repaired = await runCoordination(deps, actor, caseId);
    expect(repaired).toBe(1);
    await expectBooksAgreeWithCase();

    // …and running the catch-up scan AGAIN is a no-op: the derived command id is
    // a function of the source event, so the effect is found, not repeated.
    expect(await runCoordination(deps, actor, caseId)).toBe(0);
    const after = await deps.store.loadStream("journal", org.id);
    expect(after).toHaveLength(journalEvents.length);
  });
});

describe("M-IP5-1 · Fail-closed corruption detection (the tamper drills)", () => {
  it("HALTS a money command when a LEG is tampered with — and heals it from the log", async () => {
    const [leg] = await db
      .select()
      .from(journalLegs)
      .where(and(eq(journalLegs.orgId, org.id), eq(journalLegs.direction, "debit")))
      .limit(1);
    if (leg === undefined) {
      throw new Error("leg fixture");
    }
    // The leg's ROW id is a disposable projection detail — recovery rebuilds it
    // with a fresh id. The stable coordinates are (posting, leg index).
    const legKey = { postingId: leg.postingId, legIndex: leg.legIndex };
    const truth = leg.amount;
    await db
      .update(journalLegs)
      .set({ amount: truth + 100_000 })
      .where(eq(journalLegs.id, leg.id));

    // A command with a journal consequence refuses to write ANYTHING: the case
    // never records a waiver whose posting could not land.
    const before = await deps.store.loadStream("case", caseId);
    const halted = await waiveObligation(deps, actor, caseId, newId(), {
      teamId: tigers(),
      amount: 1_000_000,
      reason: "should halt at the journal",
    });
    expect(halted).toMatchObject({ ok: false, reason: "journal_halted" });
    expect(await deps.store.loadStream("case", caseId)).toHaveLength(before.length);

    const recovery = await recoverJournal(deps, actor);
    expect(recovery.ok).toBe(true);
    expect(recovery.healed).toBe(true);
    expect(recovery.divergences.some((line) => line.includes("amount diverged"))).toBe(true);

    const [healed] = await db
      .select()
      .from(journalLegs)
      .where(
        and(eq(journalLegs.postingId, legKey.postingId), eq(journalLegs.legIndex, legKey.legIndex)),
      );
    expect(healed?.amount).toBe(truth); // the money row says what the events say

    // Healed: the same command now works.
    expect(
      (
        await waiveObligation(deps, actor, caseId, newId(), {
          teamId: tigers(),
          amount: 1_000_000,
          reason: "after recovery",
        })
      ).ok,
    ).toBe(true);
    await expectBooksAgreeWithCase();
  });

  it("HALTS every case command when an OBLIGATION row is tampered with — the settle guard's number", async () => {
    const [row] = await db
      .select()
      .from(settlementObligations)
      .where(
        and(eq(settlementObligations.caseId, caseId), eq(settlementObligations.teamId, tigers())),
      )
      .limit(1);
    if (row === undefined) {
      throw new Error("obligation fixture");
    }
    await db
      .update(settlementObligations)
      .set({ waived: 0 }) // "nobody has paid anything" — the classic lie
      .where(eq(settlementObligations.id, row.id));

    const halted = await waiveObligation(deps, actor, caseId, newId(), {
      teamId: tigers(),
      amount: 1,
      reason: "during tamper",
    });
    expect(halted).toMatchObject({ ok: false, reason: "settlement_halted" });
    if (!halted.ok) {
      expect(halted.detail).toContain("diverged");
    }

    const recovery = await recoverCase(deps, actor, caseId);
    expect(recovery.healed).toBe(true);
    // The obligation row is rebuilt from the log (fresh id); look it up by its
    // stable coordinates (case, team).
    const [healed] = await db
      .select()
      .from(settlementObligations)
      .where(
        and(eq(settlementObligations.caseId, caseId), eq(settlementObligations.teamId, tigers())),
      );
    expect(healed?.waived).toBe(row.waived);
    await expectBooksAgreeWithCase();
  });

  it("catches a DELETED posting row (the reverse scan) and rebuilds it", async () => {
    const postings = await deps.store.loadPostings(org.id);
    const victim = postings[0];
    if (victim === undefined) {
      throw new Error("posting fixture");
    }
    await db.delete(journalLegs).where(eq(journalLegs.postingId, victim.postingId));
    await db.delete(journalPostings).where(eq(journalPostings.id, victim.postingId));

    const verification = await verifyJournal(deps, org.id);
    expect(verification.ok).toBe(false);
    expect(verification.rowDivergences.some((line) => line.includes("row missing"))).toBe(true);

    const healed = await recoverJournal(deps, actor);
    expect(healed.healed).toBe(true);
    expect((await verifyJournal(deps, org.id)).ok).toBe(true);
    await expectBooksAgreeWithCase();
  });

  it("catches a TAMPERED checkpoint — bytes and digest rewritten together — and re-derives the chain", async () => {
    // Give the org a verified chain first.
    const primed = await verifyJournal(deps, org.id);
    expect(primed.ok).toBe(true);
    expect(primed.verified).toBeGreaterThan(0);

    const [checkpoint] = await db
      .select()
      .from(journalCheckpoints)
      .where(eq(journalCheckpoints.orgId, org.id))
      .limit(1);
    if (checkpoint === undefined) {
      throw new Error("checkpoint fixture");
    }
    // The attacker's best move: rewrite the fold AND recompute its digest, so the
    // checkpoint is internally consistent. It still dies — because the checkpoint
    // is judged against GENESIS, not against itself.
    const forged = checkpoint.bytes.replace(/"debits":(\d+)/, '"debits":1');
    await db
      .update(journalCheckpoints)
      .set({ bytes: forged, digest: deps.digest(forged) })
      .where(eq(journalCheckpoints.id, checkpoint.id));

    const caught = await verifyJournal(deps, org.id);
    expect(caught.ok).toBe(false);
    expect(caught.checkpointDivergences.length).toBeGreaterThan(0);

    const rederived = await recoverJournal(deps, actor);
    expect(rederived.healed).toBe(true);
    expect(rederived.checkpointsRederived ?? 0).toBeGreaterThan(0);
    expect((await verifyJournal(deps, org.id)).ok).toBe(true);
  });

  it("REFUSES to heal an unfoldable log — that is a restore, not a repair", async () => {
    const events = await deps.store.loadStream("journal", org.id);
    const forgedId = newId();
    await db.insert(settlementEvents).values({
      id: forgedId,
      orgId: org.id,
      streamType: "journal",
      streamId: org.id,
      seq: events.length + 1,
      type: "MoneyAppeared", // not in the closed catalog
      atMs: Date.now(),
      actor: officer,
      correlationId: newId(),
      commandId: newId(),
      payload: {},
    });

    const recovery = await recoverJournal(deps, actor);
    expect(recovery).toMatchObject({ ok: false, reason: "unknown_event_type", healed: false });
    expect((await verifyJournal(deps, org.id)).reason).toContain("unknown_event_type");

    await db.delete(settlementEvents).where(eq(settlementEvents.id, forgedId));
    expect((await verifyJournal(deps, org.id)).ok).toBe(true);
  });
});

describe("M-IP5-1 · Settle → close → reopen (compensating, never rewriting)", () => {
  it("settles once every rupee is accounted for, then CLOSES — the Reconciled overlay", async () => {
    const fold = await caseFold(deps, caseId);
    const remaining = fold?.projection.obligations[tigers()];
    if (remaining === undefined) {
      throw new Error("obligation");
    }
    expect(
      (
        await waiveObligation(deps, actor, caseId, newId(), {
          teamId: tigers(),
          amount: outstandingOf(remaining),
          reason: "settled offline with the owner",
        })
      ).ok,
    ).toBe(true);
    await expectBooksAgreeWithCase();

    expect((await settleCase(deps, actor, caseId, newId())).ok).toBe(true);
    expect((await closeCase(deps, actor, caseId, newId())).ok).toBe(true);

    const [row] = await db
      .select()
      .from(settlementCases)
      .where(eq(settlementCases.id, caseId))
      .limit(1);
    expect(row?.status).toBe("closed");

    // The auction's OWN status is untouched: `closed` HERE is what surfaces
    // render as "Reconciled". Settlement never wrote a byte of auction truth.
    const record = await auctionOf(db, comp.id);
    expect(record?.status).toBe("completed");
  });

  it("never closes twice; reopening APPENDS a compensating event", async () => {
    expect(await closeCase(deps, actor, caseId, newId())).toMatchObject({
      ok: false,
      reason: "illegal_transition",
    });

    const before = await deps.store.loadStream("case", caseId);
    expect((await reopenCase(deps, actor, caseId, newId(), "owner disputed the waiver")).ok).toBe(
      true,
    );

    const after = await deps.store.loadStream("case", caseId);
    expect(canonicalJson(after.slice(0, before.length))).toBe(canonicalJson(before));
    const fold = await caseFold(deps, caseId);
    expect(fold?.projection.status).toBe("settling");
    expect(fold?.projection.reopenings).toBe(1);

    // Close it again — the night ends reconciled.
    expect((await settleCase(deps, actor, caseId, newId())).ok).toBe(true);
    expect((await closeCase(deps, actor, caseId, newId())).ok).toBe(true);
  });

  it("a case that moved money can never be voided", async () => {
    expect(await voidCase(deps, actor, caseId, newId(), "mistake")).toMatchObject({
      ok: false,
      reason: "illegal_transition",
    });
  });
});

describe("M-IP5-1 · Replay, projections and checkpoints", () => {
  it("replays every stream deterministically — twice, to identical BYTES", async () => {
    const caseEvents = await deps.store.loadStream("case", caseId);
    const c1 = replayCase(caseEvents);
    const c2 = replayCase(caseEvents);
    expect(c1.ok && c2.ok).toBe(true);
    if (c1.ok && c2.ok) {
      expect(canonicalJson(c1.projection)).toBe(canonicalJson(c2.projection));
    }

    const journalEvents = await deps.store.loadStream("journal", org.id);
    const j1 = replayJournal(journalEvents);
    const j2 = replayJournal(journalEvents);
    expect(j1.ok && j2.ok).toBe(true);
    if (j1.ok && j2.ok) {
      expect(canonicalJournalBytes(j1.projection)).toBe(canonicalJournalBytes(j2.projection));
    }
  });

  it("rebuilds EVERY projection from the log — recovery reproduces identical bytes", async () => {
    const beforeObligations = await deps.store.loadObligations(caseId);
    const beforePostings = await deps.store.loadPostings(org.id);
    const [beforeCase] = await db
      .select()
      .from(settlementCases)
      .where(eq(settlementCases.id, caseId));

    // Destroy every projection row in the org. The event log is untouched.
    await db.delete(journalLegs).where(eq(journalLegs.orgId, org.id));
    await db.delete(journalPostings).where(eq(journalPostings.orgId, org.id));
    await db.delete(settlementObligations).where(eq(settlementObligations.caseId, caseId));

    expect((await recoverJournal(deps, actor)).healed).toBe(true);
    expect((await recoverCase(deps, actor, caseId)).healed).toBe(true);

    const afterObligations = await deps.store.loadObligations(caseId);
    const afterPostings = await deps.store.loadPostings(org.id);
    const [afterCase] = await db
      .select()
      .from(settlementCases)
      .where(eq(settlementCases.id, caseId));

    expect(canonicalJson(sortByTeam(afterObligations))).toBe(
      canonicalJson(sortByTeam(beforeObligations)),
    );
    expect(canonicalJson(afterPostings)).toBe(canonicalJson(beforePostings));
    expect(afterCase?.status).toBe(beforeCase?.status);
    expect(afterCase?.sourceDigest).toBe(beforeCase?.sourceDigest);
    expect(afterCase?.foldDigest).toBe(beforeCase?.foldDigest);
    await expectBooksAgreeWithCase();
  });

  it("proves every checkpoint byte-identical to the genesis fold (checkpoint equivalence)", async () => {
    const verification = await verifyJournal(deps, org.id);
    expect(verification.ok).toBe(true);
    expect(verification.rowDivergences).toEqual([]);
    expect(verification.verified).toBeGreaterThan(0);

    const stored = await deps.store.loadCheckpoints(org.id);
    expect(stored.length).toBeGreaterThan(0);
    const events = await deps.store.loadStream("journal", org.id);
    for (const checkpoint of stored) {
      expect(checkpoint.seq % CHECKPOINT_CADENCE).toBe(0);
      expect(checkpoint.verifiedAtMs).not.toBeNull();
      const genesis = replayJournal(events.filter((event) => event.seq <= checkpoint.seq));
      expect(genesis.ok).toBe(true);
      if (genesis.ok) {
        expect(checkpoint.bytes).toBe(canonicalJournalBytes(genesis.projection));
        expect(checkpoint.digest).toBe(deps.digest(checkpoint.bytes));
      }
    }
  });

  it("the command path folds from a VERIFIED checkpoint and lands on the same books", async () => {
    const latest = await deps.store.latestVerifiedCheckpoint(org.id);
    expect(latest).not.toBeNull();
    const genesis = replayJournal(await deps.store.loadStream("journal", org.id));
    const loaded = await loadJournal(deps, org.id);
    expect(genesis.ok && loaded.ok).toBe(true);
    if (genesis.ok && loaded.ok && latest !== null) {
      // What the writer will fold on its next command IS the genesis fold.
      expect(canonicalJournalBytes(loaded.fold.projection)).toBe(
        canonicalJournalBytes(genesis.projection),
      );
      expect(loaded.fold.verifiedThrough).toBe(latest.seq);
    }
  });
});

describe("M-IP5-1 · Authorization & tenancy", () => {
  it("partitions the capability space — settlement grants and frozen grants never bleed", async () => {
    const officerGrants = await grantsFor(db, officer);
    const ownerGrants = await grantsFor(db, owner);
    const scope = { scopeType: "org" as const, scopeId: org.id };

    expect(hasSettlementCapability(officerGrants, scope, "settlement.override")).toBe(true);
    // The settlement grant confers NOTHING in the frozen engine…
    expect(hasCapability(officerGrants, scope, "auction.conduct")).toBe(false);
    expect(hasCapability(officerGrants, scope, "org.manage")).toBe(false);
    // …and org:owner — who conducts the auction — confers NOTHING in this one.
    expect(hasCapability(ownerGrants, scope, "auction.conduct")).toBe(true);
    for (const capability of [
      "settlement.view",
      "settlement.manage",
      "settlement.collect",
      "settlement.override",
    ] as SettlementCapability[]) {
      expect(await canSettlement(db, owner, org.id, capability)).toBe(false);
    }
  });

  it("mints settlement grants only through the FROZEN grant.issue gate, and refuses unknown sets", async () => {
    expect(
      await issueSettlementGrant(db, outsider, org.id, outsider, "settlement:officer"),
    ).toEqual({
      ok: false,
      reason: "forbidden",
    });

    expect(await issueSettlementGrant(db, owner, org.id, outsider, "settlement:auditor")).toEqual({
      ok: false,
      reason: "unknown_set",
    });
    // Nothing unexpandable was written — the IP-2 invites discipline, kept.
    expect(
      await db
        .select()
        .from(grantsTable)
        .where(and(eq(grantsTable.scopeId, org.id), eq(grantsTable.personId, outsider))),
    ).toHaveLength(0);

    const issued = await issueSettlementGrant(db, owner, org.id, outsider, "settlement:officer");
    expect(issued.ok).toBe(true);
    expect(await canSettlement(db, outsider, org.id, "settlement.manage")).toBe(true);
    // An officer collects and manages; only a controller forgives.
    expect(await canSettlement(db, outsider, org.id, "settlement.override")).toBe(false);

    if (issued.ok) {
      expect((await revokeSettlementGrant(db, owner, org.id, issued.grantId)).ok).toBe(true);
      // Effective on the NEXT check — no session caches money power.
      expect(await canSettlement(db, outsider, org.id, "settlement.manage")).toBe(false);
    }
  });

  it("RLS PROOF: cross-tenant reads fold to zero and cross-tenant writes are REJECTED", async () => {
    const role = `rls_settle_${RUN}`;
    const tables =
      "settlement_events, settlement_cases, settlement_obligations, journal_postings, journal_legs, journal_checkpoints";
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select, insert, update, delete on ${tables} to ${role}`);

    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    const otherOrg = newId();
    try {
      // 1 · No tenant context → the policies fail CLOSED (zero rows, not an error).
      const blind = await probe<{ n: number }[]>`select count(*)::int as n from settlement_cases`;
      expect(blind[0]?.n).toBe(0);

      // 2 · A FOREIGN tenant context → this org's rows are invisible on every table.
      const foreign = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${otherOrg}, true)`;
        const cases = await tx<{ n: number }[]>`select count(*)::int as n from settlement_cases`;
        const events = await tx<{ n: number }[]>`select count(*)::int as n from settlement_events`;
        const legs = await tx<{ n: number }[]>`select count(*)::int as n from journal_legs`;
        const points = await tx<
          { n: number }[]
        >`select count(*)::int as n from journal_checkpoints`;
        return [cases[0]?.n, events[0]?.n, legs[0]?.n, points[0]?.n];
      });
      expect(foreign).toEqual([0, 0, 0, 0]);

      // 3 · Its OWN context → its rows are there.
      const own = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        const rows = await tx<{ n: number }[]>`select count(*)::int as n from settlement_cases`;
        return rows[0]?.n ?? 0;
      });
      expect(own).toBe(1);

      // 4 · WRITE side (the RC-4 lesson): a row scoped to ANOTHER org is rejected
      //     by WITH CHECK even while holding a legitimate tenant context.
      await expect(
        probe.begin(async (tx) => {
          await tx`select set_config('app.org_id', ${org.id}, true)`;
          await tx`insert into journal_legs (id, org_id, posting_id, leg_index, account, direction, amount)
                   values (${newId()}, ${otherOrg}, ${newId()}, 0, 'funds:manual:cash', 'debit', 1)`;
        }),
      ).rejects.toThrow(/row-level security/i);

      // 5 · …and a row scoped to the ACTIVE org is allowed.
      const allowed = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        const id = newId();
        await tx`insert into journal_legs (id, org_id, posting_id, leg_index, account, direction, amount)
                 values (${id}, ${org.id}, ${newId()}, 99, 'funds:manual:cash', 'debit', 1)`;
        await tx`delete from journal_legs where id = ${id}`;
        return true;
      });
      expect(allowed).toBe(true);
    } finally {
      await probeHandle.sql.end({ timeout: 5 });
      await handle.sql.unsafe(`revoke all on ${tables} from ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  }, 60_000);
});

describe("M-IP5-1 · Audit", () => {
  it("writes one audit row per settlement event, carrying its evidence", async () => {
    const events = await deps.store.loadStream("case", caseId);
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, org.id), eq(auditLog.subject, caseId)));
    const seqs = new Set(
      rows.map((row) => Number((row.meta as { eventSeq?: string }).eventSeq ?? -1)),
    );
    for (const event of events) {
      expect(seqs.has(event.seq)).toBe(true);
      expect(rows.some((row) => row.action === `settlement.${event.type}`)).toBe(true);
    }
    // Overrides always carry their WHY.
    const waivers = rows.filter((row) => row.action === "settlement.ObligationWaived");
    expect(waivers.length).toBeGreaterThan(0);
    for (const waiver of waivers) {
      expect((waiver.meta as { reason?: string }).reason).toBeTruthy();
    }
  });
});

function sortByTeam<T extends { teamId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.teamId < b.teamId ? -1 : 1));
}
