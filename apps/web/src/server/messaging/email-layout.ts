import {
  applyWhatsAppNudge as applyNudgeWith,
  manageEmailsUrl as manageEmailsUrlFor,
  renderEmail as renderEmailWith,
  whatsappNudgeUrl as whatsappNudgeUrlFor,
  type EmailContent,
  type RenderedEmail,
} from "@desiauction/messaging/email-layout";

import { env } from "../../env";

/**
 * THE ONE LAYOUT, BOUND TO THIS SITE'S ADDRESS.
 *
 * The layout itself moved to packages/messaging (email programme PR10) so the
 * finops runner lays receipts out the same way; this module gives the web app
 * the same functions it always had, with PUBLIC_BASE_URL filled in.
 */

export {
  FOOTER_WORDS,
  SUPPORT_EMAIL,
  WHATSAPP_NUDGE_MARK,
  forceDarkEmail,
  hasWhatsAppNudge,
  type EmailBand,
  type EmailContent,
  type EmailDateLeaf,
  type EmailLanguage,
  type EmailStage,
  type EmailStep,
  type RenderedEmail,
} from "@desiauction/messaging/email-layout";

export function renderEmail(content: EmailContent): RenderedEmail {
  return renderEmailWith(content, env.PUBLIC_BASE_URL);
}

/** Where "Manage emails" goes: the notification switches on /account. */
export function manageEmailsUrl(): string {
  return manageEmailsUrlFor(env.PUBLIC_BASE_URL);
}

export function whatsappNudgeUrl(): string {
  return whatsappNudgeUrlFor(env.PUBLIC_BASE_URL);
}

/** Fill the WhatsApp nudge's mark, or leave the mail as written (the package's rules). */
export function applyWhatsAppNudge(
  mail: { readonly text: string; readonly html: string },
  show: boolean,
): { text: string; html: string } {
  return applyNudgeWith(mail, show, env.PUBLIC_BASE_URL);
}
