import { consentRecords, people, type Db } from "@desiauction/db";
import { and, desc, eq, inArray } from "drizzle-orm";

import { isMessageLanguage, type MessageLanguage } from "./email-templates";

/**
 * ONE LANGUAGE PER PERSON, FOR EVERYTHING WE SEND THEM (founder decision,
 * 2026-09-23): email and WhatsApp read the same answer.
 *
 * THE RESOLUTION, first answer wins:
 *
 *   1. `people.language` (0087) — what they chose under "Language for
 *      messages" on /account, or on the registration form.
 *   2. The newest WhatsApp consent record that NAMES a language — how a
 *      language was chosen before there was a column for it. Not simply the
 *      newest record: a STOP sent from the phone and the START after it carry
 *      no language, and a Hindi reader who paused their messages must not come
 *      back to English.
 *   3. English.
 *
 * Here, in packages/messaging, because the finops runner resolves it too: a
 * receipt goes out in the owner's language like every other email.
 */

/** The consent purpose the WhatsApp opt-in is recorded under (0081). */
export const WHATSAPP_CONSENT_PURPOSE = "whatsapp.updates";

/** The language from a consent history, newest first — step 2 above. */
export function languageFromEvidence(
  newestFirst: readonly { readonly evidence: unknown }[],
): MessageLanguage | null {
  for (const record of newestFirst) {
    const evidence = record.evidence;
    if (typeof evidence === "object" && evidence !== null && "language" in evidence) {
      if (isMessageLanguage(evidence.language)) return evidence.language;
    }
  }
  return null;
}

/** The chain as a pure function, for the tests and for callers holding both answers. */
export function resolveLanguage(
  chosen: string | null | undefined,
  fromConsent: MessageLanguage | null,
): MessageLanguage {
  if (isMessageLanguage(chosen)) return chosen;
  return fromConsent ?? "en";
}

/**
 * Twenty rows is far more consent history than anybody makes, and bounds the
 * read for somebody who toggles the switch for fun.
 */
async function consentLanguage(db: Db, personId: string): Promise<MessageLanguage | null> {
  const history = await db
    .select({ evidence: consentRecords.evidence })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.personId, personId),
        eq(consentRecords.purpose, WHATSAPP_CONSENT_PURPOSE),
      ),
    )
    .orderBy(desc(consentRecords.createdAt))
    .limit(20);
  return languageFromEvidence(history);
}

export async function messageLanguageOf(db: Db, personId: string): Promise<MessageLanguage> {
  const [row] = await db
    .select({ language: people.language })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (isMessageLanguage(row?.language)) return row.language;
  return resolveLanguage(null, await consentLanguage(db, personId));
}

/**
 * The same, for a batch — the auction's ninety players at once. One read of
 * `people`; the consent history only for the few who never chose.
 */
export async function messageLanguagesOf(
  db: Db,
  personIds: readonly string[],
): Promise<Map<string, MessageLanguage>> {
  const out = new Map<string, MessageLanguage>();
  const unique = [...new Set(personIds)];
  if (unique.length === 0) return out;
  const rows = await db
    .select({ id: people.id, language: people.language })
    .from(people)
    .where(inArray(people.id, unique));
  const chosen = new Map(rows.map((row) => [row.id, row.language]));
  for (const personId of unique) {
    const language = chosen.get(personId);
    out.set(
      personId,
      isMessageLanguage(language)
        ? language
        : resolveLanguage(null, await consentLanguage(db, personId)),
    );
  }
  return out;
}

/** Set (or clear, with null) the one language — on the app pool; `people` has no RLS. */
export async function setMessageLanguage(
  db: Db,
  personId: string,
  language: MessageLanguage | null,
): Promise<void> {
  await db.update(people).set({ language }).where(eq(people.id, personId));
}
