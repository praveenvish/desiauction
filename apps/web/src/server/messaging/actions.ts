"use server";

import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { systemDb } from "../db";
import { NOTIFICATION_TOPICS, preferencesFor, setPreference } from "./consent";

/**
 * The person's own notification switches.
 *
 * Person-scoped and cross-org, so `systemDb` rather than a tenant handle —
 * the same pool `/inbox` and the consent gate use. A preference belongs to a
 * human, not to a club, and a club must not be able to read or change it.
 */

export interface NotificationSettings {
  readonly topics: readonly { topic: string; label: string; detail: string; allowed: boolean }[];
}

export async function notificationSettings(): Promise<NotificationSettings | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  const current = await preferencesFor(systemDb, session.personId, "sms");
  return {
    topics: NOTIFICATION_TOPICS.map((entry) => ({
      topic: entry.topic,
      label: entry.label,
      detail: entry.detail,
      allowed: current[entry.topic] ?? true,
    })),
  };
}

export async function setNotificationPreferenceAction(
  topic: string,
  allowed: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Sign in to change your notification settings." };
  }
  // Only the topics we publish. An arbitrary string here would write a row the
  // sender never reads, so the switch would appear to work and change nothing.
  if (!NOTIFICATION_TOPICS.some((entry) => entry.topic === topic)) {
    return { ok: false, error: "That is not a notification you can change." };
  }
  await setPreference(systemDb, {
    personId: session.personId,
    topic,
    channel: "sms",
    allowed,
  });
  revalidatePath("/account");
  return { ok: true };
}
