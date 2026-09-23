import type { Db } from "@desiauction/db";
import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import { languageForMail, sendNotificationMail, type GatedMailOutcome } from "../messaging/notify";
import { renderNotificationEmail, type NotificationMail } from "../messaging/notification-email";
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
): Promise<NotificationMail> {
  const contextLines = Object.entries(report.context).map(([key, value]) => `  ${key}: ${value}`);
  return renderNotificationEmail("staff.problem_report", "en", {
    category: CATEGORY_WORDS[report.category],
    summary: firstLine(report.description),
    reporter: reporterLabel,
    replyLine:
      report.replyEmail === null ? "No reply address given." : `Reply to: ${report.replyEmail}`,
    pageUrl: report.pageUrl,
    contextBlock: contextLines.length > 0 ? ["", "", "Context:", ...contextLines].join("\n") : "",
    description: report.description,
    screenshotLine: report.screenshot === null ? "No screenshot." : "Screenshot attached.",
    deskUrl: `${env.PUBLIC_BASE_URL}/admin/reports#${reportId}`,
  });
}

/**
 * The receipt. The description is NOT repeated in it: this mail goes to an
 * address the form was given, and repeating what was typed turned the form
 * into a way to send any text, from us, to anyone ("your account is
 * suspended, verify at…"). The team has the words; the reporter wrote them.
 */
export function reporterAcknowledgement(
  report: ValidProblemReport,
  language: MessageLanguage = "en",
): Promise<NotificationMail> {
  const withShot = report.screenshot !== null;
  const clause =
    language === "hi"
      ? withShot
        ? ", और आपका भेजा स्क्रीनशॉट भी।"
        : " ताकि हम इसे देख सकें।"
      : withShot
        ? "and the screenshot you sent."
        : "so we can look at it.";
  return renderNotificationEmail("support.report_received", language, {
    screenshotClause: clause,
  });
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
  db: Db,
  report: ValidProblemReport,
  reportId: string,
  reporterLabel: string,
  receiptTo: string | null,
): Promise<{ reporter: GatedMailOutcome | "no-address"; support: GatedMailOutcome }> {
  // Both through the gate (catalogue `staff.problem_report`,
  // `support.report_received`): our own notice can only be stopped by a
  // platform admin, the receipt by a bounce or complaint on that address.
  const { outcome: support } = await sendNotificationMail(
    db,
    { kind: "staff.problem_report", to: SUPPORT_EMAIL },
    {
      ...(await supportNotification(report, reportId, reporterLabel)),
      ...(report.screenshot === null
        ? {}
        : {
            attachment: {
              filename: `report-${reportId}.${EXTENSIONS[report.screenshot.contentType] ?? "img"}`,
              contentType: report.screenshot.contentType,
              contentBase64: Buffer.from(report.screenshot.bytes).toString("base64"),
            },
          }),
    },
  );

  const reporter: GatedMailOutcome | "no-address" =
    receiptTo === null
      ? "no-address"
      : (
          await sendNotificationMail(
            db,
            { kind: "support.report_received", to: receiptTo },
            await reporterAcknowledgement(report, await languageForMail(db, { email: receiptTo })),
          )
        ).outcome;

  return { reporter, support };
}
