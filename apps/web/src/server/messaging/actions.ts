"use server";

import { revalidatePath } from "next/cache";

import { withTenantDb } from "@desiauction/db";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { ForbiddenError, can, requireCapability } from "../orgs/authz";
import { resolveTenant } from "../orgs/orgs";
import {
  NOTIFICATION_TOPICS,
  orgMessagingSettingsFor,
  preferencesFor,
  setOrgMessagingSetting,
  setPreference,
} from "./consent";

/** Membership-checked slug → org, under person-only tenant context. */
async function resolveTenantScoped(personId: string, slug: string) {
  return withTenantDb(dbHandle, { personId }, (db) => resolveTenant(db, personId, slug));
}

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

/**
 * THE CLUB'S SWITCHES, which are a different thing from the person's.
 *
 * Tenant-scoped, on the org's own handle and behind `org.manage`, because these
 * rows carry row level security and belong to the club. The person's
 * preferences above deliberately do not: they are read on `systemDb` and a club
 * can neither see nor change them.
 *
 * What an organizer can do here is stop their club sending a topic. What they
 * cannot do is start one for somebody who stopped it — `maySend` reads the
 * person's answer first and returns before it ever looks at these rows.
 */

export interface OrgMessagingSettings {
  readonly canManage: boolean;
  readonly topics: readonly { topic: string; label: string; detail: string; enabled: boolean }[];
}

export async function orgMessagingSettingsView(slug: string): Promise<OrgMessagingSettings | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
    const canManage = await can(
      db,
      session.personId,
      { scopeType: "org", scopeId: org.id },
      "org.manage",
    );
    const current = await orgMessagingSettingsFor(db, org.id, "sms");
    return {
      canManage,
      topics: NOTIFICATION_TOPICS.map((entry) => ({
        topic: entry.topic,
        label: entry.label,
        detail: entry.detail,
        enabled: current[entry.topic] ?? true,
      })),
    };
  });
}

export async function setOrgMessagingSettingAction(
  slug: string,
  topic: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Sign in to change this." };
  }
  if (!NOTIFICATION_TOPICS.some((entry) => entry.topic === topic)) {
    // An unpublished topic would write a row `maySend` never reads for it, so
    // the switch would look like it worked and change nothing.
    return { ok: false, error: "That is not a notification you can change." };
  }
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
      await requireCapability(
        db,
        session.personId,
        { scopeType: "org", scopeId: org.id },
        "org.manage",
      );
      await setOrgMessagingSetting(db, {
        orgId: org.id,
        topic,
        channel: "sms",
        enabled,
        actorId: session.personId,
      });
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You can't change this organization's messaging." };
    }
    return { ok: false, error: "Could not save." };
  }
  revalidatePath(`/org/${slug}`);
  return { ok: true };
}
