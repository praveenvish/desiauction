import { auditLog, newId, paddles, type Db } from "@desiauction/db";
import type { DeliveryPort } from "@desiauction/financial-operations";
import { eq } from "drizzle-orm";

/**
 * IN-APP DELIVERY THAT ACTUALLY DELIVERS.
 *
 * The platform's own in-app adapter returns `{ok: true, confirmed}` having done
 * nothing at all. Its reasoning — "delivery IS visibility, the dispatch
 * register is the tray a signed-in officer reads" — describes the OPERATOR's
 * tray. That register is `finops.view`-gated, so the person the document is
 * addressed to gets a 404 from it.
 *
 * The consequence, traced end to end during the Screen 20 review: a team owner
 * pays lakhs, a numbered receipt is sealed, the finance desk records the
 * delivery as succeeded, and the payer can see it on exactly zero surfaces.
 *
 * This adapter is injected over that one through `finopsDeps`' `delivery`
 * override, so the frozen module is not touched. It writes a person-scoped
 * audit row, which is precisely what `/inbox` reads — the notification store
 * the product already has, rather than a second one invented beside it.
 *
 * WHY THE RECIPIENT LOOKUP IS NOT A SIMPLE ONE.
 * `recipientRef` is `owner:<id>`, and that id is a TEAM, not a person — an
 * earlier fix assumed otherwise and resolved it against `people`, where it
 * matched zero rows on every dispatch in the database. Team ownership lives in
 * `paddles`, which records which person bid for which team. So the chain is
 * team → paddle → person, and a team nobody claimed a paddle for has no one to
 * notify.
 */

/** What the inbox will render. Kept here so the label map has one thing to match. */
export const FINANCE_DOCUMENT_ISSUED = "finance.document.issued";

export function createPersonInAppAdapter(db: Db): DeliveryPort {
  return {
    channel: "in-app",
    async send(request) {
      const providerRef = `in-app:${request.dispatchId}`;
      const teamId = request.recipientRef.startsWith("owner:")
        ? request.recipientRef.slice("owner:".length)
        : "";
      if (teamId === "") {
        // A recipient shape we do not understand. Fail LOUDLY rather than
        // confirming: a silent success here is the exact defect being replaced.
        return { ok: false as const, code: "recipient_unresolved", retryable: false };
      }
      const owners = await db
        .selectDistinct({ personId: paddles.personId })
        .from(paddles)
        .where(eq(paddles.teamId, teamId));
      if (owners.length === 0) {
        // Nobody claimed a paddle for this team, so there is no person to tell.
        // Retryable: an owner may accept and claim after the document is issued.
        return { ok: false as const, code: "recipient_unresolved", retryable: true };
      }
      for (const owner of owners) {
        await db.insert(auditLog).values({
          id: newId(),
          actor: owner.personId,
          action: FINANCE_DOCUMENT_ISSUED,
          // Person-scoped, which is what listSecurityEvents reads and therefore
          // what puts this in front of the person it is about.
          scopeType: "person",
          scopeId: owner.personId,
          subject: request.subjectRef,
          meta: {
            channel: "in-app",
            template: `${request.templateId}@${request.templateVersion}`,
            dispatchId: request.dispatchId,
          },
        });
      }
      // Confirmed only now, and only because a row exists to confirm.
      return {
        ok: true as const,
        providerRef,
        confirmed: { providerEventRef: `${providerRef}:inbox` },
      };
    },
  };
}
