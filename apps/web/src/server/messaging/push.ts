import { newId, pushSubscriptions, withTenantDb, type Db } from "@desiauction/db";
import { NOTIFICATIONS } from "@desiauction/messaging/catalogue";
import {
  sendWebPush,
  type PushOutcome,
  type PushTransport,
  type VapidKeys,
} from "@desiauction/messaging/web-push";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { env } from "../../env";
import { detailOf, labelForEvent } from "../../lib/inbox-events";
import { inboxExclusions } from "../auth/inbox-filter";
import { dbHandle } from "../db";
import { logger } from "../logger";
import { hiddenInboxActions } from "./gate";

/**
 * WEB PUSH — THE INBOX NOTICE, ON THE DEVICE (email programme PR18).
 *
 * A push is not a channel of its own: it is the inbox row, delivered to every
 * browser the person turned notifications on in. So it follows the person's
 * Inbox switches (a topic hidden from the inbox is not pushed either) and the
 * platform's in-app switch, and it carries no more than the inbox row says —
 * the label and its short detail — with /inbox as the door.
 *
 * Only the NOTIFICATION kinds push (the catalogue's in-app rows): a sign-in,
 * a renamed passkey or an updated profile is on the ledger, not news.
 *
 * Best effort and off the request's path: the row is written first and stands
 * whatever becomes of the push; a subscription the push service says is gone
 * (404/410) is deleted, so a dead browser is not tried twice.
 */

/** The audit actions an inbox notice is written under — the ones that push. */
const PUSHABLE: ReadonlySet<string> = new Set(NOTIFICATIONS.flatMap((entry) => entry.inboxKeys));

export function pushKeys(): VapidKeys | null {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = env.WEB_PUSH_PRIVATE_KEY;
  const subject = env.WEB_PUSH_SUBJECT;
  return publicKey === undefined || privateKey === undefined || subject === undefined
    ? null
    : { publicKey, privateKey, subject };
}

export function isPushable(action: string): boolean {
  return PUSHABLE.has(action);
}

export interface PushNotice {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  /** One notification per kind on the device: a newer one replaces it. */
  readonly tag: string;
}

export function pushNoticeFor(action: string, meta: Record<string, string> | null): PushNotice {
  const detail = detailOf(meta);
  return {
    title: "DesiAuction",
    body: detail === null ? labelForEvent(action) : `${labelForEvent(action)} — ${detail}`,
    url: "/inbox",
    tag: action,
  };
}

/**
 * How many browsers one person may hold. A phone, a laptop, a tablet and the
 * office desktop is four; ten is room to spare. It is a bound, not a product
 * rule: every device is one outbound request per notice, so an unbounded list
 * is an amplifier anybody signed in could build for themselves.
 */
export const MAX_DEVICES_PER_PERSON = 10;

interface Device {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * Push one inbox notice to every device of this person. Never throws.
 *
 * THREE STEPS, AND THE NETWORK IS NOT INSIDE A TRANSACTION (PRR 2026-09-29).
 * The devices were read, pushed to one after the other and stamped all inside
 * one `withTenantDb` — so a push service that was slow to answer held a pooled
 * database connection for its whole deadline, once per device, and the pool is
 * ten connections wide. Now: read (database), send (network, all devices at
 * once), record (database). No connection is held while anything waits on a
 * third party.
 */
export async function pushInboxNotice(
  personId: string,
  action: string,
  meta: Record<string, string> | null,
  options: { keys?: VapidKeys | null; transport?: PushTransport; db?: Db } = {},
): Promise<{ sent: number; gone: number }> {
  const keys = options.keys === undefined ? pushKeys() : options.keys;
  if (keys === null || !isPushable(action)) {
    return { sent: 0, gone: 0 };
  }
  const inDb = <T>(run: (db: Db) => Promise<T>): Promise<T> =>
    options.db === undefined ? withTenantDb(dbHandle, { personId }, run) : run(options.db);
  try {
    const devices = await inDb(async (db): Promise<Device[]> => {
      // The person's Inbox switch, and the platform's in-app switch, decide.
      const hidden = await hiddenInboxActions(db, personId);
      if (inboxExclusions(hidden).includes(action)) {
        return [];
      }
      return db
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.personId, personId))
        .orderBy(asc(pushSubscriptions.createdAt))
        .limit(MAX_DEVICES_PER_PERSON);
    });
    if (devices.length === 0) {
      return { sent: 0, gone: 0 };
    }
    const notice = pushNoticeFor(action, meta);
    // `sendWebPush` never rejects — a failure is an outcome — so this settles.
    const outcomes: PushOutcome[] = await Promise.all(
      devices.map((device) =>
        sendWebPush(device, notice, keys, {
          ...(options.transport === undefined ? {} : { transport: options.transport }),
        }),
      ),
    );
    const idsWith = (outcome: PushOutcome): string[] =>
      devices.filter((_, index) => outcomes[index] === outcome).map((device) => device.id);
    const sent = idsWith("sent");
    const gone = idsWith("gone");
    if (sent.length > 0 || gone.length > 0) {
      await inDb(async (db) => {
        if (sent.length > 0) {
          await db
            .update(pushSubscriptions)
            .set({ lastSentAt: new Date() })
            .where(inArray(pushSubscriptions.id, sent));
        }
        if (gone.length > 0) {
          await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
        }
      });
    }
    return { sent: sent.length, gone: gone.length };
  } catch (error) {
    logger().warn({ err: error, action }, "push.failed");
    return { sent: 0, gone: 0 };
  }
}

/**
 * Keep a browser's subscription — its endpoint is its identity, so a repeat
 * updates. Answers whether the subscription is now this person's.
 *
 * A REPEAT MAY MOVE THE ROW TO ANOTHER PERSON ONLY WITH THE SAME KEYS. The
 * legitimate case is one browser and two people: A signs out, B signs in and
 * turns notifications on, and the browser hands over the subscription it
 * already had — same endpoint, same keys — so the row must become B's, or A's
 * notices keep arriving on B's screen. What must not work is naming somebody
 * else's endpoint with keys of your own: that took the row (and with it their
 * notifications) on the strength of knowing a URL. The keys are what the
 * browser holds, so the keys are the proof.
 */
export async function savePushSubscription(
  db: Db,
  personId: string,
  subscription: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
): Promise<boolean> {
  const saved = await db
    .insert(pushSubscriptions)
    .values({
      id: newId(),
      personId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      userAgent: subscription.userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        personId,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        userAgent: subscription.userAgent,
      },
      // Raw rather than `or(...)`: drizzle types `or` as possibly undefined,
      // and an absent condition here would mean "always", which is the bug.
      setWhere: sql`${pushSubscriptions.personId} = ${personId} or (${pushSubscriptions.p256dh} = ${subscription.p256dh} and ${pushSubscriptions.auth} = ${subscription.auth})`,
    })
    .returning({ id: pushSubscriptions.id });
  if (saved.length === 0) {
    return false;
  }
  // The browser that was just saved stays, whatever its age — a subscription
  // that moved here from another person keeps the date it was first made, and
  // ordering by date alone deleted it the moment it arrived. Beside it, the
  // newest nine.
  await db.delete(pushSubscriptions).where(
    and(
      eq(pushSubscriptions.personId, personId),
      sql`${pushSubscriptions.endpoint} <> ${subscription.endpoint}`,
      sql`${pushSubscriptions.id} not in (
        select id from push_subscriptions
        where person_id = ${personId} and endpoint <> ${subscription.endpoint}
        order by created_at desc, id desc
        limit ${MAX_DEVICES_PER_PERSON - 1}
      )`,
    ),
  );
  return true;
}

export async function removePushSubscription(
  db: Db,
  personId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.personId, personId), eq(pushSubscriptions.endpoint, endpoint)));
}
