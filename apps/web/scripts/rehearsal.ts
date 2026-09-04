/**
 * THE REHEARSAL — one full auction night under the PRODUCTION ROLE RECIPE.
 *
 * Audit PA-1's central finding was not any single bug. It was that every unit,
 * integration and e2e run connects as the database OWNER, for whom Postgres
 * ignores row-level security and every grant. Three defects lived in that blind
 * spot, two of them on the money path, and all three behaved perfectly in every
 * environment the team could observe.
 *
 * `grants:verify` asserts the grant manifest. `rls:verify` proves the policies
 * are load-bearing. `posture:verify` runs individual handlers as the app role.
 * None of them runs a NIGHT. This does — and it runs it through the SAME split
 * production uses, which is the part a synthetic script would get wrong:
 *
 *   desiauction_app     the web tier. Login, org, competition, teams, intake,
 *                       `createAuction` (the one aggregate mutator the web
 *                       calls directly), then all of settlement and issuance.
 *   desiauction_engine  the auction itself. Paddles, queue, transitions, bids,
 *                       the hammer — everything routed through `conductCommand`
 *                       in production reaches the aggregate on this role.
 *   desiauction_runner  the FinOps follower, the one writer of finops truth.
 *   desiauction         the OWNER — fixtures and teardown ONLY, never the path
 *                       under test. Creating a tenant is not something a
 *                       tenant-scoped role can do.
 *
 * From an empty database to an auto-issued receipt with no owner connection
 * anywhere on the write path. That is the gate PA-1 §26 asks for. Any refusal
 * is a finding, and the script stops at the first one rather than reporting a
 * tidy summary of a night that did not happen.
 *
 *   pnpm --filter @desiauction/web rehearsal
 *
 * Requires the four roles (ops/db/create-app-role.sql). Defaults match the
 * local recipe; every URL is overridable for staging.
 */
import path from "node:path";

import type { Db } from "@desiauction/db";
import type { FinopsActor, FinopsDeps } from "@desiauction/financial-operations/server";

import type { SettlementActor } from "../src/server/settlement/writer.js";
import type { SettlementDeps } from "../src/server/settlement/deps.js";

// The web's `env.ts` validates at import and `server/db.ts` builds its pool from
// `DATABASE_URL` at module scope — the same pool the running app uses. So the
// roles must be in the environment BEFORE those modules load, which is why every
// application import below is dynamic. Static imports here would hoist above
// this block and the rehearsal would quietly run as whatever `.env.local` says.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env.local"));
} catch {
  // No .env.local (CI, fresh clone) — the fallbacks below are correct there.
}

const host = process.env["REHEARSAL_DB_HOST"] ?? "localhost";
const port = process.env["REHEARSAL_DB_PORT"] ?? process.env["DB_PORT"] ?? "5433";
const database = process.env["REHEARSAL_DB_NAME"] ?? "desiauction";
const roleUrl = (role: string, password: string): string =>
  `postgres://${role}:${password}@${host}:${port}/${database}`;

const OWNER_URL =
  process.env["OWNER_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  roleUrl("desiauction", "desiauction");
const APP_URL =
  process.env["APP_DATABASE_URL"] ??
  roleUrl("desiauction_app", process.env["APP_DB_PASSWORD"] ?? "local-app");
const ENGINE_URL =
  process.env["ENGINE_DATABASE_URL"] ??
  roleUrl("desiauction_engine", process.env["ENGINE_DB_PASSWORD"] ?? "local-engine");
const RUNNER_URL =
  process.env["RUNNER_DATABASE_URL"] ??
  roleUrl("desiauction_runner", process.env["RUNNER_DB_PASSWORD"] ?? "local-runner");
const SYSTEM_URL =
  process.env["SYSTEM_DATABASE_URL_REHEARSAL"] ??
  roleUrl("desiauction_system", process.env["SYSTEM_DB_PASSWORD"] ?? "local-system");

process.env["DATABASE_URL"] = APP_URL;
process.env["SYSTEM_DATABASE_URL"] = SYSTEM_URL;

const { createDb, newId, withTenantDb } = await import("@desiauction/db");
const {
  auditLog,
  competitions,
  finopsCursors,
  finopsDocuments,
  finopsEvents,
  finopsJobs,
  finopsProfiles,
  finopsSeries,
  grants: grantsTable,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  registrations: registrationsTable,
  sessions,
  settlementEvents,
} = await import("@desiauction/db");
const { eq, inArray, like } = await import("drizzle-orm");

const ownerHandle = createDb(OWNER_URL);
const engineHandle = createDb(ENGINE_URL);
const runnerHandle = createDb(RUNNER_URL);

// The app tier's own pool, built from DATABASE_URL exactly as the running
// application builds it — not a second connection that merely resembles it.
const { db, dbHandle } = await import("../src/server/db.js");

/**
 * THE BOUNDARY EVERY SERVER ACTION ENTERS.
 *
 * Org-scoped work in this application does not run on the bare pool. Each
 * action opens `withTenantDb`, which begins a transaction and sets
 * `app.person_id` and `app.org_id`; the RLS policies decide from there. A
 * rehearsal that called the same domain functions on the bare pool — the way
 * the integration suites do, because the owner makes it work — would be running
 * code the product does not run, and would report refusals production never
 * sees. So every step below enters the boundary its own action enters, one
 * boundary per step, because one transaction per action is what production has.
 */
async function asOrg<T>(personId: string, fn: (tenant: Db) => Promise<T>): Promise<T> {
  return withTenantDb(dbHandle, { personId, orgId }, fn);
}

// -- the ledger of the night -------------------------------------------------

interface Step {
  readonly role: string;
  readonly name: string;
  readonly ok: boolean;
  readonly note: string | undefined;
}
const steps: Step[] = [];

function step(role: string, name: string, ok: boolean, note?: string): void {
  steps.push({ role, name, ok, note });
  const mark = ok ? "✓" : "✗";
  const tail = note === undefined ? "" : `  — ${note}`;
  console.log(`  ${mark} [${role.padEnd(6)}] ${name}${tail}`);
}

/** Any refusal is a finding: stop at the first one rather than reporting a tidy summary. */
function must(role: string, name: string, ok: boolean, note?: string): void {
  step(role, name, ok, note);
  if (!ok) {
    throw new Error(`${name}${note === undefined ? "" : `: ${note}`}`);
  }
}

// -- the cast ----------------------------------------------------------------

const RUN = String(Date.now()).slice(-7);
const PHONE_ORGANIZER = `+9192${RUN}1`;
const PHONE_OFFICER = `+9191${RUN}2`;
const PHONE_OWNER_A = `+9190${RUN}3`;
const PHONE_OWNER_B = `+9194${RUN}4`;
const CAST_PHONES = [PHONE_ORGANIZER, PHONE_OFFICER, PHONE_OWNER_A, PHONE_OWNER_B];
const PLAYER_PREFIX = `+91933${RUN}`;

/** Two teams, two players each: enough for a real hammer, small enough to read. */
const SALE_PRICE = 5_000_000; // ₹50,000 in paise
const TEAM_NAMES = ["Rehearsal Tigers", "Rehearsal Lions"] as const;
const PLAYERS = ["Player One", "Player Two", "Player Three", "Player Four"] as const;

let orgId = "";
const cast: string[] = [];

// -- the guard that makes the whole exercise mean something ------------------

/**
 * A rehearsal run as the owner proves nothing at all, so it is not allowed to
 * happen by accident. Postgres exempts the owner from RLS and from every grant,
 * which is exactly the blind spot this script exists to leave.
 */
async function assertRoles(): Promise<void> {
  const expected = [
    { url: APP_URL, role: "desiauction_app", bypass: false },
    { url: ENGINE_URL, role: "desiauction_engine", bypass: true },
    { url: RUNNER_URL, role: "desiauction_runner", bypass: true },
  ];
  for (const want of expected) {
    const handle = createDb(want.url);
    try {
      const rows = (await handle.sql`
        select current_user as role, rolsuper, rolbypassrls
          from pg_roles where rolname = current_user
      `) as unknown as { role: string; rolsuper: boolean; rolbypassrls: boolean }[];
      const row = rows[0];
      const ok = row !== undefined && row.role === want.role && !row.rolsuper;
      must(
        "roles",
        `${want.role} is itself and is not a superuser`,
        ok,
        row === undefined ? "no such role" : `connected as ${row.role}`,
      );
    } finally {
      await handle.sql.end({ timeout: 5 });
    }
  }
  // The app role is the one whose RLS exemption would void the whole run.
  const rows = (await ownerHandle.sql`
    select rolsuper, rolbypassrls from pg_roles where rolname = 'desiauction_app'
  `) as unknown as { rolsuper: boolean; rolbypassrls: boolean }[];
  must(
    "roles",
    "desiauction_app is NOBYPASSRLS — or nothing below proves anything",
    rows[0]?.rolbypassrls === false,
  );
}

// -- act one: the tenant, on the app role ------------------------------------

interface CompetitionRef {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly slug: string;
}

async function buildTheSeason(): Promise<{ competition: CompetitionRef; teamIds: string[] }> {
  const { requestOtp, verifyOtp } = await import("../src/server/auth/otp.js");
  const { DevInboxSender } = await import("../src/server/auth/otp-sender.js");
  const { createOrg } = await import("../src/server/orgs/orgs.js");
  const { advanceCompetition, createCompetition, createTeam, resolveCompetition } =
    await import("../src/server/competition/competitions.js");
  const { registrationNumber } = await import("@desiauction/core");

  const sender = new DevInboxSender(db);
  const login = async (phone: string): Promise<string> => {
    await requestOtp(db, sender, phone);
    const [row] = await db
      .select({ code: otpInbox.code })
      .from(otpInbox)
      .where(eq(otpInbox.phone, phone))
      .orderBy(otpInbox.createdAt);
    const result = await verifyOtp(db, phone, row?.code ?? "");
    if (!result.ok) {
      throw new Error(`login refused for ${phone}: ${result.reason}`);
    }
    return result.personId;
  };

  for (const phone of CAST_PHONES) {
    cast.push(await login(phone));
  }
  must("app", "four people signed in through the real OTP path", cast.length === 4);
  const organizer = cast[0] ?? "";

  // The id is minted BEFORE the boundary opens, because the org's own member,
  // grant and audit rows are WITH CHECK'd against `app.org_id` — a boundary
  // cannot be opened onto an org whose id does not exist yet.
  orgId = newId();
  const org = await asOrg(organizer, (tenant) =>
    createOrg(tenant, organizer, `Rehearsal Club ${RUN}`, orgId),
  );
  must("app", "organization created", org.id === orgId);

  let competition = await asOrg(organizer, (tenant) =>
    createCompetition(tenant, orgId, organizer, {
      name: `Rehearsal Season ${RUN}`,
      location: "Malad",
      startsOn: "2026-10-01",
      endsOn: "2026-11-15",
    }),
  );
  must("app", "competition created", competition.id !== "");

  const teamIds: string[] = [];
  for (const name of TEAM_NAMES) {
    const team = await asOrg(organizer, (tenant) =>
      createTeam(tenant, orgId, competition.id, organizer, name),
    );
    must("app", `team created — ${name}`, team.ok, team.ok ? undefined : "refused");
    if (team.ok) {
      teamIds.push(team.team.id);
    }
  }

  const advanceTo = async (status: "setup" | "registration_open" | "registration_closed") => {
    await asOrg(organizer, async (tenant) => {
      const current = await resolveCompetition(tenant, organizer, competition.slug);
      if (current === null) {
        throw new Error(`competition unreadable before advancing to ${status}`);
      }
      await advanceCompetition(tenant, current, organizer, status);
    });
    step("app", `competition advanced to ${status}`, true);
  };
  await advanceTo("setup");
  await advanceTo("registration_open");

  for (const [index, name] of PLAYERS.entries()) {
    const personId = newId();
    // People are not org-scoped — a player belongs to no club — so the person
    // row is written where identity is written: outside the tenant boundary.
    await db
      .insert(people)
      .values({ id: personId, phone: `${PLAYER_PREFIX}${String(index)}`, name });
    const id = newId();
    await asOrg(organizer, (tenant) =>
      tenant.insert(registrationsTable).values({
        id,
        orgId,
        competitionId: competition.id,
        personId,
        role: "batter",
        status: "approved",
        registrationNumber: registrationNumber(id),
        basePriceBand: "A",
      }),
    );
  }
  step("app", `${String(PLAYERS.length)} players approved into the pool`, true);

  await advanceTo("registration_closed");
  const closed = await asOrg(organizer, (tenant) =>
    resolveCompetition(tenant, organizer, competition.slug),
  );
  must("app", "intake closed", closed !== null);
  competition = closed ?? competition;

  return {
    competition: {
      id: competition.id,
      orgId: org.id,
      name: competition.name,
      slug: competition.slug,
    },
    teamIds,
  };
}

// -- act two: the night. App creates the auction; the ENGINE conducts it. ----

async function conductTheNight(
  competition: CompetitionRef,
  teamIds: string[],
): Promise<{ auctionId: string; soldTotal: number }> {
  const { auctionReady } = await import("../src/server/auction/auction-ready.js");
  const { resolveCompetition } = await import("../src/server/competition/competitions.js");
  const {
    auctionOf,
    auctionView,
    closeLot,
    createAuction,
    issuePaddle,
    placeBid,
    queueAllLots,
    transitionAuction,
    transitionLot,
  } = await import("@desiauction/auction");
  const { DEFAULT_AUCTION_CONFIG } = await import("@desiauction/core");

  const organizer = cast[0] ?? "";
  const ownerA = cast[2] ?? "";
  const ownerB = cast[3] ?? "";

  // The web tier's one aggregate mutation, on the web tier's role.
  const ready = await asOrg(organizer, async (tenant) => {
    const current = await resolveCompetition(tenant, organizer, competition.slug);
    if (current === null) {
      throw new Error("competition unreadable at auction creation");
    }
    return auctionReady(tenant, current);
  });
  must(
    "app",
    "readiness gate open",
    ready.ok,
    ready.checks
      .filter((check) => !check.pass)
      .map((check) => check.id)
      .join(", ") || undefined,
  );
  const created = await asOrg(organizer, (tenant) =>
    createAuction(tenant, competition, ready, organizer, DEFAULT_AUCTION_CONFIG),
  );
  must("app", "auction created", created.ok, created.ok ? undefined : created.reason);

  // Everything from here is what `conductCommand` routes to the engine.
  const edb = engineHandle.db;
  const record = await auctionOf(edb, competition.id);
  must("engine", "auction readable by the engine", record !== null);
  if (record === null) {
    throw new Error("unreachable");
  }
  let auction = record;

  const paddleIds: string[] = [];
  for (const [index, teamId] of teamIds.entries()) {
    const holder = index === 0 ? ownerA : ownerB;
    const issued = await issuePaddle(edb, auction, organizer, teamId, holder);
    must(
      "engine",
      `paddle issued — ${TEAM_NAMES[index] ?? teamId}`,
      issued.ok,
      issued.ok ? undefined : issued.reason,
    );
    if (issued.ok) {
      paddleIds.push(issued.paddleId);
    }
  }

  const queued = await queueAllLots(edb, auction, organizer);
  must("engine", `${String(queued.applied)} lots queued`, queued.applied === PLAYERS.length);

  const opened = await transitionAuction(edb, auction, organizer, "open");
  must("engine", "auction live", opened.ok, opened.ok ? undefined : opened.reason);
  auction = (await auctionOf(edb, competition.id)) ?? auction;

  const view = await auctionView(edb, auction);
  let soldTotal = 0;
  for (const [index, lot] of view.lots.entries()) {
    const paddleId = paddleIds[index % paddleIds.length] ?? "";
    const onBlock = await transitionLot(edb, auction, lot.id, organizer, "open");
    must(
      "engine",
      `${lot.lotNumber} on the block`,
      onBlock.ok,
      onBlock.ok ? undefined : onBlock.reason,
    );
    const bid = await placeBid(edb, auction, organizer, {
      lotId: lot.id,
      paddleId,
      amountRaw: SALE_PRICE,
      bidderAuthorized: true,
    });
    must("engine", `bid on ${lot.lotNumber}`, bid.ok, bid.ok ? undefined : bid.code);
    const sold = await closeLot(edb, auction, lot.id, organizer);
    must("engine", `hammer on ${lot.lotNumber}`, sold.ok, sold.ok ? undefined : sold.reason);
    soldTotal += SALE_PRICE;
  }

  // Squads are deliberately two players deep here; DA-06's soft minimum is
  // overridden exactly as a conductor overrides it in the room.
  const done = await transitionAuction(edb, auction, organizer, "complete", undefined, true);
  must("engine", "auction complete", done.ok, done.ok ? undefined : done.reason);

  return { auctionId: auction.id, soldTotal };
}

// -- act three: the money, on the app role -----------------------------------

async function settleTheNight(auctionId: string, teamIds: string[]): Promise<string> {
  const { issueSettlementGrant, settlementActor } =
    await import("../src/server/settlement/authz.js");
  const { settlementDeps } = await import("../src/server/settlement/deps.js");
  const {
    attestManualCapture,
    computeCaseObligations,
    createPayment,
    openCase,
    settleCase,
    verifyCase,
  } = await import("../src/server/settlement/writer.js");

  const organizer = cast[0] ?? "";
  const officer = cast[1] ?? "";

  const granted = await asOrg(organizer, (tenant) =>
    issueSettlementGrant(tenant, organizer, orgId, officer, "settlement:controller"),
  );
  must("app", "settlement capability granted", granted.ok, granted.ok ? undefined : granted.reason);

  /** One command, one boundary, one transaction — the shape of a server action. */
  const command = async <T>(fn: (deps: SettlementDeps, actor: SettlementActor) => Promise<T>) =>
    asOrg(officer, async (tenant) =>
      fn(settlementDeps(tenant), await settlementActor(tenant, officer, orgId)),
    );

  const opened = await command((deps, actor) =>
    openCase(deps, actor, { commandId: newId(), auctionId, basis: "committed" }),
  );
  must("app", "settlement case opened", opened.ok, opened.ok ? undefined : opened.reason);
  if (!opened.ok) {
    throw new Error("unreachable");
  }
  const caseId = opened.caseId;

  const verified = await command((deps, actor) => verifyCase(deps, actor, caseId, newId()));
  must(
    "app",
    "case verified against the frozen log",
    verified.ok,
    verified.ok ? undefined : verified.reason,
  );
  const computed = await command((deps, actor) =>
    computeCaseObligations(deps, actor, caseId, newId()),
  );
  must("app", "obligations computed", computed.ok, computed.ok ? undefined : computed.reason);

  // Beta collects manually (decision D1) — cash in the room, attested.
  let lastPaymentId = "";
  for (const [index, teamId] of teamIds.entries()) {
    const paymentId = newId();
    const payment = await command((deps, actor) =>
      createPayment(deps, actor, {
        paymentId,
        commandId: newId(),
        caseId,
        teamId,
        method: "manual:cash",
        amount: SALE_PRICE * (PLAYERS.length / teamIds.length),
      }),
    );
    must(
      "app",
      `payment recorded — ${TEAM_NAMES[index] ?? teamId}`,
      payment.ok,
      payment.ok ? undefined : payment.reason,
    );
    const captured = await command((deps, actor) =>
      attestManualCapture(deps, actor, paymentId, newId(), {
        attestedBy: officer,
        evidenceRef: `rehearsal-${RUN}`,
      }),
    );
    must(
      "app",
      `capture attested — ${TEAM_NAMES[index] ?? teamId}`,
      captured.ok,
      captured.ok ? undefined : captured.reason,
    );
    lastPaymentId = paymentId;
  }

  const settled = await command((deps, actor) => settleCase(deps, actor, caseId, newId()));
  must("app", "case settled", settled.ok, settled.ok ? undefined : settled.reason);
  return lastPaymentId;
}

// -- act four: issuance. App declares; the RUNNER's follower issues. ---------

async function issueTheReceipt(): Promise<void> {
  const { finopsActor, issueFinopsGrant } =
    await import("../src/server/financial-operations/authz.js");
  const { webFinopsDeps } = await import("../src/server/financial-operations/deps.js");
  const { declareProfile, openSeries, finopsDeps, runFollower } =
    await import("@desiauction/financial-operations/server");
  const { fiscalYearOf, istDateOf } = await import("@desiauction/financial-operations");

  const organizer = cast[0] ?? "";
  const officer = cast[1] ?? "";

  const granted = await asOrg(organizer, (tenant) =>
    issueFinopsGrant(tenant, organizer, orgId, officer, "finops:controller"),
  );
  must("app", "finops capability granted", granted.ok, granted.ok ? undefined : granted.reason);

  const command = async <T>(fn: (deps: FinopsDeps, actor: FinopsActor) => Promise<T>) =>
    asOrg(officer, async (tenant) =>
      fn(webFinopsDeps(tenant), await finopsActor(tenant, officer, orgId)),
    );

  // These two dam the lifecycle: without a declared profile and an open series
  // the follower consumes the settlement history and issues nothing.
  const profile = await command((deps, actor) =>
    declareProfile(
      deps,
      actor,
      { legalName: `Rehearsal Club ${RUN}`, posture: "none", autoReceipt: true },
      newId(),
    ),
  );
  must("app", "tax profile declared", profile.ok, profile.ok ? undefined : profile.reason);

  // The series must sit in the fiscal year the payments landed in, and the
  // fiscal calendar here is IST — a UTC "today" is the wrong year for five and
  // a half hours of every day.
  const fy = fiscalYearOf(istDateOf(Date.now()));
  const series = await command((deps, actor) =>
    openSeries(deps, actor, { kind: "receipt", fy, prefix: `RCT${RUN}` }, newId()),
  );
  must(
    "app",
    `receipt series opened for FY ${fy}`,
    series.ok,
    series.ok ? undefined : series.reason,
  );

  // The follower is the runner's job in production, so it runs on the runner's
  // role — the fourth and last of the recipe.
  const run = await runFollower(finopsDeps(runnerHandle.db), orgId);
  must(
    "runner",
    "follower consumed the settlement history",
    run.consumed > 0,
    `${String(run.consumed)} events`,
  );
  must(
    "runner",
    "receipt auto-issued",
    run.autoReceipts.issued > 0,
    run.autoReceipts.skipped.length > 0 ? run.autoReceipts.skipped.join(", ") : undefined,
  );

  // The last question is not "did a row appear" but "is the money on the
  // receipt the money that changed hands" — a receipt for the wrong amount is
  // worse than none, and only this end-to-end run can compare the two.
  const documents = await ownerHandle.db
    .select({
      prefix: finopsSeries.prefix,
      number: finopsDocuments.number,
      kind: finopsDocuments.kind,
      amount: finopsDocuments.amount,
    })
    .from(finopsDocuments)
    .innerJoin(finopsSeries, eq(finopsSeries.id, finopsDocuments.seriesId))
    .where(eq(finopsDocuments.orgId, orgId));
  const issued = documents
    .map(
      (row) =>
        `${row.prefix}/${String(row.number)} · ₹${(row.amount / 100).toLocaleString("en-IN")}`,
    )
    .join(", ");
  must("check", "numbered receipts on the record", documents.length > 0, issued);
  must(
    "check",
    "receipts total the money collected",
    documents.reduce((sum, row) => sum + row.amount, 0) === SALE_PRICE * PLAYERS.length,
    issued,
  );
  must(
    "check",
    "every document is a receipt",
    documents.every((row) => row.kind === "receipt"),
  );
}

// -- teardown: the owner's job, and not part of the proof --------------------

async function teardown(): Promise<void> {
  if (orgId === "") {
    return;
  }
  const { purgeOrg } = await import("../src/server/test-support/purge-org.js");
  const db = ownerHandle.db;
  await db.delete(finopsDocuments).where(eq(finopsDocuments.orgId, orgId));
  await db.delete(finopsSeries).where(eq(finopsSeries.orgId, orgId));
  await db.delete(finopsProfiles).where(eq(finopsProfiles.orgId, orgId));
  await db.delete(finopsCursors).where(eq(finopsCursors.orgId, orgId));
  await db.delete(finopsJobs).where(eq(finopsJobs.orgId, orgId));
  await db.delete(finopsEvents).where(eq(finopsEvents.orgId, orgId));
  await purgeOrg(db, orgId);
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(grantsTable).where(eq(grantsTable.scopeId, orgId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  await db.delete(registrationsTable).where(eq(registrationsTable.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(otpCodes).where(inArray(otpCodes.phone, CAST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, CAST_PHONES));
  if (cast.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, cast));
  }
  await db.delete(people).where(like(people.phone, `${PLAYER_PREFIX}%`));
  await db.delete(people).where(inArray(people.phone, CAST_PHONES));
}

// -- the run -----------------------------------------------------------------

console.log("\nREHEARSAL — one auction night under the production role recipe\n");
console.log(`  app     ${APP_URL.replace(/:[^:@]*@/, ":***@")}`);
console.log(`  engine  ${ENGINE_URL.replace(/:[^:@]*@/, ":***@")}`);
console.log(`  runner  ${RUNNER_URL.replace(/:[^:@]*@/, ":***@")}`);
console.log(`  owner   fixtures and teardown only\n`);

let failure: unknown = null;
try {
  await assertRoles();
  const { competition, teamIds } = await buildTheSeason();
  const { auctionId, soldTotal } = await conductTheNight(competition, teamIds);
  await settleTheNight(auctionId, teamIds);
  await issueTheReceipt();
  console.log(
    `\n  ₹${(soldTotal / 100).toLocaleString("en-IN")} committed across ` +
      `${String(PLAYERS.length)} lots and ${String(teamIds.length)} teams.`,
  );
} catch (error) {
  failure = error;
}

const refused = steps.filter((entry) => !entry.ok);
if (failure === null && refused.length === 0) {
  console.log(
    `\nREHEARSAL PASSED — ${String(steps.length)} steps, no owner connection on the ` +
      `write path, no refusals.\n`,
  );
} else {
  console.error(
    `\nREHEARSAL FAILED at step ${String(steps.length)}: ` +
      `${failure instanceof Error ? failure.message : String(failure)}\n\n` +
      "A refusal here is the production behaviour, reproduced. Read it literally:\n" +
      "a `permission denied` is a missing grant, an empty read is RLS with no\n" +
      "tenant boundary set, and neither is a broken script.\n",
  );
  process.exitCode = 1;
}

try {
  await teardown();
} catch (error) {
  console.error(`\nteardown failed (rows left behind): ${String(error)}`);
  process.exitCode = 1;
}
await Promise.all(
  [ownerHandle, engineHandle, runnerHandle, dbHandle].map((handle) =>
    handle.sql.end({ timeout: 5 }),
  ),
);
