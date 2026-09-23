import { auditLog, newId, notificationTemplates, type Db } from "@desiauction/db";
import { isNotificationKind, type EmailNotificationKind } from "@desiauction/messaging/catalogue";
import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import {
  isMessageLanguage,
  parseTemplateContent,
  sampleVariables,
  validateTemplate,
  type EmailTemplateSpec,
  type MessageLanguage,
  type TemplateContent,
  type TemplateFields,
  type TemplateIssue,
} from "@desiauction/messaging/email-templates";
import { financeDocumentMail } from "@desiauction/messaging/email-adapter";
import { invalidateTemplates } from "@desiauction/messaging/template-store";
import { verifiedEmailOf } from "@desiauction/messaging/verified-email";
import { and, count, desc, eq, gte, max, sql } from "drizzle-orm";

import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "../admin/capabilities";
import { composeNotificationEmail, ownHosts, type NotificationMail } from "./notification-email";
import { previewOptions } from "./template-preview";
import { transactionalMailer, type TransactionalMailer } from "./transactional-mail";

/**
 * THE ONE WRITER OF EMAIL WORDING (Notification Control Center, Phase 2).
 *
 * Here, under server/messaging, not server/admin, for the reason every desk's
 * write lives outside that folder (platform-switch-writer.ts has it): the
 * admin projections are proven read-only by a source scan. The actions in
 * server/admin/template-actions.ts gate on `platform.admin` and call in.
 *
 * WHAT IT DOES, and what each step leaves behind:
 *
 *   · SAVE DRAFT — one draft per kind and language (0087), edited in place.
 *     Nobody receives a draft.
 *   · PUBLISH — a new version, live at once (founder decision: edits publish
 *     directly), the previous one archived. Audited.
 *   · RESTORE — publishes a COPY of an older version under a new number, so
 *     the history only ever grows. Audited, naming what it restored.
 *   · RESET TO DEFAULT — archives the published version; with nothing
 *     published the code default goes out. Audited.
 *   · SEND TEST TO ME — renders the editor's wording with the samples and
 *     mails it to the operator's own verified address, subject "[Test] …".
 *     It BYPASSES the send gate, deliberately: it is not a notification to
 *     anybody but the person pressing the button, and a kill switch must not
 *     stop an admin checking the wording they are about to publish. Bounded
 *     instead: ten an hour per operator, counted from the audit log, so the
 *     button cannot be turned into a mail cannon aimed at one inbox.
 *
 * EVERY RULE IS CHECKED HERE, whatever the browser said: the same
 * `validateTemplate` the editor runs inline. A publish that fails it is
 * refused with the issues, and nothing is written.
 *
 * TWO HANDLES, like the switch writer: the templates on the APP pool (no RLS,
 * the app role holds their DML), the platform-scoped audit row on the SYSTEM
 * pool, written inside the template transaction's callback so a change never
 * goes live without its record.
 */

export const TEMPLATE_AUDIT_ACTIONS = {
  published: "notification.template_published",
  restored: "notification.template_restored",
  reset: "notification.template_reset",
  testSent: "notification.template_test_sent",
} as const;

export const TEMPLATE_AUDIT_ACTION_LIST: readonly string[] = Object.values(TEMPLATE_AUDIT_ACTIONS);

/** Test sends one operator may make in an hour. */
export const TEST_SENDS_PER_HOUR = 10;

export const NOTE_MAX = 500;

export interface TemplateHandles {
  /** The app pool: the template rows. */
  readonly db: Db;
  /** The system pool: the platform-scoped audit row. */
  readonly auditDb: Db;
}

export type TemplateWriteResult =
  | {
      readonly ok: true;
      readonly message: string;
      readonly version: number | null;
      readonly auditId: string | null;
    }
  | { readonly ok: false; readonly error: string; readonly issues?: readonly TemplateIssue[] };

export interface TemplateAuditMeta {
  readonly kind: string;
  readonly language: MessageLanguage;
  /** The version that went live (publish, restore); null for a reset. */
  readonly version: number | null;
  /** What was live before. */
  readonly previousVersion: number | null;
  /** A restore: the version whose wording was copied. */
  readonly restoredFrom?: number;
  readonly note: string | null;
}

interface Target {
  readonly spec: EmailTemplateSpec;
  readonly kind: EmailNotificationKind;
  readonly language: MessageLanguage;
}

function target(kind: string, language: string): Target | { ok: false; error: string } {
  if (!isNotificationKind(kind) || !(kind in EMAIL_TEMPLATES)) {
    return { ok: false, error: "That email does not exist." };
  }
  const spec = EMAIL_TEMPLATES[kind as EmailNotificationKind];
  if (!spec.editable) {
    return { ok: false, error: "That email's wording is not editable." };
  }
  if (!isMessageLanguage(language) || !spec.languages.includes(language)) {
    return { ok: false, error: "That email is not sent in that language." };
  }
  return { spec, kind: spec.kind, language };
}

function normalizeNote(note: string | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Parse and validate what the browser sent. Refuses with every issue at once. */
export function checkContent(
  spec: EmailTemplateSpec,
  language: MessageLanguage,
  raw: unknown,
): { ok: true; content: TemplateContent } | { ok: false; error: string; issues: TemplateIssue[] } {
  const content = parseTemplateContent(raw);
  if (content === null) {
    return {
      ok: false,
      error: "That wording is not in the right shape.",
      issues: [{ variant: null, field: null, message: "That wording is not in the right shape." }],
    };
  }
  const issues = validateTemplate(spec, content, { language, ownHosts: ownHosts() });
  if (issues.length > 0) {
    return { ok: false, error: "Fix the marked parts first.", issues };
  }
  return { ok: true, content };
}

/**
 * Serialise writes to one kind and language: the next version number is read
 * and written in the same transaction, and two admins pressing Publish at once
 * must not both claim it (the unique index would refuse one, as a 500).
 */
async function lock(tx: Db, t: Target): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`notification_templates:${t.kind}:email:${t.language}`}))`,
  );
}

function scope(t: Target) {
  return and(
    eq(notificationTemplates.kind, t.kind),
    eq(notificationTemplates.channel, "email"),
    eq(notificationTemplates.language, t.language),
  );
}

async function nextVersion(tx: Db, t: Target): Promise<number> {
  const [row] = await tx
    .select({ top: max(notificationTemplates.version) })
    .from(notificationTemplates)
    .where(scope(t));
  return (row?.top ?? 0) + 1;
}

async function current(
  tx: Db,
  t: Target,
  status: "published" | "draft",
): Promise<{ id: string; version: number } | null> {
  const [row] = await tx
    .select({ id: notificationTemplates.id, version: notificationTemplates.version })
    .from(notificationTemplates)
    .where(and(scope(t), eq(notificationTemplates.status, status)))
    .limit(1);
  return row ?? null;
}

async function audit(
  handles: TemplateHandles,
  actorId: string,
  action: string,
  meta: TemplateAuditMeta,
): Promise<string> {
  const id = newId();
  await handles.auditDb.insert(auditLog).values({
    id,
    actor: actorId,
    action,
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    subject: meta.kind,
    meta,
  });
  return id;
}

const LANGUAGE_WORDS: Readonly<Record<MessageLanguage, string>> = {
  en: "English",
  hi: "Hindi",
};

/** Save the one draft for this kind and language. Nobody receives it. */
export async function saveTemplateDraft(
  handles: TemplateHandles,
  actorId: string,
  input: { kind: string; language: string; content: unknown; note?: string },
): Promise<TemplateWriteResult> {
  const t = target(input.kind, input.language);
  if ("ok" in t) return t;
  const note = normalizeNote(input.note);
  if (note !== null && note.length > NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${String(NOTE_MAX)} characters.` };
  }
  // A draft may be unfinished — but it may not hold what could never be
  // published (HTML, a foreign link): drafts are validated the same way, so a
  // saved draft is always one Publish away from live.
  const checked = checkContent(t.spec, t.language, input.content);
  if (!checked.ok) return checked;
  const version = await handles.db.transaction(async (tx) => {
    await lock(tx, t);
    const draft = await current(tx, t, "draft");
    if (draft !== null) {
      await tx
        .update(notificationTemplates)
        .set({ content: checked.content, note, createdBy: actorId, createdAt: new Date() })
        .where(eq(notificationTemplates.id, draft.id));
      return draft.version;
    }
    const fresh = await nextVersion(tx, t);
    await tx.insert(notificationTemplates).values({
      id: newId(),
      kind: t.kind,
      channel: "email",
      language: t.language,
      version: fresh,
      status: "draft",
      content: checked.content,
      note,
      createdBy: actorId,
    });
    return fresh;
  });
  return {
    ok: true,
    message: `Draft v${String(version)} saved. Nobody receives it until you publish.`,
    version,
    auditId: null,
  };
}

/**
 * Publish: the draft becomes the live version (or, with no draft, a new one is
 * written), the previous live one is archived, and the change is audited.
 */
export async function publishTemplate(
  handles: TemplateHandles,
  actorId: string,
  input: { kind: string; language: string; content: unknown; note?: string },
): Promise<TemplateWriteResult> {
  const t = target(input.kind, input.language);
  if ("ok" in t) return t;
  const note = normalizeNote(input.note);
  if (note !== null && note.length > NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${String(NOTE_MAX)} characters.` };
  }
  const checked = checkContent(t.spec, t.language, input.content);
  if (!checked.ok) return checked;
  const result = await handles.db.transaction(async (tx) => {
    await lock(tx, t);
    const live = await current(tx, t, "published");
    const draft = await current(tx, t, "draft");
    if (live !== null) {
      await tx
        .update(notificationTemplates)
        .set({ status: "archived" })
        .where(eq(notificationTemplates.id, live.id));
    }
    const now = new Date();
    let version: number;
    if (draft !== null) {
      version = draft.version;
      await tx
        .update(notificationTemplates)
        .set({
          status: "published",
          content: checked.content,
          note,
          publishedBy: actorId,
          publishedAt: now,
        })
        .where(eq(notificationTemplates.id, draft.id));
    } else {
      version = await nextVersion(tx, t);
      await tx.insert(notificationTemplates).values({
        id: newId(),
        kind: t.kind,
        channel: "email",
        language: t.language,
        version,
        status: "published",
        content: checked.content,
        note,
        createdBy: actorId,
        publishedBy: actorId,
        publishedAt: now,
      });
    }
    const auditId = await audit(handles, actorId, TEMPLATE_AUDIT_ACTIONS.published, {
      kind: t.kind,
      language: t.language,
      version,
      previousVersion: live?.version ?? null,
      note,
    });
    return { version, auditId };
  });
  invalidateTemplates();
  return {
    ok: true,
    message: `Published v${String(result.version)} (${LANGUAGE_WORDS[t.language]}). It goes out from now on.`,
    ...result,
  };
}

/** Publish a copy of an older version, under a new number. */
export async function restoreTemplateVersion(
  handles: TemplateHandles,
  actorId: string,
  input: { kind: string; language: string; version: number },
): Promise<TemplateWriteResult> {
  const t = target(input.kind, input.language);
  if ("ok" in t) return t;
  const result = await handles.db.transaction(async (tx) => {
    await lock(tx, t);
    const [source] = await tx
      .select({ content: notificationTemplates.content })
      .from(notificationTemplates)
      .where(and(scope(t), eq(notificationTemplates.version, input.version)))
      .limit(1);
    if (source === undefined) {
      return { ok: false, error: "That version is not on the list." } as const;
    }
    // Checked against TODAY's rules: an old version that no longer passes
    // them would only fall back to the default at render — say so now.
    const checked = checkContent(t.spec, t.language, source.content);
    if (!checked.ok) {
      return {
        ok: false,
        error: "That version no longer passes the rules, so it cannot be restored.",
        issues: checked.issues,
      } as const;
    }
    const live = await current(tx, t, "published");
    if (live !== null && live.version === input.version) {
      return { ok: false, error: "That version is already the one going out." } as const;
    }
    if (live !== null) {
      await tx
        .update(notificationTemplates)
        .set({ status: "archived" })
        .where(eq(notificationTemplates.id, live.id));
    }
    const version = await nextVersion(tx, t);
    await tx.insert(notificationTemplates).values({
      id: newId(),
      kind: t.kind,
      channel: "email",
      language: t.language,
      version,
      status: "published",
      content: checked.content,
      note: `Restored from v${String(input.version)}`,
      createdBy: actorId,
      publishedBy: actorId,
      publishedAt: new Date(),
    });
    const auditId = await audit(handles, actorId, TEMPLATE_AUDIT_ACTIONS.restored, {
      kind: t.kind,
      language: t.language,
      version,
      previousVersion: live?.version ?? null,
      restoredFrom: input.version,
      note: null,
    });
    return { ok: true, version, auditId } as const;
  });
  if (!result.ok) return result;
  invalidateTemplates();
  return {
    ok: true,
    message: `Restored v${String(input.version)} as v${String(result.version)}. It goes out from now on.`,
    version: result.version,
    auditId: result.auditId,
  };
}

/** Archive the live version: the code default goes out again. */
export async function resetTemplateToDefault(
  handles: TemplateHandles,
  actorId: string,
  input: { kind: string; language: string; note?: string },
): Promise<TemplateWriteResult> {
  const t = target(input.kind, input.language);
  if ("ok" in t) return t;
  const note = normalizeNote(input.note);
  const result = await handles.db.transaction(async (tx) => {
    await lock(tx, t);
    const live = await current(tx, t, "published");
    if (live === null) {
      return null;
    }
    await tx
      .update(notificationTemplates)
      .set({ status: "archived" })
      .where(eq(notificationTemplates.id, live.id));
    return audit(handles, actorId, TEMPLATE_AUDIT_ACTIONS.reset, {
      kind: t.kind,
      language: t.language,
      version: null,
      previousVersion: live.version,
      note,
    });
  });
  if (result === null) {
    return {
      ok: true,
      message: "It already uses the default wording.",
      version: null,
      auditId: null,
    };
  }
  invalidateTemplates();
  return {
    ok: true,
    message: `Back to the default wording (${LANGUAGE_WORDS[t.language]}).`,
    version: null,
    auditId: result,
  };
}

/** A sample document, for previewing a finance mail's wording above it. */
const SAMPLE_DOCUMENT = [
  "RECEIPT R-2026-0042",
  "Malad Cricket Club · Malad Premier League 2026",
  "Received from: Cup Kings",
  "Amount: ₹75,000",
  "(The document itself is the club's, reproduced exactly — it is not editable.)",
].join("\n");

/** The wording with the samples, laid out as the mail would be. */
function previewMail(t: Target, variant: string, fields: TemplateFields): NotificationMail {
  if (t.kind === "finance.document.issued") {
    // The one kind whose body is not wording: the document goes last, whole.
    const mail = financeDocumentMail(fields, SAMPLE_DOCUMENT);
    return composeNotificationEmail(
      t.spec,
      { ...fields, subject: mail.subject, paragraphs: [mail.text] },
      {},
    );
  }
  return composeNotificationEmail(
    t.spec,
    fields,
    sampleVariables(t.spec, t.language),
    previewOptions(t.kind, variant, t.language),
  );
}

/** Render the editor's wording with the samples — what the preview shows. */
export function renderTemplatePreview(
  kind: string,
  language: string,
  variant: string,
  raw: unknown,
):
  | { ok: true; mail: NotificationMail; issues: TemplateIssue[] }
  | { ok: false; error: string; issues: TemplateIssue[] } {
  const t = target(kind, language);
  if ("ok" in t) return { ...t, issues: [] };
  const content = parseTemplateContent(raw);
  if (content === null) {
    return { ok: false, error: "That wording is not in the right shape.", issues: [] };
  }
  const fields = content.variants[variant];
  if (fields === undefined) {
    return { ok: false, error: "There is no such version of this email.", issues: [] };
  }
  const issues = validateTemplate(t.spec, content, { language: t.language, ownHosts: ownHosts() });
  return {
    ok: true,
    // Rendered even with issues, so the preview follows the typing; the
    // issues say what would stop it being saved.
    mail: previewMail(t, variant, fields),
    issues,
  };
}

/** How many test sends this operator has left this hour. */
export async function testSendsLeft(
  auditDb: Db,
  actorId: string,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await auditDb
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actor, actorId),
        eq(auditLog.action, TEMPLATE_AUDIT_ACTIONS.testSent),
        gte(auditLog.at, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    );
  return Math.max(TEST_SENDS_PER_HOUR - (row?.n ?? 0), 0);
}

/**
 * "Send test to me": the editor's wording, the samples, the operator's own
 * VERIFIED address and nobody else's — the recipient is never an input.
 */
export async function sendTemplateTest(
  handles: TemplateHandles,
  actorId: string,
  input: { kind: string; language: string; variant: string; content: unknown },
  options: { mailer?: TransactionalMailer; now?: Date } = {},
): Promise<TemplateWriteResult> {
  const t = target(input.kind, input.language);
  if ("ok" in t) return t;
  const checked = checkContent(t.spec, t.language, input.content);
  if (!checked.ok) return checked;
  const fields = checked.content.variants[input.variant];
  if (fields === undefined) {
    return { ok: false, error: "There is no such version of this email." };
  }
  const to = await verifiedEmailOf(handles.db, actorId);
  if (to === null) {
    return {
      ok: false,
      error: "Add and confirm an email address on your account first — a test goes only there.",
    };
  }
  if ((await testSendsLeft(handles.auditDb, actorId, options.now)) <= 0) {
    return {
      ok: false,
      error: `That is ${String(TEST_SENDS_PER_HOUR)} test emails this hour. Try again later.`,
    };
  }
  const mail = previewMail(t, input.variant, fields);
  // Audited BEFORE the send: the count is of attempts, so a provider that
  // fails fast cannot be retried past the limit.
  const auditId = await audit(handles, actorId, TEMPLATE_AUDIT_ACTIONS.testSent, {
    kind: t.kind,
    language: t.language,
    version: null,
    previousVersion: null,
    note: `variant ${input.variant}`,
  });
  const outcome = await (options.mailer ?? transactionalMailer()).send({
    to,
    subject: `[Test] ${mail.subject}`,
    text: mail.text,
    ...(mail.html === undefined ? {} : { html: mail.html }),
  });
  if (outcome !== "sent") {
    return {
      ok: false,
      error:
        outcome === "unconfigured"
          ? "Email is not configured on this server, so nothing was sent."
          : "The mail provider did not take it. Try again shortly.",
    };
  }
  return { ok: true, message: `Test sent to ${to}.`, version: null, auditId };
}

// ---------------------------------------------------------------------------
// Reads the editor needs (the history), kept beside the writer that makes it.
// ---------------------------------------------------------------------------

export interface TemplateVersionRow {
  readonly id: string;
  readonly version: number;
  readonly status: "draft" | "published" | "archived";
  readonly content: unknown;
  readonly note: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly publishedBy: string | null;
  readonly publishedAt: Date | null;
}

export async function templateVersions(
  db: Db,
  kind: string,
  language: MessageLanguage,
  limit = 50,
): Promise<TemplateVersionRow[]> {
  return db
    .select({
      id: notificationTemplates.id,
      version: notificationTemplates.version,
      status: notificationTemplates.status,
      content: notificationTemplates.content,
      note: notificationTemplates.note,
      createdBy: notificationTemplates.createdBy,
      createdAt: notificationTemplates.createdAt,
      publishedBy: notificationTemplates.publishedBy,
      publishedAt: notificationTemplates.publishedAt,
    })
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.kind, kind),
        eq(notificationTemplates.channel, "email"),
        eq(notificationTemplates.language, language),
      ),
    )
    .orderBy(desc(notificationTemplates.version))
    .limit(limit);
}
