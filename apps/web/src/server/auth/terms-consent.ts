import { consentRecords, type Db } from "@desiauction/db";
import { and, eq } from "drizzle-orm";

import { recordConsent } from "../messaging/consent";

/**
 * THE DPDP SIGNUP NOTICE, RECORDED (PI-1 P2 — the named pre-GA obligation).
 *
 * The login form states, above the button, that continuing accepts the Terms
 * and Privacy Policy. This records that acceptance ONCE per person, at the
 * first successful sign-in after the notice shipped — which also covers every
 * account that predates it, on their next login, rather than only brand-new
 * ones. Idempotent by read-before-write; consent stays append-only.
 *
 * The version names the wording shown. Changing the notice text means a new
 * version here, and a fresh row on each person's next login — "did they agree
 * to what we showed on the day?" must stay answerable per wording.
 */
export const TERMS_CONSENT_PURPOSE = "terms.privacy";
export const TERMS_NOTICE_VERSION = "2026-08-30";

export async function ensureTermsConsent(db: Db, personId: string): Promise<void> {
  const rows = await db
    .select({ evidence: consentRecords.evidence })
    .from(consentRecords)
    .where(
      and(eq(consentRecords.personId, personId), eq(consentRecords.purpose, TERMS_CONSENT_PURPOSE)),
    );
  const alreadyThisVersion = rows.some(
    (row) => (row.evidence as { noticeVersion?: string }).noticeVersion === TERMS_NOTICE_VERSION,
  );
  if (alreadyThisVersion) {
    return;
  }
  await recordConsent(db, {
    personId,
    purpose: TERMS_CONSENT_PURPOSE,
    granted: true,
    source: "login",
    evidence: { noticeVersion: TERMS_NOTICE_VERSION },
  });
}
