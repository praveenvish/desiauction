"use server";

import { people } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { after } from "next/server";

import { db, systemDb } from "../db";
import { operatorFor, type OperatorRefusal } from "./guard";
import {
  ROLE_WORDS,
  cancelPlatformInvite,
  grantPlatformRole,
  invitePerson,
  isGrantable,
  revokePlatformRole,
  signOutEverywhere,
  suspendPerson,
  tellPerson,
  unsuspendPerson,
} from "./people";

/*
 * THE /admin/people BUTTONS (AC-1.2). Every one is the superadmin's
 * (`platform.grant`) and passes `operatorFor` first: capability, a written
 * reason, and a step-up code on this session in the last ten minutes. A
 * `stepUp` answer opens "Confirm it's you" in the browser (useStepUp), which
 * runs the same action again. The person affected is emailed AFTER the
 * response, so a slow mail provider never holds the screen.
 */

export type PeopleActionResult = { ok: true; message: string } | OperatorRefusal;

async function nameOf(personId: string): Promise<string> {
  const [row] = await db
    .select({ name: people.name })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  return row?.name ?? "this person";
}

export async function grantRoleAction(
  personId: string,
  set: string,
  reason: string,
): Promise<PeopleActionResult> {
  const gate = await operatorFor("platform.grant", { reason });
  if (!gate.ok) {
    return gate;
  }
  const result = await grantPlatformRole(systemDb, {
    operator: gate.operator.personId,
    personId,
    set,
    reason: gate.operator.reason,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const role = isGrantable(set) ? ROLE_WORDS[set] : set;
  if (result.changed) {
    after(() => tellPerson(db, { personId }, "role_granted", { name: "", role, reason }));
  }
  return {
    ok: true,
    message: result.changed
      ? `${await nameOf(personId)} now has ${role}.`
      : `${await nameOf(personId)} already had ${role}.`,
  };
}

export async function revokeRoleAction(
  personId: string,
  set: string,
  reason: string,
): Promise<PeopleActionResult> {
  const gate = await operatorFor("platform.grant", { reason });
  if (!gate.ok) {
    return gate;
  }
  const result = await revokePlatformRole(systemDb, {
    operator: gate.operator.personId,
    personId,
    set,
    reason: gate.operator.reason,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const role = isGrantable(set) ? ROLE_WORDS[set] : set;
  if (result.changed) {
    after(() => tellPerson(db, { personId }, "role_revoked", { name: "", role, reason }));
  }
  return {
    ok: true,
    message: result.changed
      ? `${role} was removed from ${await nameOf(personId)}.`
      : `${await nameOf(personId)} didn't have ${role}.`,
  };
}

export async function suspendAction(personId: string, reason: string): Promise<PeopleActionResult> {
  const gate = await operatorFor("platform.grant", { reason });
  if (!gate.ok) {
    return gate;
  }
  const result = await suspendPerson(db, systemDb, {
    operator: gate.operator.personId,
    personId,
    reason: gate.operator.reason,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  after(() => tellPerson(db, { personId }, "suspended", { name: "", reason }));
  return {
    ok: true,
    message: `${await nameOf(personId)} is suspended and was signed out of ${String(result.signedOut)} device${result.signedOut === 1 ? "" : "s"}.`,
  };
}

export async function unsuspendAction(
  personId: string,
  reason: string,
): Promise<PeopleActionResult> {
  const gate = await operatorFor("platform.grant", { reason });
  if (!gate.ok) {
    return gate;
  }
  const result = await unsuspendPerson(db, systemDb, {
    operator: gate.operator.personId,
    personId,
    reason: gate.operator.reason,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  after(() => tellPerson(db, { personId }, "unsuspended", { name: "", reason }));
  return { ok: true, message: `${await nameOf(personId)} can sign in again.` };
}

export async function signOutEverywhereAction(
  personId: string,
  reason: string,
): Promise<PeopleActionResult> {
  const gate = await operatorFor("platform.grant", { reason });
  if (!gate.ok) {
    return gate;
  }
  const result = await signOutEverywhere(db, systemDb, {
    operator: gate.operator.personId,
    personId,
    reason: gate.operator.reason,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  after(() => tellPerson(db, { personId }, "signed_out", { name: "", reason }));
  return {
    ok: true,
    message: `${await nameOf(personId)} was signed out of ${String(result.signedOut)} device${result.signedOut === 1 ? "" : "s"}.`,
  };
}

export async function invitePersonAction(input: {
  contact: string;
  name: string;
  sets: string[];
  reason: string;
}): Promise<PeopleActionResult> {
  const gate = await operatorFor("platform.grant", { reason: input.reason });
  if (!gate.ok) {
    return gate;
  }
  const result = await invitePerson(db, systemDb, {
    operator: gate.operator.personId,
    contact: input.contact,
    name: input.name,
    sets: input.sets,
    reason: gate.operator.reason,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const roles = input.sets
    .filter(isGrantable)
    .map((set) => ROLE_WORDS[set])
    .join(", ");
  if (result.outcome === "granted_now") {
    after(() =>
      tellPerson(db, { personId: result.personId }, "role_granted", {
        name: input.name,
        role: roles,
        reason: input.reason,
      }),
    );
    return {
      ok: true,
      message: `${input.name.trim()} is already on DesiAuction — they have ${roles} now.`,
    };
  }
  const email = input.contact.includes("@") ? input.contact.trim() : null;
  if (email !== null) {
    after(() =>
      tellPerson(db, { email }, "invited", { name: input.name, role: roles, reason: input.reason }),
    );
  }
  return {
    ok: true,
    message: `Invitation saved. ${input.name.trim()} gets ${roles} the first time they sign in with ${input.contact.trim()} (within 14 days).`,
  };
}

export async function cancelInviteAction(
  inviteId: string,
  reason: string,
): Promise<PeopleActionResult> {
  const gate = await operatorFor("platform.grant", { reason });
  if (!gate.ok) {
    return gate;
  }
  const result = await cancelPlatformInvite(db, systemDb, {
    operator: gate.operator.personId,
    inviteId,
    reason: gate.operator.reason,
  });
  return result.ok ? { ok: true, message: "Invitation cancelled." } : result;
}
