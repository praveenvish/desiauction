import { auditLog, notificationTemplates, people, type Db } from "@desiauction/db";
import {
  isNotificationKind,
  notificationOf,
  type EmailNotificationKind,
  type NotificationCategory,
} from "@desiauction/messaging/catalogue";
import {
  EMAIL_TEMPLATES,
  isEmailTemplateKind,
} from "@desiauction/messaging/email-template-defaults";
import {
  MESSAGE_LANGUAGE_LABELS,
  defaultContent,
  parseTemplateContent,
  type EmailTemplateSpec,
  type MessageLanguage,
  type TemplateContent,
} from "@desiauction/messaging/email-templates";
import { verifiedEmailOf } from "@desiauction/messaging/verified-email";
import { and, desc, eq, inArray } from "drizzle-orm";

import { systemDb } from "../db";
import { ownHosts } from "../messaging/notification-email";
import {
  TEMPLATE_AUDIT_ACTION_LIST,
  testSendsLeft,
  templateVersions,
  type TemplateAuditMeta,
} from "../messaging/template-writer";
import { platformAdminGate } from "./authz";
import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "./capabilities";

/**
 * THE EMAIL WORDING EDITOR, read — /admin/notifications/[kind]/email.
 *
 * A projection like every other in this folder: the kind's template spec (its
 * variables, locked blocks and code defaults), each language's live version,
 * draft and history, and the audit trail of its publishes — and it writes
 * nothing. The write is server/messaging/template-writer.ts; the actions that
 * call it are template-actions.ts.
 *
 * On the SYSTEM pool, behind `platform.admin`: the audit rows are
 * platform-scoped, which no tenant context can read, and the names beside each
 * version are other operators'.
 */

export type WordingStatus =
  { readonly state: "default" } | { readonly state: "published"; readonly version: number };

export interface WordingSummary {
  readonly editable: boolean;
  readonly href: string;
  /** Per language the kind is sent in: what goes out now, and whether a draft waits. */
  readonly languages: readonly {
    readonly language: MessageLanguage;
    readonly label: string;
    readonly status: WordingStatus;
    readonly draft: number | null;
  }[];
}

export interface VersionView {
  readonly version: number;
  readonly status: "draft" | "published" | "archived";
  readonly note: string | null;
  readonly createdAt: Date;
  readonly createdByName: string | null;
  readonly publishedAt: Date | null;
  readonly publishedByName: string | null;
  /** Null when the stored row no longer parses — shown, never restorable. */
  readonly content: TemplateContent | null;
}

export interface LanguageView {
  readonly language: MessageLanguage;
  readonly label: string;
  readonly status: WordingStatus;
  readonly defaultContent: TemplateContent;
  readonly published: VersionView | null;
  readonly draft: VersionView | null;
  readonly history: readonly VersionView[];
}

export interface TemplateChange {
  readonly id: string;
  readonly at: Date;
  readonly actorName: string | null;
  readonly summary: string;
}

export interface TemplateEditorView {
  readonly kind: EmailNotificationKind;
  readonly label: string;
  readonly description: string;
  readonly category: NotificationCategory;
  readonly spec: EmailTemplateSpec;
  /** The hosts a link in the wording may name — the editor's inline check. */
  readonly ownHosts: readonly string[];
  readonly languages: readonly LanguageView[];
  readonly changes: readonly TemplateChange[];
  /** The operator's own verified address — where "Send test to me" goes. */
  readonly operatorEmail: string | null;
  readonly testSendsLeft: number;
}

export function wordingHref(kind: string): string {
  return `/admin/notifications/${encodeURIComponent(kind)}/email`;
}

/** Every email kind's status, for the grid's "Wording" line. One read. */
export async function wordingSummaries(db: Db): Promise<Record<string, WordingSummary>> {
  const rows = await db
    .select({
      kind: notificationTemplates.kind,
      language: notificationTemplates.language,
      version: notificationTemplates.version,
      status: notificationTemplates.status,
    })
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.channel, "email"),
        inArray(notificationTemplates.status, ["published", "draft"]),
      ),
    );
  const out: Record<string, WordingSummary> = {};
  for (const spec of Object.values(EMAIL_TEMPLATES)) {
    out[spec.kind] = {
      editable: spec.editable,
      href: wordingHref(spec.kind),
      languages: spec.languages.map((language) => {
        const mine = rows.filter((row) => row.kind === spec.kind && row.language === language);
        const live = mine.find((row) => row.status === "published");
        return {
          language,
          label: MESSAGE_LANGUAGE_LABELS[language],
          status:
            live === undefined
              ? { state: "default" as const }
              : { state: "published" as const, version: live.version },
          draft: mine.find((row) => row.status === "draft")?.version ?? null,
        };
      }),
    };
  }
  return out;
}

async function namesOf(db: Db, ids: readonly string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(inArray(people.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

function summarize(action: string, meta: Partial<TemplateAuditMeta>): string {
  const language =
    meta.language === undefined ? "" : ` (${MESSAGE_LANGUAGE_LABELS[meta.language]})`;
  switch (action) {
    case "notification.template_published":
      return `Published v${String(meta.version ?? "?")}${language}`;
    case "notification.template_restored":
      return `Restored v${String(meta.restoredFrom ?? "?")} as v${String(meta.version ?? "?")}${language}`;
    case "notification.template_reset":
      return `Reset to the default wording${language}`;
    default:
      return `Sent a test${language}`;
  }
}

export async function templateEditorView(
  db: Db,
  kind: EmailNotificationKind,
  operatorId: string,
): Promise<TemplateEditorView> {
  const spec = EMAIL_TEMPLATES[kind];
  const entry = notificationOf(kind);
  const perLanguage = await Promise.all(
    spec.languages.map(async (language) => ({
      language,
      rows: await templateVersions(db, kind, language),
    })),
  );
  const names = await namesOf(
    db,
    perLanguage.flatMap(({ rows }) =>
      rows.flatMap((row) => [
        row.createdBy,
        ...(row.publishedBy === null ? [] : [row.publishedBy]),
      ]),
    ),
  );
  const languages: LanguageView[] = perLanguage.map(({ language, rows }) => {
    const history = rows.map((row): VersionView => ({
      version: row.version,
      status: row.status,
      note: row.note,
      createdAt: row.createdAt,
      createdByName: names.get(row.createdBy) ?? null,
      publishedAt: row.publishedAt,
      publishedByName: row.publishedBy === null ? null : (names.get(row.publishedBy) ?? null),
      content: parseTemplateContent(row.content),
    }));
    const published = history.find((row) => row.status === "published") ?? null;
    return {
      language,
      label: MESSAGE_LANGUAGE_LABELS[language],
      status:
        published === null
          ? { state: "default" }
          : { state: "published", version: published.version },
      defaultContent: defaultContent(spec, language),
      published,
      draft: history.find((row) => row.status === "draft") ?? null,
      history,
    };
  });
  const audits = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      meta: auditLog.meta,
      actorName: people.name,
    })
    .from(auditLog)
    .leftJoin(people, eq(people.id, auditLog.actor))
    .where(
      and(
        eq(auditLog.scopeType, PLATFORM_SCOPE_TYPE),
        eq(auditLog.scopeId, PLATFORM_SCOPE_ID),
        eq(auditLog.subject, kind),
        inArray(auditLog.action, [...TEMPLATE_AUDIT_ACTION_LIST]),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(20);
  const [operatorEmail, left] = await Promise.all([
    verifiedEmailOf(db, operatorId),
    testSendsLeft(db, operatorId),
  ]);
  return {
    kind,
    label: entry.label,
    description: entry.description,
    category: entry.category,
    spec,
    ownHosts: ownHosts(),
    languages,
    changes: audits.map((row) => ({
      id: row.id,
      at: row.at,
      actorName: row.actorName,
      summary: summarize(row.action, (row.meta ?? {}) as Partial<TemplateAuditMeta>),
    })),
    operatorEmail,
    testSendsLeft: left,
  };
}

/**
 * The page's read: `platform.admin`, an email kind whose wording is editable,
 * or nothing — the page turns null into a not-found.
 */
export async function adminTemplateEditor(kind: string): Promise<TemplateEditorView | null> {
  const operator = await platformAdminGate();
  if (operator === null) {
    return null;
  }
  if (!isNotificationKind(kind) || !isEmailTemplateKind(kind) || !EMAIL_TEMPLATES[kind].editable) {
    return null;
  }
  return templateEditorView(systemDb, kind, operator.personId);
}
