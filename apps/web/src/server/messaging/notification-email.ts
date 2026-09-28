import type { Db } from "@desiauction/db";
import type { EmailNotificationKind } from "@desiauction/messaging/catalogue";
import { financeDocumentMail } from "@desiauction/messaging/email-adapter";
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
import {
  manageEmailsUrl,
  renderEmail,
  type EmailBand,
  type EmailDateLeaf,
  type EmailFixture,
  type EmailMatchup,
  type EmailStage,
  type EmailStep,
} from "./email-layout";
import { isSelfManagedKind } from "./unsubscribe";

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
 *   · calloutLast: the closing "didn't ask?" / "wasn't you?" line boxed.
 */
const LAYOUT: Readonly<
  Partial<
    Record<
      EmailNotificationKind,
      { noLinks?: boolean; actionFirst?: boolean; whatsappNudge?: boolean; calloutLast?: boolean }
    >
  >
> = {
  // The last line of a code or a security alert — "didn't ask for this?",
  // "if it wasn't you" — is the one a worried reader looks for: boxed.
  "auth.email_code": { noLinks: true, calloutLast: true },
  "security.email_changed": { calloutLast: true },
  "security.phone_changed": { calloutLast: true },
  // "Think this is a mistake?" under a take-down: the way back, boxed.
  "season.held": { calloutLast: true },
  // "This link is yours alone" — the one line an invited owner must not miss.
  "owner.invite": { calloutLast: true },
  "club.invite": { calloutLast: true },
  // "Not someone you expected?" — the way to take access back, boxed.
  "club.member_joined": { calloutLast: true },
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
  /** The reader's language — the document's `lang` and its fonts. English when omitted. */
  readonly language?: MessageLanguage;
  /** The club band — whose season this is. Facts, written by the caller in `language`. */
  readonly band?: EmailBand;
  /** Where the player is in the season (player-mail.ts `journey`). */
  readonly progress?: readonly EmailStep[];
  /** A date tile — auction night (auction-schedule-mail.ts). */
  readonly dateLeaf?: EmailDateLeaf;
  /** The auction-night stage — a sale (player-mail.ts `soldMail`). */
  readonly stage?: EmailStage;
  /** A list of matches — a team's schedule, a busy match day (fixture-mail.ts). */
  readonly fixtures?: readonly EmailFixture[];
  /** The match at the top of the card — match day, a lineup (fixture-mail.ts). */
  readonly matchup?: EmailMatchup;
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
    ...(options.band === undefined ? {} : { band: options.band }),
    ...(options.progress === undefined ? {} : { progress: options.progress }),
    ...(options.dateLeaf === undefined ? {} : { dateLeaf: options.dateLeaf }),
    ...(options.stage === undefined ? {} : { stage: options.stage }),
    ...(options.fixtures === undefined ? {} : { fixtures: options.fixtures }),
    ...(options.matchup === undefined ? {} : { matchup: options.matchup }),
    ...(filled.after.length === 0 ? {} : { after: filled.after }),
    footnote: filled.footnote,
    ...(layout.noLinks === true ? { noLinks: true } : {}),
    ...(layout.whatsappNudge === true ? { whatsappNudge: true } : {}),
    ...(options.language === undefined ? {} : { language: options.language }),
    // "Manage emails" exactly where the one-click unsubscribe header goes: the
    // reader has an /account switch for this kind (unsubscribe.ts).
    ...(isSelfManagedKind(spec.kind) ? { manageUrl: manageEmailsUrl() } : {}),
    ...(layout.calloutLast === true ? { calloutLast: true } : {}),
  });
  return { subject: filled.subject, text: body.text, html: body.html } as NotificationMail;
}

/**
 * A finance document's mail as the runner sends it (email programme PR10):
 * the registry's wording, the document, and the branded part around them —
 * for the admin preview and the mail gallery, which must show what goes out.
 */
export function financeDocumentPreviewMail(
  fields: TemplateFields,
  document: string,
  templateId: string,
  language: MessageLanguage,
  orgName: string | null,
): NotificationMail {
  return financeDocumentMail(fields, document, {
    publicBaseUrl: env.PUBLIC_BASE_URL,
    templateId,
    language,
    orgName,
  }) as NotificationMail;
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
  return composeNotificationEmail(resolved.spec, variantOf(resolved, options.variant), variables, {
    ...options,
    language,
  });
}

export function templateSpecOf(kind: EmailNotificationKind): EmailTemplateSpec {
  return EMAIL_TEMPLATES[kind];
}
