import type { Db } from "@desiauction/db";
import type { DeliveryPort, DispatchChannel } from "@desiauction/financial-operations";

import {
  createHttpEmailAdapter,
  financeDocumentMail,
  financeVariantFor,
  type EmailAdapterConfig,
  type EmailResolver,
} from "./email-adapter";
import { ownHostsFor } from "./email-templates";
import { notificationGate, type GateReason } from "./gate";
import { createPersonInAppAdapter, ownersOfRecipient } from "./in-app-adapter";
import { messageLanguageOf } from "./language";
import { resolveTemplate, variantOf, type TemplateProblem } from "./template-store";
import { verifiedEmailOf } from "./verified-email";

/**
 * THE FINANCIAL-DOCUMENT DELIVERY ADAPTERS, built in ONE place for BOTH tiers.
 *
 * `finopsDeps` defaults to adapters that deliver nothing a person sees: an
 * in-app adapter that confirms having written nothing, and an email "outbox"
 * that writes a `.txt` file to the runner's disk. The web tier had replaced
 * both since the Screen 20 review — but the web tier never SENDS a dispatch.
 * `dispatch.send` jobs are drained by the finops runner, which built its deps
 * with no override at all, so in production every receipt, invoice and
 * correction was "delivered" to a file and a no-op, and nobody received one.
 *
 * The runner cannot import apps/web (depcruise: apps never import apps), so
 * the adapters, the notification gate they must pass and the catalogue it
 * reads live in this package, and `webFinopsDeps` and the runner both inject
 * what this function returns through `finopsDeps`' `delivery` override. The
 * certified dispatch logic in packages/financial-operations is untouched: the
 * override is the seam it was built with.
 */

/**
 * Resolve a dispatch's recipient to a VERIFIED address, or null.
 *
 * `verifiedEmailOf` reads `email_verified_at`, never the column alone — an
 * address somebody typed and never confirmed is a string, and the adapter
 * refusing `no_email_on_file` remains the correct outcome for it. A club's
 * receipt carries a name, an amount and a competition; a mistyped domain would
 * put all three in a stranger's inbox.
 *
 * A team can have more than one person who accepted ownership (only one holds
 * the paddle). The FIRST with a verified address is used: the document is
 * addressed to the team, one copy is what "delivered" means, and mailing every
 * owner would make one dispatch several deliveries the register cannot count.
 *
 * THROUGH THE GATE, on the money topic. This path never asked, so the
 * "Receipts and money" switch on /account — the one switch whose own wording
 * names receipts — stopped nothing. An owner who switched it off is skipped
 * and the next owner with an address is tried; when every address is withheld
 * the first reason is reported (email-adapter.ts turns it into a terminal
 * `withheld:<reason>` failure, never a delivery).
 *
 * `db` must see the club's own switch (`org_messaging_settings`, FORCE RLS).
 * The web tier passes the tenant handle scoped to the dispatch's org; the
 * runner passes its service pool, whose role is BYPASSRLS — and `maySend`
 * filters that table by `org_id` explicitly, so it reads exactly this club's
 * row either way.
 */
export function resolveOwnerEmail(db: Db): EmailResolver {
  return async (recipientRef, { orgId }) => {
    const owners = await ownersOfRecipient(db, recipientRef);
    let withheld: GateReason | null = null;
    for (const personId of owners) {
      const email = await verifiedEmailOf(db, personId);
      if (email === null) {
        continue;
      }
      const decision = await notificationGate(db, {
        kind: "finance.document.issued",
        channel: "email",
        recipient: { personId, contact: email },
        orgId,
      });
      if (decision.send) {
        // With the person, so the mail is written in their language.
        return { to: email, personId };
      }
      withheld ??= decision.reason;
    }
    return withheld === null ? null : { withheld };
  };
}

export interface FinanceMailOptions {
  /** PUBLIC_BASE_URL, where the tier has one: a link to it is our own. */
  readonly publicBaseUrl?: string;
  /** Told when published wording could not be read or failed validation. */
  readonly onTemplateProblem?: (problem: TemplateProblem) => void;
}

/**
 * THE WORDING OF A DOCUMENT EMAIL (Notification Control Center, Phase 2): the
 * owner's language, the published subject and opening paragraphs for this
 * document type if an admin wrote any, the code default otherwise — and then
 * the certified document text, whole, which no template can touch.
 *
 * Why the runner reads `notification_templates` at all (0087 keeps its
 * SELECT): it is the process that sends receipts, so an edited receipt subject
 * that only the web tier could see would be an edit that never reached anyone.
 */
export function composeFinanceMail(db: Db, options: FinanceMailOptions = {}) {
  const ownHosts = ownHostsFor(options.publicBaseUrl);
  return async (
    request: { readonly templateId: string; readonly body: string },
    recipient: { readonly personId: string | null },
  ): Promise<{ subject: string; text: string }> => {
    const language =
      recipient.personId === null ? "en" : await messageLanguageOf(db, recipient.personId);
    const resolved = await resolveTemplate(db, "finance.document.issued", language, {
      ownHosts,
      ...(options.onTemplateProblem === undefined ? {} : { onProblem: options.onTemplateProblem }),
    });
    return financeDocumentMail(
      variantOf(resolved, financeVariantFor(request.templateId)),
      request.body,
    );
  };
}

/**
 * The `delivery` overrides for `finopsDeps`.
 *
 * In-app is ALWAYS the person-scoped adapter: it writes the audit row /inbox
 * reads, and the gate is applied where that row is read (gate.ts).
 *
 * Email is overridden only when `mail` is given — the caller decides what
 * "configured" means for its tier (the web tier: all three settings present;
 * the runner: that, and production refuses to boot without it). Left out, the
 * platform's filesystem outbox stays, which is the right thing in development
 * and exactly what production must never run.
 */
export function financeDeliveryAdapters(
  db: Db,
  mail: EmailAdapterConfig | null,
  options: FinanceMailOptions = {},
): Partial<Record<DispatchChannel, DeliveryPort>> {
  return {
    "in-app": createPersonInAppAdapter(db),
    ...(mail === null
      ? {}
      : {
          email: createHttpEmailAdapter(
            { compose: composeFinanceMail(db, options), ...mail },
            resolveOwnerEmail(db),
          ),
        }),
  };
}
