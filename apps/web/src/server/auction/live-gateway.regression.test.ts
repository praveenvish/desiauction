import { createHash, randomBytes } from "node:crypto";

import {
  auctions,
  createDb,
  newId,
  orgMembers,
  otpCodes,
  otpInbox,
  paddles,
  people,
  sessions,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE GENERIC COMMAND GATEWAY, AS AN APPOINTED AUCTIONEER SEES IT (go-live
 * gate P0-5), against real Postgres.
 *
 * `auction:conductor` is `auction.conduct` and nothing else. PlaceBid is in
 * neither CONDUCT_ONLY nor MANAGE_ONLY, and the engine authorised a bid by
 * `holder || conduct` — so the neutral person at the gavel could bid with any
 * team's paddle and spend a purse that was never theirs. The engine now wants
 * conduct AND manage for a non-holder bid (conduct-ceremony integration suite);
 * this proves the web tier refuses before the round trip, and that it tells
 * the engine the truth about `manage` when it does forward.
 *
 * The engine client is the one thing mocked: every envelope the gateway would
 * have sent is captured, so "refused here" means "never left the web tier".
 */

let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name.endsWith("da_session") && sessionToken !== "" ? { value: sessionToken } : undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const sent: Record<string, unknown>[] = [];
vi.mock("./engine-client", () => ({
  sendEngineCommand: (input: Record<string, unknown>) => {
    sent.push(input);
    return Promise.resolve({ commandId: input["commandId"], accepted: true, version: 1 });
  },
  engineWsUrl: () => "ws://engine.test",
}));

const { env } = await import("../../env");
const { requestOtp, verifyOtp } = await import("../auth/otp");
const { DevInboxSender } = await import("../auth/otp-sender");
const { createCompetition } = await import("../competition/competitions");
const { createOrg } = await import("../orgs/orgs");
const { purgeOrg } = await import("../test-support/purge-org");
const { assignAuctioneer } = await import("./auctioneers");
const { submitAuctionCommand } = await import("./live-actions");

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9194${RUN}9`;

let owner = "";
const auctioneer = newId();
let orgId = "";
let slug = "";
let paddleId = "";
const tokens = new Map<string, string>();

async function sessionFor(personId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    id: newId(),
    personId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

function as(personId: string): void {
  sessionToken = tokens.get(personId) ?? "";
}

beforeAll(async () => {
  await requestOtp(db, new DevInboxSender(db), PHONE_OWNER);
  const [code] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, PHONE_OWNER))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, PHONE_OWNER, code?.code ?? "");
  if (!verified.ok) throw new Error("login failed");
  owner = verified.personId;
  const org = await createOrg(db, owner, `Gateway Org ${RUN}`);
  orgId = org.id;
  const season = await createCompetition(db, orgId, owner, {
    sport: "cricket",
    location: "Pune",
    startsOn: "2026-08-01",
    endsOn: "2026-09-01",
    name: `Gateway Night ${RUN}`,
  });
  slug = season.slug;

  await db.insert(people).values({ id: auctioneer, phone: `+9194${RUN}1`, name: "Hired Host" });
  await db.insert(orgMembers).values({ orgId, personId: auctioneer });
  const assigned = await assignAuctioneer(db, {
    orgId,
    competitionId: season.id,
    personId: auctioneer,
    actorId: owner,
  });
  if (!assigned.ok) throw new Error(`appointment failed: ${assigned.reason}`);

  // One team, its paddle in the OWNER's hand — the purse the auctioneer must
  // never be able to spend.
  const teamId = newId();
  await db.insert(teams).values({
    id: teamId,
    orgId,
    competitionId: season.id,
    name: "Arrows",
    createdBy: owner,
  });
  const auctionId = newId();
  await db.insert(auctions).values({
    id: auctionId,
    orgId,
    competitionId: season.id,
    name: `Gateway Night ${RUN}`,
    config: {},
    createdBy: owner,
  });
  paddleId = newId();
  await db.insert(paddles).values({
    id: paddleId,
    orgId,
    auctionId,
    teamId,
    personId: owner,
    paddleNumber: "P1",
  });

  tokens.set(owner, await sessionFor(owner));
  tokens.set(auctioneer, await sessionFor(auctioneer));
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  if (orgId !== "") await purgeOrg(db, orgId);
  await db.delete(sessions).where(inArray(sessions.personId, [owner, auctioneer]));
  await db.delete(people).where(inArray(people.id, [auctioneer, owner]));
  await db.delete(otpCodes).where(eq(otpCodes.phone, PHONE_OWNER));
  await db.delete(otpInbox).where(eq(otpInbox.phone, PHONE_OWNER));
  await handle.sql.end();
});

describe("P0-5 — an appointed auctioneer never bids with a team's paddle", () => {
  it("refuses the auctioneer's bid with the owner's paddle before it reaches the engine", async () => {
    as(auctioneer);
    const ack = await submitAuctionCommand(slug, newId(), "PlaceBid", {
      lotId: newId(),
      paddleId,
      amountRaw: 1_000_000,
    });
    expect(ack).toMatchObject({ accepted: false, reason: "not_authorized" });
    expect(sent, "the bid left the web tier").toEqual([]);
  });

  it("refuses the auctioneer withdrawing an owner link — minting one was never theirs", async () => {
    as(auctioneer);
    const ack = await submitAuctionCommand(slug, newId(), "RevokeOwnerInvite", {
      inviteId: newId(),
    });
    expect(ack).toMatchObject({ accepted: false, reason: "not_authorized" });
    expect(sent).toEqual([]);
  });

  it("still forwards the auctioneer's conduct — and tells the engine they do not manage", async () => {
    as(auctioneer);
    const ack = await submitAuctionCommand(slug, newId(), "OpenLot", { lotId: newId() });
    expect(ack.accepted).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "OpenLot", conduct: true, manage: false });
  });

  it("forwards the owner's bid with manage, so the engine can honour manual mode", async () => {
    as(owner);
    const ack = await submitAuctionCommand(slug, newId(), "PlaceBid", {
      lotId: newId(),
      paddleId,
      amountRaw: 1_000_000,
    });
    expect(ack.accepted).toBe(true);
    expect(sent[0]).toMatchObject({ type: "PlaceBid", conduct: true, manage: true });
  });
});
