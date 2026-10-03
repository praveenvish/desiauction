import {
  auditLog,
  grants,
  newId,
  people,
  platformInvites,
  sessions,
  type Db,
} from "@desiauction/db";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";

import {
  GRANTABLE_PLATFORM_SETS,
  PLATFORM_SCOPE_ID,
  PLATFORM_SCOPE_TYPE,
  type PlatformCapabilitySet,
} from "../admin/capabilities";
import { parseGrantTarget } from "../admin/grant-target";
import { logger } from "../logger";
import { languageForMail, sendNotificationMail } from "../messaging/notify";
import { renderNotificationEmail } from "../messaging/notification-email";

/*
 * PEOPLE & PLATFORM ROLES — the writers behind /admin/people (AC-1.2).
 *
 * Called ONLY from `people-actions.ts`, after `operatorFor` has checked the
 * capability, the reason and the step-up. Two pools, each for the one thing it
 * may do:
 *
 * - `app` (desiauction_app): `people`, `sessions` and `platform_invites` —
 *   no RLS on them; app-layer scoping (this module, behind operatorFor) is the
 *   lock, exactly as for the account page's own writes.
 * - `system` (desiauction_system): platform-scoped `grants` and their audit
 *   rows. RLS forbids the app role a platform grant, so this is the only pool
 *   that can write one — the `seed:admin` path, now with a person at the
 *   keyboard and a reason on the record.
 */

export const ROLE_WORDS: Record<PlatformCapabilitySet, string> = {
  "platform:admin": "Admin console",
  "platform:billing": "Billing desk",
  "platform:demo": "Demo desk",
  "platform:privacy": "Privacy desk",
  "platform:support": "Support desk",
  "platform:moderation": "Moderation desk",
  "platform:superadmin": "Superadmin",
};

/** How long an invitation waits for its first sign-in. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function isGrantable(set: string): set is PlatformCapabilitySet {
  return (GRANTABLE_PLATFORM_SETS as readonly string[]).includes(set);
}

type Variant =
  "invited" | "role_granted" | "role_revoked" | "suspended" | "unsuspended" | "signed_out";

/**
 * Tell the person, with the reason. Best effort by design: the change has
 * committed, and a provider outage must never undo or fail it — the attempt
 * and its outcome are recorded in `email_sends` by `sendNotificationMail`.
 * A person with no verified email is told nothing by mail (the audit row and
 * their next visit say it); a code or a link is never in these mails.
 */
export async function tellPerson(
  app: Db,
  who: { personId?: string; email?: string | null },
  variant: Variant,
  vars: { name: string; role?: string; reason: string },
): Promise<void> {
  try {
    let email = who.email ?? null;
    let name = vars.name;
    if (who.personId !== undefined) {
      const [person] = await app
        .select({ email: people.email, verifiedAt: people.emailVerifiedAt, name: people.name })
        .from(people)
        .where(eq(people.id, who.personId))
        .limit(1);
      email = person?.verifiedAt != null ? person.email : null;
      name = person?.name ?? name;
    }
    if (email === null) {
      return;
    }
    const language = await languageForMail(app, {
      personId: who.personId ?? null,
      email,
    });
    await sendNotificationMail(
      app,
      {
        kind: "security.admin_action",
        to: email,
        ...(who.personId === undefined ? {} : { personId: who.personId }),
      },
      await renderNotificationEmail(
        "security.admin_action",
        language,
        { name: firstName(name), role: vars.role ?? "", reason: vars.reason },
        { variant },
      ),
    );
  } catch (error) {
    logger().warn({ err: error, variant }, "platform_ops.notice_failed");
  }
}

function firstName(name: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first === "" ? "there" : first;
}

async function platformAudit(
  system: Db,
  input: { actor: string; action: string; subject: string; meta: Record<string, string> },
): Promise<void> {
  await system.insert(auditLog).values({
    id: newId(),
    actor: input.actor,
    action: input.action,
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    subject: input.subject,
    meta: { domain: "platform", via: "admin", ...input.meta },
  });
}

// --- Grant / revoke ------------------------------------------------------------

export type RoleChange = { ok: true; changed: boolean } | { ok: false; error: string };

export async function grantPlatformRole(
  system: Db,
  input: { operator: string; personId: string; set: string; reason: string },
): Promise<RoleChange> {
  if (!isGrantable(input.set)) {
    return { ok: false, error: "That role can't be given here." };
  }
  const [person] = await system
    .select({ id: people.id, erasedAt: people.erasedAt })
    .from(people)
    .where(eq(people.id, input.personId))
    .limit(1);
  if (person === undefined || person.erasedAt !== null) {
    return { ok: false, error: "That person isn't on DesiAuction." };
  }
  return system.transaction(async (tx) => {
    // Serialise per person and set: two operators granting at once write one row.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`platform-grant:${input.personId}:${input.set}`}, 0))`,
    );
    const [held] = await tx
      .select({ id: grants.id })
      .from(grants)
      .where(
        and(
          eq(grants.personId, input.personId),
          eq(grants.scopeType, PLATFORM_SCOPE_TYPE),
          eq(grants.scopeId, PLATFORM_SCOPE_ID),
          eq(grants.capabilitySet, input.set),
          isNull(grants.revokedAt),
        ),
      )
      .limit(1);
    if (held !== undefined) {
      return { ok: true, changed: false } as const;
    }
    await tx.insert(grants).values({
      id: newId(),
      personId: input.personId,
      scopeType: PLATFORM_SCOPE_TYPE,
      scopeId: PLATFORM_SCOPE_ID,
      capabilitySet: input.set,
      grantedBy: input.operator,
    });
    await platformAudit(tx, {
      actor: input.operator,
      action: "grant.issued",
      subject: input.personId,
      meta: { capabilitySet: input.set, reason: input.reason },
    });
    return { ok: true, changed: true } as const;
  });
}

export async function revokePlatformRole(
  system: Db,
  input: { operator: string; personId: string; set: string; reason: string },
): Promise<RoleChange> {
  // Superadmin is the seed's alone (and its last-holder rule with it).
  if (!isGrantable(input.set)) {
    return { ok: false, error: "That role can't be removed here." };
  }
  const revoked = await system.transaction(async (tx) => {
    const rows = await tx
      .update(grants)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(grants.personId, input.personId),
          eq(grants.scopeType, PLATFORM_SCOPE_TYPE),
          eq(grants.scopeId, PLATFORM_SCOPE_ID),
          eq(grants.capabilitySet, input.set),
          isNull(grants.revokedAt),
        ),
      )
      .returning({ id: grants.id });
    if (rows.length > 0) {
      await platformAudit(tx, {
        actor: input.operator,
        action: "grant.revoked",
        subject: input.personId,
        meta: { capabilitySet: input.set, reason: input.reason },
      });
    }
    return rows.length > 0;
  });
  return { ok: true, changed: revoked };
}

// --- Suspend / unsuspend / sign out everywhere -------------------------------------

async function isSuperadmin(db: Db, personId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(
        eq(grants.personId, personId),
        eq(grants.scopeType, PLATFORM_SCOPE_TYPE),
        eq(grants.scopeId, PLATFORM_SCOPE_ID),
        eq(grants.capabilitySet, "platform:superadmin"),
        isNull(grants.revokedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function revokeAllSessions(app: Db, personId: string): Promise<number> {
  const rows = await app
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.personId, personId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function suspendPerson(
  app: Db,
  system: Db,
  input: { operator: string; personId: string; reason: string },
): Promise<{ ok: true; signedOut: number } | { ok: false; error: string }> {
  if (input.personId === input.operator) {
    return { ok: false, error: "You can't suspend yourself." };
  }
  // Read on the SYSTEM pool: RLS hides every platform-scoped grant from the
  // app role, so asking there would always answer "not a superadmin".
  if (await isSuperadmin(system, input.personId)) {
    return { ok: false, error: "A superadmin can't be suspended here." };
  }
  const updated = await app
    .update(people)
    .set({ suspendedAt: new Date(), suspendedReason: input.reason, suspendedBy: input.operator })
    .where(and(eq(people.id, input.personId), isNull(people.suspendedAt), isNull(people.erasedAt)))
    .returning({ id: people.id });
  if (updated.length === 0) {
    return { ok: false, error: "That account is already suspended, or isn't on DesiAuction." };
  }
  // The session lookup already refuses a suspended account; revoking as well
  // means lifting the suspension later does not wake the old devices up.
  const signedOut = await revokeAllSessions(app, input.personId);
  await platformAudit(system, {
    actor: input.operator,
    action: "person.suspended",
    subject: input.personId,
    meta: { reason: input.reason, sessionsRevoked: String(signedOut) },
  });
  return { ok: true, signedOut };
}

export async function unsuspendPerson(
  app: Db,
  system: Db,
  input: { operator: string; personId: string; reason: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const updated = await app
    .update(people)
    .set({ suspendedAt: null, suspendedReason: null, suspendedBy: null })
    .where(and(eq(people.id, input.personId), sql`${people.suspendedAt} is not null`))
    .returning({ id: people.id });
  if (updated.length === 0) {
    return { ok: false, error: "That account isn't suspended." };
  }
  // A sign-in that slipped in during the suspension (it passed the check a
  // moment before the suspension committed) must not wake up now.
  await revokeAllSessions(app, input.personId);
  await platformAudit(system, {
    actor: input.operator,
    action: "person.unsuspended",
    subject: input.personId,
    meta: { reason: input.reason },
  });
  return { ok: true };
}

export async function signOutEverywhere(
  app: Db,
  system: Db,
  input: { operator: string; personId: string; reason: string },
): Promise<{ ok: true; signedOut: number } | { ok: false; error: string }> {
  if (input.personId !== input.operator && (await isSuperadmin(system, input.personId))) {
    return { ok: false, error: "Another superadmin can't be signed out from here." };
  }
  const signedOut = await revokeAllSessions(app, input.personId);
  await platformAudit(system, {
    actor: input.operator,
    action: "person.signed_out_everywhere",
    subject: input.personId,
    meta: { reason: input.reason, sessionsRevoked: String(signedOut) },
  });
  return { ok: true, signedOut };
}

// --- Invitations ---------------------------------------------------------------------

export type InviteResult =
  | { ok: true; outcome: "granted_now"; personId: string }
  | { ok: true; outcome: "invited"; inviteId: string }
  | { ok: false; error: string };

/**
 * Invite by phone or email. Someone ALREADY on DesiAuction with that verified
 * contact gets the roles now; anyone else gets an invitation that waits for
 * their first sign-in on that contact (`applyPlatformInvites`). Nothing is
 * created for a person who has not proved the contact is theirs.
 */
export async function invitePerson(
  app: Db,
  system: Db,
  input: { operator: string; contact: string; name: string; sets: string[]; reason: string },
): Promise<InviteResult> {
  const target = parseGrantTarget(input.contact);
  if (target.kind === "invalid") {
    return { ok: false, error: "Enter a 10-digit Indian mobile number or an email address." };
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "Enter their name (2–80 characters)." };
  }
  const sets = [...new Set(input.sets)];
  if (sets.length === 0 || !sets.every(isGrantable)) {
    return { ok: false, error: "Pick at least one role." };
  }
  const [existing] = await app
    .select({ id: people.id })
    .from(people)
    .where(
      target.kind === "phone"
        ? eq(people.phone, target.phone)
        : and(
            sql`lower(${people.email}) = ${target.email}`,
            sql`${people.emailVerifiedAt} is not null`,
          ),
    )
    .limit(1);
  if (existing !== undefined) {
    for (const set of sets) {
      const granted = await grantPlatformRole(system, {
        operator: input.operator,
        personId: existing.id,
        set,
        reason: input.reason,
      });
      if (!granted.ok) {
        return granted;
      }
    }
    return { ok: true, outcome: "granted_now", personId: existing.id };
  }
  const inviteId = newId();
  await app.insert(platformInvites).values({
    id: inviteId,
    ...(target.kind === "phone" ? { phone: target.phone } : { email: target.email }),
    name,
    capabilitySets: sets,
    invitedBy: input.operator,
    reason: input.reason,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  await platformAudit(system, {
    actor: input.operator,
    action: "platform.invite.created",
    subject: inviteId,
    meta: { capabilitySets: sets.join(","), reason: input.reason },
  });
  return { ok: true, outcome: "invited", inviteId };
}

/**
 * At sign-in: turn this person's waiting invitations into grants. Matched on
 * what they just PROVED — the phone a code went to, or a verified email —
 * never on an unverified address. Runs on every sign-in and is a single
 * indexed read when there is nothing to do (the usual case).
 */
export async function applyPlatformInvites(app: Db, system: Db, personId: string): Promise<number> {
  const [person] = await app
    .select({ phone: people.phone, email: people.email, verifiedAt: people.emailVerifiedAt })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (person === undefined) {
    return 0;
  }
  const verifiedEmail = person.verifiedAt !== null ? person.email : null;
  const matches = [
    ...(person.phone === null ? [] : [eq(platformInvites.phone, person.phone)]),
    ...(verifiedEmail === null
      ? []
      : [sql`lower(${platformInvites.email}) = lower(${verifiedEmail})`]),
  ];
  if (matches.length === 0) {
    return 0;
  }
  const waiting = await app
    .select()
    .from(platformInvites)
    .where(
      and(
        or(...matches),
        isNull(platformInvites.acceptedAt),
        isNull(platformInvites.revokedAt),
        gt(platformInvites.expiresAt, new Date()),
      ),
    );
  let applied = 0;
  for (const invite of waiting) {
    // An invitation stands on its inviter's authority: one sent by somebody
    // who is no longer a superadmin is not honoured (it stays waiting, visible
    // on /admin/roles, for a current superadmin to cancel).
    if (!(await isSuperadmin(system, invite.invitedBy))) {
      continue;
    }
    const claimed = await app
      .update(platformInvites)
      .set({ acceptedAt: new Date(), acceptedBy: personId })
      .where(
        and(
          eq(platformInvites.id, invite.id),
          isNull(platformInvites.acceptedAt),
          isNull(platformInvites.revokedAt),
        ),
      )
      .returning({ id: platformInvites.id });
    if (claimed.length === 0) {
      continue;
    }
    try {
      for (const set of invite.capabilitySets) {
        const granted = await grantPlatformRole(system, {
          operator: invite.invitedBy,
          personId,
          set,
          reason: invite.reason,
        });
        if (!granted.ok) {
          throw new Error(granted.error);
        }
      }
    } catch (error) {
      // Not spent unless it took: hand the invitation back so the next
      // sign-in tries again (grants are idempotent, so a partial run is safe).
      await app
        .update(platformInvites)
        .set({ acceptedAt: null, acceptedBy: null })
        .where(eq(platformInvites.id, invite.id));
      throw error;
    }
    applied++;
  }
  return applied;
}

/** Cancel a waiting invitation (a mistyped contact, a change of plan). */
export async function cancelPlatformInvite(
  app: Db,
  system: Db,
  input: { operator: string; inviteId: string; reason: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cancelled = await app
    .update(platformInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(platformInvites.id, input.inviteId),
        isNull(platformInvites.acceptedAt),
        isNull(platformInvites.revokedAt),
      ),
    )
    .returning({ id: platformInvites.id });
  if (cancelled.length === 0) {
    return { ok: false, error: "That invitation was already used or cancelled." };
  }
  await platformAudit(system, {
    actor: input.operator,
    action: "platform.invite.cancelled",
    subject: input.inviteId,
    meta: { reason: input.reason },
  });
  return { ok: true };
}
