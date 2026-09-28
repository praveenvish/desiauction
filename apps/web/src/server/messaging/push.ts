import { newId, pushSubscriptions, withTenantDb, type Db } from "@desiauction/db";
import { NOTIFICATIONS } from "@desiauction/messaging/catalogue";
import { sendWebPush, type PushTransport, type VapidKeys } from "@desiauction/messaging/web-push";
import { and, eq } from "drizzle-orm";

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

/** Push one inbox notice to every device of this person. Never throws. */
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
  try {
    const run = async (db: Db) => {
      // The person's Inbox switch, and the platform's in-app switch, decide.
      const hidden = await hiddenInboxActions(db, personId);
      if (inboxExclusions(hidden).includes(action)) {
        return { sent: 0, gone: 0 };
      }
      const devices = await db
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.personId, personId));
      if (devices.length === 0) {
        return { sent: 0, gone: 0 };
      }
      const notice = pushNoticeFor(action, meta);
      let sent = 0;
      let gone = 0;
      for (const device of devices) {
        const outcome = await sendWebPush(device, notice, keys, {
          ...(options.transport === undefined ? {} : { transport: options.transport }),
        });
        if (outcome === "sent") {
          sent += 1;
          await db
            .update(pushSubscriptions)
            .set({ lastSentAt: new Date() })
            .where(eq(pushSubscriptions.id, device.id));
        } else if (outcome === "gone") {
          gone += 1;
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
        }
      }
      return { sent, gone };
    };
    return options.db === undefined
      ? await withTenantDb(dbHandle, { personId }, run)
      : await run(options.db);
  } catch (error) {
    logger().warn({ err: error, action }, "push.failed");
    return { sent: 0, gone: 0 };
  }
}

/** Keep a browser's subscription — its endpoint is its identity, so a repeat updates. */
export async function savePushSubscription(
  db: Db,
  personId: string,
  subscription: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
): Promise<void> {
  await db
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
    });
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
