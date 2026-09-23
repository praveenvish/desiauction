"use server";

import { revalidatePath } from "next/cache";

import type { TemplateIssue } from "@desiauction/messaging/email-templates";

import { db as appDb, systemDb } from "../db";
import { logger } from "../logger";
import {
  publishTemplate,
  renderTemplatePreview,
  resetTemplateToDefault,
  restoreTemplateVersion,
  saveTemplateDraft,
  sendTemplateTest,
  type TemplateWriteResult,
} from "../messaging/template-writer";
import { platformAdminGate } from "./authz";
import { wordingHref } from "./template-views";

/**
 * THE EMAIL WORDING EDITOR, write — `platform.admin` only (founder decision,
 * 2026-09-23: no new role; clubs never edit wording).
 *
 * Each action gates, then hands the change to the writer, which validates it
 * against the kind's template spec (allowlisted placeholders, required ones,
 * locked blocks, plain text, own-domain links), writes it and audits it.
 * Nothing here touches a table itself — the verbs live in
 * server/messaging/template-writer.ts, like every desk's.
 *
 * The template rows ride the APP pool (no RLS, the app role holds the DML);
 * the platform-scoped audit row rides the SYSTEM pool, the only one allowed to
 * write it. The same pair the switches use (notification-actions.ts).
 */

export type TemplateActionResult = TemplateWriteResult;

const REFUSED: TemplateActionResult = { ok: false, error: "Not available." };

async function run(
  kind: string,
  write: (operatorId: string) => Promise<TemplateWriteResult>,
): Promise<TemplateActionResult> {
  const operator = await platformAdminGate();
  if (operator === null) {
    return REFUSED;
  }
  try {
    const result = await write(operator.personId);
    if (result.ok) {
      if (result.auditId !== null) {
        logger().info(
          { operator: operator.personId, auditId: result.auditId, kind },
          "notifications.template_changed",
        );
      }
      revalidatePath(wordingHref(kind));
      revalidatePath("/admin/notifications");
    }
    return result;
  } catch (error) {
    // A CHECK or unique index from 0087 lands here, as does a failed audit
    // write — which rolled the template change back with it.
    logger().error(
      { err: error, operator: operator.personId, kind },
      "notifications.template_failed",
    );
    return { ok: false, error: "That did not save. Nothing was changed." };
  }
}

const handles = () => ({ db: appDb, auditDb: systemDb });

export async function saveTemplateDraftAction(
  kind: string,
  language: string,
  content: unknown,
  note?: string,
): Promise<TemplateActionResult> {
  return run(kind, (operatorId) =>
    saveTemplateDraft(handles(), operatorId, {
      kind,
      language,
      content,
      ...(note === undefined ? {} : { note }),
    }),
  );
}

export async function publishTemplateAction(
  kind: string,
  language: string,
  content: unknown,
  note?: string,
): Promise<TemplateActionResult> {
  return run(kind, (operatorId) =>
    publishTemplate(handles(), operatorId, {
      kind,
      language,
      content,
      ...(note === undefined ? {} : { note }),
    }),
  );
}

export async function restoreTemplateVersionAction(
  kind: string,
  language: string,
  version: number,
): Promise<TemplateActionResult> {
  return run(kind, (operatorId) =>
    restoreTemplateVersion(handles(), operatorId, { kind, language, version }),
  );
}

export async function resetTemplateAction(
  kind: string,
  language: string,
  note?: string,
): Promise<TemplateActionResult> {
  return run(kind, (operatorId) =>
    resetTemplateToDefault(handles(), operatorId, {
      kind,
      language,
      ...(note === undefined ? {} : { note }),
    }),
  );
}

export async function sendTemplateTestAction(
  kind: string,
  language: string,
  variant: string,
  content: unknown,
): Promise<TemplateActionResult> {
  return run(kind, (operatorId) =>
    sendTemplateTest(handles(), operatorId, { kind, language, variant, content }),
  );
}

export type PreviewResult =
  | {
      readonly ok: true;
      readonly subject: string;
      readonly text: string;
      /** Null for a plain-text kind. Shown in a sandboxed iframe, never inline. */
      readonly html: string | null;
      readonly issues: readonly TemplateIssue[];
    }
  | { readonly ok: false; readonly error: string };

/**
 * THE LIVE PREVIEW, rendered by the real renderer on the SERVER — the browser
 * never lays out an email itself, so what the admin sees is what is sent. The
 * HTML goes into a sandboxed iframe (`srcdoc`, `sandbox=""`): no script, no
 * same-origin, no navigation, whatever the wording contained.
 */
export async function previewTemplateAction(
  kind: string,
  language: string,
  variant: string,
  content: unknown,
): Promise<PreviewResult> {
  if ((await platformAdminGate()) === null) {
    return { ok: false, error: "Not available." };
  }
  const rendered = renderTemplatePreview(kind, language, variant, content);
  if (!rendered.ok) {
    return { ok: false, error: rendered.error };
  }
  return {
    ok: true,
    subject: rendered.mail.subject,
    text: rendered.mail.text,
    html: rendered.mail.html ?? null,
    issues: rendered.issues,
  };
}
