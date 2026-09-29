import { auditLog, type Db } from "@desiauction/db";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

/**
 * HOW MUCH INVITATION MAIL ONE PERSON MAY SEND (PRR 2026-09-29).
 *
 * "Email this link" sends a message from this platform's domain to ANY address
 * the organizer types — that is the feature — and it had no ceiling of any
 * kind. One live invite could be mailed any number of times to any number of
 * strangers, and the club's name (which the sender chooses) is in the subject.
 * Anybody can make a club, so anybody could use the product as a relay for
 * mail with their own words on it and our reputation behind it.
 *
 * Two ceilings, both counted from the audit rows these actions already write,
 * so a restart cannot reset them and there is nothing new to store:
 *
 *   · per PERSON, per hour, across every club they belong to — twenty is a
 *     whole league's worth of team owners in one sitting;
 *   · per INVITE, for its life — a link that has been mailed five times has
 *     reached whoever it was for.
 *
 * Over either, Copy link still works: the organizer loses the convenience, not
 * the ability to invite.
 */
export const INVITE_MAILS_PER_PERSON_PER_HOUR = 20;
export const INVITE_MAILS_PER_INVITE = 5;

/** Longer than any invite lives (seven days), with a day to spare. */
const INVITE_LIFETIME_MS = 8 * 24 * 60 * 60 * 1000;

/** The audit actions an emailed invite is recorded under. */
const INVITE_MAIL_ACTIONS = ["invite.emailed", "auction.owner_invite_emailed"];

export type InviteMailBudget = "ok" | "busy" | "person-limit" | "invite-limit";

/**
 * Ask before sending; the caller writes the audit row after a send that
 * succeeded, INSIDE the transaction `lockDb` belongs to.
 *
 * `lockDb` must be a transaction: the lock taken here is transaction-scoped and
 * is what makes the count exact — it is released at the same commit that makes
 * the caller's audit row visible, so a second send by the same person always
 * counts the first. It is a TRY-lock: a second request while one is in flight
 * is refused at once rather than queued, because a queue here is a way to hold
 * database connections open with a script.
 *
 * `countDb` is the pool that can see this person's rows in EVERY club (audit
 * rows are tenant-scoped, and a ceiling that reset per club would be one more
 * club away from meaningless).
 */
export async function claimInviteMailBudget(
  lockDb: Db,
  countDb: Db,
  input: { actor: string; orgId: string; inviteId: string; now?: Date },
): Promise<InviteMailBudget> {
  const [lock] = (await lockDb.execute(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${`invite-mail:${input.actor}`}, 0)) as held`,
  )) as unknown as [{ held: boolean }];
  if (!lock.held) {
    return "busy";
  }
  const now = (input.now ?? new Date()).getTime();
  const since = new Date(now - 60 * 60 * 1000);
  const [byPerson] = (await countDb
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actor, input.actor),
        inArray(auditLog.action, INVITE_MAIL_ACTIONS),
        gt(auditLog.at, since),
      ),
    )) as [{ count: number }];
  if (byPerson.count >= INVITE_MAILS_PER_PERSON_PER_HOUR) {
    return "person-limit";
  }
  const [byInvite] = (await countDb
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(
      and(
        // The club and a window first: both are what the index can seek on
        // (scope_id, at), and an invite lives seven days, so nothing it was
        // ever mailed for is older than this.
        eq(auditLog.scopeId, input.orgId),
        gt(auditLog.at, new Date(now - INVITE_LIFETIME_MS)),
        eq(auditLog.subject, input.inviteId),
        inArray(auditLog.action, INVITE_MAIL_ACTIONS),
      ),
    )) as [{ count: number }];
  if (byInvite.count >= INVITE_MAILS_PER_INVITE) {
    return "invite-limit";
  }
  return "ok";
}

/** What the organizer is told; the way forward is always the link itself. */
export function inviteMailRefusal(budget: Exclude<InviteMailBudget, "ok">): string {
  if (budget === "busy") {
    return "That email is still sending. Give it a moment.";
  }
  if (budget === "invite-limit") {
    return "This link has been emailed a few times already. Copy it and send it yourself.";
  }
  return "That's a lot of invitations in one hour. Copy the link and send it yourself, or email it later.";
}
