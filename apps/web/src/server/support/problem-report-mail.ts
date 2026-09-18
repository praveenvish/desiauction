import { env } from "../../env";
import { transactionalMailer, type MailOutcome } from "../messaging/transactional-mail";
import type { ProblemCategory, ValidProblemReport } from "./problem-reports";

/**
 * WHAT WE SAY BACK (FR-1 Phase 1).
 *
 * Two messages. The support inbox gets the report with the screenshot attached
 * and a link to the desk, so it can be read and answered from a phone. The
 * reporter — only if they left an address — gets a receipt that says what
 * happens next and does not promise a fix.
 *
 * NOT THROUGH THE CONSENT GATE, for the reason `demo-mail.ts` gives: this is a
 * transactional reply to an address typed into a form seconds ago on the
 * promise of exactly this message. It may never be reused for anything else.
 *
 * NEITHER MESSAGE CAN FAIL THE SUBMISSION. The report is already in the
 * database and the person has been told so on screen; mail is layered on top.
 */

const SUPPORT_EMAIL = "support@desiauction.in";

export const CATEGORY_WORDS: Record<ProblemCategory, string> = {
  bug: "Something is broken",
  confusing: "Something is confusing",
  idea: "An idea",
  other: "Something else",
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** One line, safe for a subject: no newlines, bounded. */
function firstLine(text: string, limit = 70): string {
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

export function supportNotification(
  report: ValidProblemReport,
  reportId: string,
  reporterLabel: string,
): { subject: string; text: string } {
  const contextLines = Object.entries(report.context).map(([key, value]) => `  ${key}: ${value}`);
  return {
    subject: `[Report] ${CATEGORY_WORDS[report.category]} — ${firstLine(report.description)}`,
    text: [
      `${CATEGORY_WORDS[report.category]}, from ${reporterLabel}`,
      report.replyEmail === null ? "No reply address given." : `Reply to: ${report.replyEmail}`,
      "",
      `Page: ${report.pageUrl}`,
      ...(contextLines.length > 0 ? ["", "Context:", ...contextLines] : []),
      "",
      report.description,
      "",
      report.screenshot === null ? "No screenshot." : "Screenshot attached.",
      "",
      `${env.PUBLIC_BASE_URL}/admin/reports#${reportId}`,
    ].join("\n"),
  };
}

export function reporterAcknowledgement(report: ValidProblemReport): {
  subject: string;
  text: string;
} {
  return {
    subject: "We've got your report — DesiAuction",
    text: [
      "Hi,",
      "",
      "Thanks for telling us. Your report has reached the team, with the page you were on",
      report.screenshot === null ? "so we can look at it." : "and the screenshot you sent.",
      "",
      // The description is NOT repeated here. This mail goes to an address the
      // form was given, and repeating what was typed turned the form into a
      // way to send any text, from us, to anyone ("your account is suspended,
      // verify at…"). The team has the words; the reporter wrote them.
      "We read every report. If we need more detail, or once it's fixed, we'll write back",
      "to this address.",
      "",
      `If it's urgent — an auction is live right now — write to ${SUPPORT_EMAIL} and say so`,
      "in the subject line.",
      "",
      "— DesiAuction",
    ].join("\n"),
  };
}

/**
 * Send the team's copy, and a receipt to `receiptTo` when there is one.
 *
 * The receipt address is decided by the CALLER from the session, never taken
 * from the form: a guest's `replyEmail` is a string anybody can type, and a
 * receipt sent to it is a mail from DesiAuction to a stranger. It stays on the
 * report for the team to reply to by hand.
 */
export async function sendProblemReportMail(
  report: ValidProblemReport,
  reportId: string,
  reporterLabel: string,
  receiptTo: string | null,
): Promise<{ reporter: MailOutcome | "no-address"; support: MailOutcome }> {
  const mailer = transactionalMailer();

  const support = await mailer.send({
    to: SUPPORT_EMAIL,
    ...supportNotification(report, reportId, reporterLabel),
    ...(report.screenshot === null
      ? {}
      : {
          attachment: {
            filename: `report-${reportId}.${EXTENSIONS[report.screenshot.contentType] ?? "img"}`,
            contentType: report.screenshot.contentType,
            contentBase64: Buffer.from(report.screenshot.bytes).toString("base64"),
          },
        }),
  });

  const reporter: MailOutcome | "no-address" =
    receiptTo === null
      ? "no-address"
      : await mailer.send({ to: receiptTo, ...reporterAcknowledgement(report) });

  return { reporter, support };
}
