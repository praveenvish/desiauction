import type { Db } from "@desiauction/db";
import type { EmailAdapterConfig, EmailTransport } from "@desiauction/messaging/email-adapter";
import { financeDeliveryAdapters } from "@desiauction/messaging/finance-delivery";
import { mailProviderFromEnv } from "@desiauction/messaging/mail-provider";

import type { Env } from "./env";
import { logger } from "./logger";

/**
 * THE RUNNER'S DELIVERY ADAPTERS — the ones that actually reach a person.
 *
 * This process drains `dispatch.send`, so whatever it passes to `finopsDeps`
 * is what every receipt, invoice and correction is delivered WITH. It passed
 * nothing, and the certified package's defaults are a development pair: an
 * in-app adapter that confirms having written nothing, and an email outbox
 * that writes a file to this container's disk. So in production a paying team
 * owner received no email, saw nothing in /inbox, and the register said
 * "delivered".
 *
 * These are the web tier's adapters, from the package both tiers share: the
 * person-scoped in-app row /inbox reads, and the HTTP mailer behind the
 * notification gate (money topic — the /account "Receipts and money" switch,
 * the club's switch and the suppression list all apply). Injected through
 * `finopsDeps`' `delivery` override; the certified dispatch logic is untouched.
 *
 * `db` is the runner's service pool. Its role (desiauction_runner) is BYPASSRLS
 * with SELECT on every table the gate and resolver read (paddles, people,
 * suppressions, notification_preferences, org_messaging_settings,
 * consent_records, the platform switches and email wording of 0086–0087) and
 * INSERT on audit_log — none of them among the personal
 * tables 0083–0085 revoked. Should any read be refused, the adapter throws,
 * the job retries and then dead-letters: an honest failure, never "delivered".
 */
export function mailConfigFor(
  env: Env,
  /** Tests stand in for the provider; nothing else should. */
  transport?: EmailTransport,
): EmailAdapterConfig | null {
  // The file outbox stays when nothing is selected (`dev`, or not configured).
  // Production cannot reach that: env.ts refuses to boot a serving runner
  // without a configured mailer.
  const provider = mailProviderFromEnv(env, transport === undefined ? {} : { transport });
  return provider === null ? null : { provider };
}

export function runnerDelivery(
  db: Db,
  env: Env,
  /** Tests stand in for the provider; nothing else should. */
  transport?: EmailTransport,
): ReturnType<typeof financeDeliveryAdapters> {
  return financeDeliveryAdapters(db, mailConfigFor(env, transport), {
    // The receipt's branded HTML part lays out around the document itself
    // (packages/messaging email-layout.ts); the text part is unchanged.
    publicBaseUrl: env.PUBLIC_BASE_URL,
    // A receipt's subject and opening lines are admin-editable wording
    // (notification_templates, 0087 — this role keeps SELECT on it). One that
    // no longer validates goes out in the default, and is said here.
    onTemplateProblem: (problem) => {
      logger.error(
        { kind: problem.kind, language: problem.language, reason: problem.reason },
        "notification_template.fallback",
      );
    },
  });
}
