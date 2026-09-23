"use server";

import { revalidatePath } from "next/cache";

import { db as appDb, systemDb } from "../db";
import { logger } from "../logger";
import { metaConfigFromEnv } from "../messaging/meta-templates";
import type { WriteResult } from "../messaging/platform-switch-writer";
import {
  applyTemplateMapping,
  revertTemplateMapping,
  submitForApproval,
  syncWhatsAppTemplates,
} from "../messaging/provider-template-writer";
import { platformAdminGate } from "./authz";

/**
 * TEMPLATE MAPPING AND META'S STATUS, write — `platform.admin` only
 * (Notification Control Center, Phase 3; no new role).
 *
 * Each action gates, then hands the change to the writer, which validates it
 * (login never, Meta's name rule, a known kind), writes it and audits it.
 * Nothing here writes a table itself. The mapping and status tables ride the
 * APP pool (no RLS, 0088); the platform-scoped audit row rides the SYSTEM
 * pool, the only one allowed to write it — as notification-actions.ts.
 *
 * Meta's token never reaches a log line from here: the writer's errors are
 * Meta's own message, capped, and the token only ever travels in a header.
 */

export type TemplateActionResult = WriteResult;

const REFUSED: TemplateActionResult = { ok: false, error: "Not available." };
const PATHS = ["/admin/notifications/templates", "/admin/notifications"];

async function run(
  event: string,
  act: (actorId: string) => Promise<TemplateActionResult>,
): Promise<TemplateActionResult> {
  const operator = await platformAdminGate();
  if (operator === null) {
    return REFUSED;
  }
  try {
    const result = await act(operator.personId);
    if (result.ok) {
      logger().info({ operator: operator.personId, auditId: result.auditId }, event);
      for (const path of PATHS) revalidatePath(path);
    }
    return result;
  } catch (error) {
    // A CHECK from 0088 lands here, as does a failed audit write — which
    // rolled the mapping back with it.
    logger().error({ err: error, operator: operator.personId }, `${event}_failed`);
    return { ok: false, error: "That did not save. Nothing was changed." };
  }
}

const handles = () => ({ db: appDb, auditDb: systemDb });

/** Point a kind at an approved WhatsApp name, or an SMS DLT id. */
export async function mapProviderTemplate(
  kind: string,
  channel: string,
  value: string,
  languages?: readonly string[],
  note?: string,
): Promise<TemplateActionResult> {
  return run("notifications.template_mapped", (actor) =>
    applyTemplateMapping(handles(), actor, { kind, channel, value, languages, note }),
  );
}

/** Drop the mapping: the env var decides again. */
export async function clearProviderTemplate(
  kind: string,
  channel: string,
): Promise<TemplateActionResult> {
  return run("notifications.template_mapped", (actor) =>
    applyTemplateMapping(handles(), actor, { kind, channel, clear: true }),
  );
}

export async function revertProviderTemplate(auditId: string): Promise<TemplateActionResult> {
  return run("notifications.template_mapped", (actor) =>
    revertTemplateMapping(handles(), actor, auditId),
  );
}

/** "Refresh from Meta" — rate-limited in the writer, across processes. */
export async function refreshTemplateStatus(): Promise<TemplateActionResult> {
  return run("notifications.template_synced", async () => {
    const outcome = await syncWhatsAppTemplates(appDb, metaConfigFromEnv());
    return outcome.ok
      ? {
          ok: true,
          message: `Read ${String(outcome.count)} template${outcome.count === 1 ? "" : "s"} from Meta.`,
          auditId: null,
        }
      : { ok: false, error: outcome.error };
  });
}

/** Submit a kind's catalogue template to Meta for approval, in the chosen languages. */
export async function submitProviderTemplate(
  kind: string,
  name: string,
  languages: readonly string[],
): Promise<TemplateActionResult> {
  return run("notifications.template_submitted", (actor) =>
    submitForApproval(handles(), actor, { kind, name, languages }, metaConfigFromEnv()),
  );
}
