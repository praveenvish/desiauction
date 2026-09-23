import { notificationTemplates, type Db } from "@desiauction/db";
import { and, eq } from "drizzle-orm";

import type { EmailNotificationKind } from "./catalogue";
import { EMAIL_TEMPLATES } from "./email-template-defaults";
import {
  defaultContent,
  parseTemplateContent,
  validateTemplate,
  type EmailTemplateSpec,
  type MessageLanguage,
  type TemplateContent,
  type TemplateFields,
  type TemplateIssue,
} from "./email-templates";

/**
 * WHICH WORDING GOES OUT — the published row, or the code default.
 *
 * THE FALLBACK CHAIN, and why each step exists:
 *
 *   1. The PUBLISHED template for (kind, email, the reader's language).
 *   2. The CODE DEFAULT in that language — when nothing is published, when the
 *      table cannot be read, or when the published row fails validation here,
 *      at render. It passed at publish; it can still fail now if the rules
 *      tightened in a deploy since, or the row was edited by hand. An email is
 *      never blank or broken because of wording: it goes out in the default,
 *      and the failure is logged.
 *   3. The ENGLISH code default — for a kind that is English-only (our own
 *      staff notices).
 *
 * READ ON EVERY SEND, SO CACHED — the platform switches' contract exactly
 * (platform-switches.ts): one load reads every published email template (a
 * few dozen rows at most) and serves this process for thirty seconds; a publish
 * from this process drops it at once (`invalidateTemplates`). Another process —
 * another web instance, the finops runner — sees a publish within the TTL.
 *
 * Unlike a kill switch, a failed load does NOT throw. A switch that silently
 * reads as "on" is not a switch; wording that silently reads as the default is
 * exactly the promised behaviour.
 */

export const TEMPLATE_TTL_MS = 30_000;

export interface PublishedTemplate {
  readonly id: string;
  readonly kind: string;
  readonly language: MessageLanguage;
  readonly version: number;
  readonly content: unknown;
}

let cached: {
  readonly rows: ReadonlyMap<string, PublishedTemplate>;
  readonly loadedAt: number;
} | null = null;

function key(kind: string, language: MessageLanguage): string {
  return `${kind}|${language}`;
}

/** Every published email template, uncached. */
export async function loadPublishedTemplates(db: Db): Promise<Map<string, PublishedTemplate>> {
  const rows = await db
    .select({
      id: notificationTemplates.id,
      kind: notificationTemplates.kind,
      language: notificationTemplates.language,
      version: notificationTemplates.version,
      content: notificationTemplates.content,
    })
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.channel, "email"),
        eq(notificationTemplates.status, "published"),
      ),
    );
  return new Map(rows.map((row) => [key(row.kind, row.language), row]));
}

async function published(db: Db, now: number): Promise<ReadonlyMap<string, PublishedTemplate>> {
  if (cached !== null && now - cached.loadedAt < TEMPLATE_TTL_MS) {
    return cached.rows;
  }
  const rows = await loadPublishedTemplates(db);
  cached = { rows, loadedAt: now };
  return rows;
}

/** Drop the cache — after every publish in this process, and in tests. */
export function invalidateTemplates(): void {
  cached = null;
}

export type TemplateSource = "published" | "default";

export interface ResolvedTemplate {
  readonly spec: EmailTemplateSpec;
  /** The language the wording is actually in (English for an English-only kind). */
  readonly language: MessageLanguage;
  readonly content: TemplateContent;
  readonly source: TemplateSource;
  /** The published version, when `source` is "published". */
  readonly version: number | null;
}

export interface TemplateProblem {
  readonly kind: string;
  readonly language: MessageLanguage;
  readonly reason: "load_failed" | "invalid";
  readonly version?: number;
  readonly issues?: readonly TemplateIssue[];
  readonly error?: unknown;
}

export interface ResolveOptions {
  /** Hosts a link in the wording may name (email-templates.ts `ownHostsFor`). */
  readonly ownHosts: readonly string[];
  /** Told about a load failure or an invalid published row; the send goes on. */
  readonly onProblem?: (problem: TemplateProblem) => void;
  readonly now?: number;
}

/**
 * The content one variant of one email is rendered from — the chain above.
 * Never throws for a wording reason.
 */
export async function resolveTemplate(
  db: Db,
  kind: EmailNotificationKind,
  requested: MessageLanguage,
  options: ResolveOptions,
): Promise<ResolvedTemplate> {
  const spec = EMAIL_TEMPLATES[kind];
  const language: MessageLanguage = spec.languages.includes(requested) ? requested : "en";
  const fallback: ResolvedTemplate = {
    spec,
    language,
    content: defaultContent(spec, language),
    source: "default",
    version: null,
  };
  if (!spec.editable) {
    return fallback;
  }
  let row: PublishedTemplate | undefined;
  try {
    row = (await published(db, options.now ?? Date.now())).get(key(kind, language));
  } catch (error) {
    options.onProblem?.({ kind, language, reason: "load_failed", error });
    return fallback;
  }
  if (row === undefined) {
    return fallback;
  }
  const content = parseTemplateContent(row.content);
  const issues =
    content === null
      ? [
          {
            variant: null,
            field: null,
            message: "The stored template is not in the template shape.",
          },
        ]
      : validateTemplate(spec, content, { language, ownHosts: options.ownHosts });
  if (content === null || issues.length > 0) {
    options.onProblem?.({ kind, language, reason: "invalid", version: row.version, issues });
    return fallback;
  }
  return { spec, language, content, source: "published", version: row.version };
}

/** One variant's fields — the named one, or the first the kind has. */
export function variantOf(resolved: ResolvedTemplate, variant: string | undefined): TemplateFields {
  const id = variant ?? resolved.spec.variants[0]?.id ?? "default";
  const fields = resolved.content.variants[id];
  if (fields === undefined) {
    // Unreachable past validation: every variant is required to be present.
    throw new Error(`${resolved.spec.kind} has no "${id}" wording`);
  }
  return fields;
}
