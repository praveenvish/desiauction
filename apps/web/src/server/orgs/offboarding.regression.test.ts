// Offboarding + last-owner protection. Real Postgres, same shape as the
// authorization regression suite next door.
//
// Two things had no coverage because neither existed: taking a person OUT of an
// organization (the product only ever demoted them to a member who still read
// the directory and the finance feed), and refusing the revocation that leaves
// a club with no owner at all.
import {
  auditLog,
  createDb,
  grants as grantsTable,
  invites as invitesTable,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  sessions,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { can } from "./authz";
import {
  createOrg,
  holdersOf,
  memberCountOf,
  membersOf,
  issueGrant,
  lastOwnerRefuses,
  removeMember,
  revokeGrants,
  wouldOrphanOrg,
} from "./orgs";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9194${RUN}1`;
const PHONE_SECOND = `+9195${RUN}2`;
const TEST_PHONES = [PHONE_OWNER, PHONE_SECOND];

let owner = "";
let second = "";
let org = { id: "", name: "", slug: "" };

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, phone, row?.code ?? "");
  if (!verified.ok) {
    throw new Error("login failed");
  }
  return verified.personId;
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  second = await login(PHONE_SECOND);
  org = await createOrg(db, owner, `Offboard ${RUN}`);
  await db.insert(orgMembers).values({ orgId: org.id, personId: second });
  await issueGrant(db, org.id, second, "org:staff", owner);
});

afterAll(async () => {
  // PA-1R Phase 3: the spine this teardown never deleted (see purge-org.ts).
  await purgeOrg(db, org.id);
  const ids = [owner, second].filter((id) => id !== "");
  if (org.id !== "") {
    await db.delete(invitesTable).where(eq(invitesTable.orgId, org.id));
    await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
    await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
    await db.delete(auditLog).where(inArray(auditLog.scopeId, [org.id, ...ids]));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  if (ids.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, ids));
    await db.delete(people).where(inArray(people.id, ids));
  }
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await handle.sql.end();
});

describe("last-owner protection", () => {
  it("refuses the revocation that would leave the club ownerless", () => {
    expect(wouldOrphanOrg([owner], owner)).toBe(true);
    expect(wouldOrphanOrg([], owner)).toBe(false);
  });

  it("allows it while a second owner still holds the club", () => {
    expect(wouldOrphanOrg([owner, second], owner)).toBe(false);
    expect(wouldOrphanOrg([owner, second], second)).toBe(false);
  });

  it("reads the sole owner the guard keys off, from the live org", async () => {
    const owners = await holdersOf(db, org.id, "org:owner");
    expect(owners).toEqual([owner]);
    expect(wouldOrphanOrg(owners, owner)).toBe(true);
  });
});

describe("member grants carry their provenance", () => {
  it("names who granted the role and when", async () => {
    const rows = await membersOf(db, org.id);
    const staffRow = rows.find((row) => row.personId === second);
    const staffGrant = staffRow?.roles.find((role) => role.capabilitySet === "org:staff");
    expect(staffGrant?.grantedBy).toBe(owner);
    expect(staffGrant?.grantedAt).not.toBeNull();
  });
});

describe("removing a member", () => {
  it("revokes every grant, deletes the membership, and records the act", async () => {
    expect(await memberCountOf(db, org.id)).toBe(2);
    // Before: a real member with a real capability.
    expect(await can(db, second, { scopeType: "org", scopeId: org.id }, "team.manage")).toBe(true);

    await removeMember(db, org.id, second, owner);

    expect(await memberCountOf(db, org.id)).toBe(1);
    expect((await membersOf(db, org.id)).map((row) => row.personId)).toEqual([owner]);
    // The capability is gone with the membership — "Remove staff" alone used to
    // leave the person a member who still read the directory.
    expect(await can(db, second, { scopeType: "org", scopeId: org.id }, "team.manage")).toBe(false);
    const live = await db
      .select({ id: grantsTable.id })
      .from(grantsTable)
      .where(
        and(
          eq(grantsTable.scopeId, org.id),
          eq(grantsTable.personId, second),
          isNull(grantsTable.revokedAt),
        ),
      );
    expect(live).toEqual([]);
    const [entry] = await db
      .select({ action: auditLog.action, subject: auditLog.subject, actor: auditLog.actor })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, org.id), eq(auditLog.action, "org.members.removed")))
      .limit(1);
    expect(entry).toEqual({ action: "org.members.removed", subject: second, actor: owner });
  });

  it("leaves the remaining owner intact, so the club is still governable", async () => {
    expect(await holdersOf(db, org.id, "org:owner")).toEqual([owner]);
    expect(await can(db, owner, { scopeType: "org", scopeId: org.id }, "grant.issue")).toBe(true);
  });
});

/**
 * TWO OWNERS REVOKING EACH OTHER AT ONCE (audit P3).
 *
 * The guard used to be a plain read: each transaction counted two owners,
 * each passed, each revoked the other, and the club committed with none — the
 * one state no action can repair. The count now locks the owner grants, so the
 * second transaction waits for the first and re-reads a single owner.
 *
 * The pause inside the first transaction is what makes the race real: it
 * holds its answer open while the second one asks the same question.
 */
describe("last-owner protection under concurrency", () => {
  it("lets exactly one of two mutual revocations through", async () => {
    await db.insert(orgMembers).values({ orgId: org.id, personId: second }).onConflictDoNothing();
    await issueGrant(db, org.id, second, "org:owner", owner);
    expect((await holdersOf(db, org.id, "org:owner")).sort()).toEqual([owner, second].sort());

    const revoke = (actor: string, target: string, pauseMs: number) =>
      db.transaction(async (tx) => {
        if (await lastOwnerRefuses(tx, org.id, target)) {
          return "refused" as const;
        }
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
        await revokeGrants(tx, org.id, target, "org:owner", actor);
        return "revoked" as const;
      });
    const outcomes = await Promise.all([revoke(owner, second, 300), revoke(second, owner, 0)]);

    expect(outcomes.filter((outcome) => outcome === "revoked")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "refused")).toHaveLength(1);
    expect(await holdersOf(db, org.id, "org:owner")).toHaveLength(1);
  });
});
