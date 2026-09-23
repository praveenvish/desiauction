"use server";

import { headers } from "next/headers";

import { env } from "../../env";
import { clientIp } from "../../lib/client-ip";
import { currentSession } from "../auth/actions";
import { db } from "../db";
import { logger } from "../logger";
import { sendProblemReportMail } from "./problem-report-mail";
import {
  isReportThrottled,
  recordProblemReport,
  validateProblemReport,
  type ProblemReportField,
} from "./problem-reports";

/**
 * REPORT A PROBLEM (FR-1 Phase 1).
 *
 * The order of work is the demo form's, for the demo form's reasons:
 *
 *   honeypot → session → validate → throttle → INSERT → mail
 *
 * The row lands before anything is sent, so an unconfigured or failing mail
 * provider cannot lose a report the person has been told we have. Mail is
 * awaited (a server action's process may freeze the instant it returns) but
 * its outcome never fails the submission.
 *
 * IDENTITY COMES FROM THE SESSION, NEVER THE FORM. A hidden `personId` field
 * would let anybody file reports in somebody else's name.
 */

export interface ProblemReportState {
  readonly error?: string;
  readonly field?: ProblemReportField;
  readonly success?: boolean;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function parseContext(raw: string): unknown {
  if (raw === "" || raw.length > 4000) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

async function screenshotBytes(formData: FormData): Promise<Uint8Array | null> {
  const file = formData.get("screenshot");
  if (file === null || typeof file === "string" || file.size === 0) {
    return null;
  }
  return new Uint8Array(await file.arrayBuffer());
}

export async function submitProblemReportAction(
  _previous: ProblemReportState,
  formData: FormData,
): Promise<ProblemReportState> {
  // The honeypot: refusal looks like success, so a scraper learns nothing.
  if (field(formData, "company_website").trim() !== "") {
    return { success: true };
  }

  const session = await currentSession();

  const validated = validateProblemReport(
    {
      category: field(formData, "category"),
      description: field(formData, "description"),
      replyEmail: field(formData, "replyEmail"),
      pageUrl: field(formData, "pageUrl"),
      context: parseContext(field(formData, "context")),
      personId: session?.personId ?? null,
      requestIp: clientIp(await headers(), env.TRUSTED_PROXY_COUNT),
      screenshot: await screenshotBytes(formData),
    },
    env.PUBLIC_BASE_URL,
  );
  if (!validated.ok) {
    return { error: validated.message, field: validated.field };
  }
  const report = validated.value;

  if (await isReportThrottled(db, report.personId, report.requestIp)) {
    return { success: true };
  }

  const reportId = await recordProblemReport(db, report);

  const reporterLabel =
    session === null
      ? "a guest"
      : `${session.name ?? "a signed-in person"} (${session.email ?? session.phone ?? session.personId})`;
  // A receipt only to the signed-in person's OWN address (people.email is
  // written only once verified), and only when that is the address they gave.
  const receiptTo =
    session?.email !== null &&
    session?.email !== undefined &&
    report.replyEmail !== null &&
    report.replyEmail === session.email.toLowerCase()
      ? report.replyEmail
      : null;
  const outcomes = await sendProblemReportMail(db, report, reportId, reporterLabel, receiptTo);
  if (outcomes.support === "failed" || outcomes.reporter === "failed") {
    logger().error({ problemReportId: reportId, ...outcomes }, "support.report_mail_failed");
  }

  return { success: true };
}
