/**
 * RUNTIME POSTURE — /admin/people (AC-1.2), under the production roles.
 *
 * Every button, driven through its server action exactly as the browser calls
 * it: platform grants written on `desiauction_system` (the only role RLS lets
 * write one), people / sessions / invitations on `desiauction_app`, each with
 * its audit row. And the guards that matter: no step-up, no action; no
 * suspending yourself or a superadmin; superadmin is not grantable here; a
 * suspended person's session stops on the next request; an invitation waits
 * for a PROVEN contact and becomes a grant at sign-in.
 */
import { createHash, randomBytes } from "node:crypto";

import {
  auditLog,
  createDb,
  grants,
  newId,
  people,
  platformInvites,
  sessions,
} from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "da_session" && sessionToken !== "" ? { value: sessionToken } : undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
}));

const actions = await import("../server/platform-ops/people-actions");
const { applyPlatformInvites } = await import("../server/platform-ops/people");
const { getSessionByToken } = await import("../server/auth/sessions");
const { db, systemDb } = await import("../server/db");

const ownerHandle = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const owner = ownerHandle.db;

const RUN = String(Date.now()).slice(-6);
const phoneOf = (n: number): string => `+918${RUN}${String(n).padStart(3, "0")}`;
const ids: string[] = [];
let superadmin = "";
let other = "";
let target = "";
let targetToken = "";

const REASON = "Posture proof of the admin people desk";

async function person(name: string, n: number): Promise<string> {
  const id = newId();
  await ownerHandle.sql`insert into people (id, name, phone) values (${id}, ${name}, ${phoneOf(n)})`;
  ids.push(id);
  return id;
}

async function sessionFor(personId: string, steppedUp: boolean): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await owner.insert(sessions).values({
    id: newId(),
    personId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    steppedUpAt: steppedUp ? new Date() : null,
  });
  return token;
}

async function holds(personId: string, set: string): Promise<boolean> {
  const rows = await owner
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(eq(grants.personId, personId), eq(grants.capabilitySet, set), isNull(grants.revokedAt)),
    );
  return rows.length > 0;
}

beforeAll(async () => {
  superadmin = await person("Super Admin", 1);
  other = await person("Other Superadmin", 2);
  target = await person("Target Person", 3);
  for (const id of [superadmin, other]) {
    await owner.insert(grants).values({
      id: newId(),
      personId: id,
      scopeType: "platform",
      scopeId: "00000000000000000000000000",
      capabilitySet: "platform:superadmin",
      grantedBy: id,
    });
  }
  targetToken = await sessionFor(target, false);
});

afterAll(async () => {
  for (const id of ids) {
    await ownerHandle.sql`delete from platform_invites where invited_by = ${id} or accepted_by = ${id}`;
  }
  for (const id of ids) {
    await ownerHandle.sql`delete from grants where person_id = ${id}`;
    await ownerHandle.sql`delete from sessions where person_id = ${id}`;
    await ownerHandle.sql`delete from audit_log where actor = ${id} or subject = ${id}`;
    await ownerHandle.sql`update people set suspended_by = null where suspended_by = ${id}`;
  }
  for (const id of ids) {
    await ownerHandle.sql`delete from people where id = ${id}`;
  }
  await ownerHandle.sql.end();
});

describe("/admin/people under the production roles", () => {
  it("nothing happens without a fresh step-up", async () => {
    sessionToken = await sessionFor(superadmin, false);
    expect(await actions.grantRoleAction(target, "platform:support", REASON)).toMatchObject({
      ok: false,
      stepUp: true,
    });
    expect(await holds(target, "platform:support")).toBe(false);
  });

  it("grants and revokes a platform role — the grant written on desiauction_system", async () => {
    sessionToken = await sessionFor(superadmin, true);
    expect(await actions.grantRoleAction(target, "platform:support", REASON)).toMatchObject({
      ok: true,
    });
    expect(await holds(target, "platform:support")).toBe(true);
    // Twice is once.
    expect(await actions.grantRoleAction(target, "platform:support", REASON)).toMatchObject({
      ok: true,
    });
    const audit = await owner
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.actor, superadmin), eq(auditLog.subject, target)));
    expect(audit.filter((row) => row.action === "grant.issued")).toHaveLength(1);
    expect(await actions.revokeRoleAction(target, "platform:support", REASON)).toMatchObject({
      ok: true,
    });
    expect(await holds(target, "platform:support")).toBe(false);
  });

  it("superadmin is the seed's alone", async () => {
    expect(await actions.grantRoleAction(target, "platform:superadmin", REASON)).toMatchObject({
      ok: false,
    });
    expect(await actions.revokeRoleAction(other, "platform:superadmin", REASON)).toMatchObject({
      ok: false,
    });
    expect(await holds(other, "platform:superadmin")).toBe(true);
  });

  it("never suspends yourself or a superadmin", async () => {
    expect(await actions.suspendAction(superadmin, REASON)).toMatchObject({ ok: false });
    expect(await actions.suspendAction(other, REASON)).toMatchObject({ ok: false });
  });

  it("a suspension stops the person's session on the very next request", async () => {
    expect(await getSessionByToken(db, targetToken)).not.toBeNull();
    expect(await actions.suspendAction(target, REASON)).toMatchObject({ ok: true });
    expect(await getSessionByToken(db, targetToken)).toBeNull();
    const [row] = await owner
      .select({ at: people.suspendedAt, by: people.suspendedBy, why: people.suspendedReason })
      .from(people)
      .where(eq(people.id, target));
    expect(row).toMatchObject({ by: superadmin, why: REASON });
    expect(await actions.unsuspendAction(target, REASON)).toMatchObject({ ok: true });
    // The old devices stay signed out: lifting a suspension wakes nothing up.
    expect(await getSessionByToken(db, targetToken)).toBeNull();
  });

  it("signs a person out everywhere", async () => {
    const fresh = await sessionFor(target, false);
    expect(await getSessionByToken(db, fresh)).not.toBeNull();
    expect(await actions.signOutEverywhereAction(target, REASON)).toMatchObject({ ok: true });
    expect(await getSessionByToken(db, fresh)).toBeNull();
  });

  it("an invitation waits for a proven contact, then becomes the grant", async () => {
    const invitee = phoneOf(9);
    expect(
      await actions.invitePersonAction({
        contact: invitee,
        name: "New Desk Person",
        sets: ["platform:support", "platform:moderation"],
        reason: REASON,
      }),
    ).toMatchObject({ ok: true });
    const [invite] = await owner
      .select({ id: platformInvites.id })
      .from(platformInvites)
      .where(eq(platformInvites.phone, invitee));
    expect(invite).toBeDefined();
    // Their first sign-in with that phone (what verifyOtp would create).
    const newcomer = await person("New Desk Person", 9);
    expect(await applyPlatformInvites(db, systemDb, newcomer)).toBe(1);
    expect(await holds(newcomer, "platform:support")).toBe(true);
    expect(await holds(newcomer, "platform:moderation")).toBe(true);
    // Once only.
    expect(await applyPlatformInvites(db, systemDb, newcomer)).toBe(0);
  });

  it("a waiting invitation can be cancelled, and then never applies", async () => {
    const contact = phoneOf(7);
    expect(
      await actions.invitePersonAction({
        contact,
        name: "Mistyped Person",
        sets: ["platform:admin"],
        reason: REASON,
      }),
    ).toMatchObject({ ok: true });
    const [invite] = await owner
      .select({ id: platformInvites.id })
      .from(platformInvites)
      .where(eq(platformInvites.phone, contact));
    expect(await actions.cancelInviteAction(invite?.id ?? "", REASON)).toMatchObject({
      ok: true,
    });
    const stranger = await person("Mailbox Owner", 7);
    expect(await applyPlatformInvites(db, systemDb, stranger)).toBe(0);
    expect(await holds(stranger, "platform:admin")).toBe(false);
  });

  it("another superadmin can't be signed out from here", async () => {
    expect(await actions.signOutEverywhereAction(other, REASON)).toMatchObject({ ok: false });
  });

  it("someone already on DesiAuction gets the role at once", async () => {
    expect(
      await actions.invitePersonAction({
        contact: phoneOf(3),
        name: "Target Person",
        sets: ["platform:demo"],
        reason: REASON,
      }),
    ).toMatchObject({ ok: true });
    expect(await holds(target, "platform:demo")).toBe(true);
  });
});
