import type { Db } from "@desiauction/db";
import type { DeliveryPort, DispatchChannel } from "@desiauction/financial-operations";

import {
  createHttpEmailAdapter,
  type EmailAdapterConfig,
  type EmailResolver,
} from "./email-adapter";
import { notificationGate, type GateReason } from "./gate";
import { createPersonInAppAdapter, ownersOfRecipient } from "./in-app-adapter";
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
        return email;
      }
      withheld ??= decision.reason;
    }
    return withheld === null ? null : { withheld };
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
): Partial<Record<DispatchChannel, DeliveryPort>> {
  return {
    "in-app": createPersonInAppAdapter(db),
    ...(mail === null ? {} : { email: createHttpEmailAdapter(mail, resolveOwnerEmail(db)) }),
  };
}
