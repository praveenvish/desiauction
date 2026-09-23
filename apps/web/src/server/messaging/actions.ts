"use server";

import { revalidatePath } from "next/cache";

import { withTenantDb } from "@desiauction/db";

import { currentSession } from "../auth/actions";
import { db as appDb, dbHandle, systemDb } from "../db";
import { parseWhatsAppLanguage, type WhatsAppLanguage } from "../../lib/whatsapp-consent";
import { setWhatsappOptIn, whatsappOptedIn } from "./whatsapp";
import { ForbiddenError, can, requireCapability } from "../orgs/authz";
import { resolveTenant } from "../orgs/orgs";
import { ORG_SWITCH_CHANNELS, PERSON_SWITCH_CHANNELS, orgTopics } from "./catalogue";
import {
  NOTIFICATION_TOPICS,
  orgSwitchesFor,
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
  /** WhatsApp: the one text channel, and only for somebody who opted in. */
  readonly whatsapp: boolean;
  /** Which version of the templates they get — English until they choose. */
  readonly whatsappLanguage: WhatsAppLanguage;
}

export async function notificationSettings(): Promise<NotificationSettings | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  const [current, whatsapp] = await Promise.all([
    preferencesFor(systemDb, session.personId, "sms"),
    whatsappOptedIn(systemDb, session.personId),
  ]);
  return {
    whatsapp: whatsapp.optedIn,
    whatsappLanguage: whatsapp.language,
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
  // Both channels. This wrote SMS alone, so switching Auction updates off
  // stopped the texts and never the emails (0079 checks the email row).
  //
  // On the APP pool. This wrote through `systemDb`, which in production holds
  // INSERT on four tables and this is not one (verify-grants SYSTEM_MAY_WRITE):
  // every switch on /account failed with "permission denied" on a live server
  // and worked everywhere else, because every local process is the DB owner.
  // No RLS on the table; the lock is that it only ever writes the session's
  // own person.
  for (const channel of PERSON_SWITCH_CHANNELS) {
    await setPreference(appDb, { personId: session.personId, topic, channel, allowed });
  }
  revalidatePath("/account");
  return { ok: true };
}

/**
 * WhatsApp updates. Consent, not a preference: every change is a new
 * `consent_records` row with the wording shown, and the latest one wins. On the
 * app pool, which may write consent (the system pool may not).
 *
 * The language rides on the same record. Changing it while opted in is a new
 * "yes" naming the new language — append-only means a re-statement, never an
 * edit — and a "no" keeps whatever was chosen for the day they come back
 * (`languageFromEvidence`).
 */
export async function setWhatsappPreferenceAction(
  granted: boolean,
  language?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Sign in to change your notification settings." };
  }
  // Only a language we have templates in. Anything else is ignored rather than
  // stored: Meta would refuse a send in a language nobody approved.
  const chosen = parseWhatsAppLanguage(language);
  await setWhatsappOptIn(appDb, {
    personId: session.personId,
    granted,
    source: "account",
    ...(granted && chosen !== undefined ? { language: chosen } : {}),
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
    // Every row the switch covers, not the SMS row alone (consent.ts).
    const current = await orgSwitchesFor(db, org.id);
    return {
      canManage,
      // Only the topics a club's sends actually consult (catalogue).
      topics: orgTopics().map((entry) => ({
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
  if (!orgTopics().some((entry) => entry.topic === topic)) {
    // An unpublished topic would write a row the gate never reads for it, so
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
      // One switch per topic, both rows: since the personal messages
      // (0079/0080) a club tells its players by email as well as by text
      // (SMS or WhatsApp — one row), and "stop sending this" has to mean all
      // of them. The view reads every row it writes (`orgSwitchesFor`).
      for (const channel of ORG_SWITCH_CHANNELS) {
        await setOrgMessagingSetting(db, {
          orgId: org.id,
          topic,
          channel,
          enabled,
          actorId: session.personId,
        });
      }
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
