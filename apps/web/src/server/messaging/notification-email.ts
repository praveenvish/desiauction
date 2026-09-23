import type { Db } from "@desiauction/db";
import type { EmailNotificationKind } from "@desiauction/messaging/catalogue";
import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import {
  fillTemplate,
  ownHostsFor,
  type EmailTemplateSpec,
  type MessageLanguage,
  type TemplateFields,
  type TemplateVariables,
} from "@desiauction/messaging/email-templates";
import {
  resolveTemplate,
  variantOf,
  type ResolvedTemplate,
  type TemplateProblem,
} from "@desiauction/messaging/template-store";

import { env } from "../../env";
import { db as appDb } from "../db";
import { logger } from "../logger";
import { renderEmail } from "./email-layout";

/**
 * EVERY EMAIL'S WORDS COME FROM HERE (Notification Control Center, Phase 2).
 *
 * `renderNotificationEmail(kind, language, variables, options)` is the one way
 * a subject and body are made: it takes the PUBLISHED wording for the kind in
 * the reader's language (or the code default — template-store.ts has the
 * chain), fills in the variables, and lays it out with `renderEmail`, which
 * escapes every string. The senders only gather facts and say which kind,
 * which variant, which button and which details table; none of them holds a
 * sentence any more.
 *
 * The result is a `NotificationMail`, a type nothing else can construct: the
 * gated senders (notify.ts `sendNotificationMail`, the outbox's `QueuedMail`)
 * accept only that, so a mail with words written somewhere else does not
 * compile — and the guard test (notification-guard.test.ts) fails any module
 * but this one that reaches for `renderEmail` or casts its way in.
 */

declare const rendered: unique symbol;

/** A subject and body that came from the template registry. */
export interface NotificationMail {
  readonly subject: string;
  readonly text: string;
  /** Absent for a plain-text kind (our own staff notices, a report receipt). */
  readonly html?: string;
  readonly [rendered]: true;
}

/**
 * What the CODE decides about a kind's layout — never wording, never an admin's.
 *
 *   · noLinks: a one-time code. A typed code cannot be followed out of a
 *     forwarded message; a link can.
 *   · actionFirst: the button right after the opening, for a mail whose whole
 *     point is the click (a review ask).
 *   · whatsappNudge: the personal moments leave room for "Get these on
 *     WhatsApp" (email-layout.ts) — never a security mail or a code.
 */
const LAYOUT: Readonly<
  Partial<
    Record<
      EmailNotificationKind,
      { noLinks?: boolean; actionFirst?: boolean; whatsappNudge?: boolean }
    >
  >
> = {
  "auth.email_code": { noLinks: true },
  "registration.approved": { whatsappNudge: true },
  "registration.waitlisted": { whatsappNudge: true },
  "registration.rejected": { whatsappNudge: true },
  "registration.withdrawn": { whatsappNudge: true },
  "registration.restored": { whatsappNudge: true },
  "auction.sold": { whatsappNudge: true },
  "team.appointed": { whatsappNudge: true },
  "lineup.announced": { whatsappNudge: true },
  "review.platform_ask": { actionFirst: true },
  "review.season_ask": { actionFirst: true },
};

export interface RenderOptions {
  /** Which version of the mail (`login`, `day_before`, …); the first when omitted. */
  readonly variant?: string;
  /** The ONE button, by its id in the template, with the code's URL. */
  readonly action?: { readonly id: string; readonly url: string };
  /** The facts table (a squad, a booking) — written by the caller, in `language`. */
  readonly details?: readonly (readonly [string, string])[];
  /** A one-time code, shown large. */
  readonly code?: string;
}

/**
 * Lay out wording that has already been chosen — the pure half, shared by the
 * send path and the admin preview (which renders an unsaved draft through the
 * exact same code).
 */
export function composeNotificationEmail(
  spec: EmailTemplateSpec,
  fields: TemplateFields,
  variables: TemplateVariables,
  options: RenderOptions = {},
): NotificationMail {
  const filled = fillTemplate(spec, fields, variables);
  if (spec.format === "plain") {
    return {
      subject: filled.subject,
      text: filled.paragraphs.join("\n\n"),
    } as NotificationMail;
  }
  const layout = LAYOUT[spec.kind] ?? {};
  const label = options.action === undefined ? undefined : filled.actions[options.action.id];
  const body = renderEmail({
    preheader: filled.preheader,
    heading: filled.heading,
    paragraphs: filled.paragraphs,
    ...(options.code === undefined ? {} : { code: options.code }),
    ...(options.action === undefined || label === undefined
      ? {}
      : { action: { label, url: options.action.url } }),
    ...(layout.actionFirst === true ? { actionFirst: true } : {}),
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(filled.after.length === 0 ? {} : { after: filled.after }),
    footnote: filled.footnote,
    ...(layout.noLinks === true ? { noLinks: true } : {}),
    ...(layout.whatsappNudge === true ? { whatsappNudge: true } : {}),
  });
  return { subject: filled.subject, text: body.text, html: body.html } as NotificationMail;
}

/** The hosts a link in the wording may name: desiauction.in and PUBLIC_BASE_URL's. */
export function ownHosts(): string[] {
  return ownHostsFor(env.PUBLIC_BASE_URL);
}

function reportProblem(problem: TemplateProblem): void {
  // Logged, never thrown: the mail goes out in the default wording. An error,
  // not a warning — a published template that stopped validating is a
  // decision an admin made that is no longer reaching anybody.
  logger().error(
    {
      kind: problem.kind,
      language: problem.language,
      reason: problem.reason,
      version: problem.version,
      issues: problem.issues?.map((issue) => issue.message),
      err: problem.error,
    },
    "notification_template.fallback",
  );
}

/** The wording one send would use — for the renderer and the admin screen alike. */
export function wordingFor(
  kind: EmailNotificationKind,
  language: MessageLanguage,
  db: Db = appDb,
): Promise<ResolvedTemplate> {
  return resolveTemplate(db, kind, language, { ownHosts: ownHosts(), onProblem: reportProblem });
}

/**
 * THE ONE RENDERER. Published wording in `language`, else the default in
 * `language`, else English; the variables filled in; the layout applied. An
 * email is never blank or broken because of its wording.
 */
export async function renderNotificationEmail(
  kind: EmailNotificationKind,
  language: MessageLanguage,
  variables: TemplateVariables,
  options: RenderOptions = {},
  db: Db = appDb,
): Promise<NotificationMail> {
  const resolved = await wordingFor(kind, language, db);
  return composeNotificationEmail(
    resolved.spec,
    variantOf(resolved, options.variant),
    variables,
    options,
  );
}

export function templateSpecOf(kind: EmailNotificationKind): EmailTemplateSpec {
  return EMAIL_TEMPLATES[kind];
}
