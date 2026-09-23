import type { Db } from "@desiauction/db";
import type { EmailAdapterConfig, EmailTransport } from "@desiauction/messaging/email-adapter";
import { financeDeliveryAdapters } from "@desiauction/messaging/finance-delivery";

import { mailConfigured, type Env } from "./env";
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
export function mailConfigFor(env: Env): EmailAdapterConfig | null {
  if (env.EMAIL_PROVIDER === "dev" || !mailConfigured(env)) {
    // The file outbox stays. Production cannot reach this line: env.ts refuses
    // to boot a serving runner without a configured mailer.
    return null;
  }
  return {
    endpoint: env.EMAIL_API_ENDPOINT ?? "",
    apiKey: env.EMAIL_API_KEY ?? "",
    from: env.EMAIL_FROM ?? "",
  };
}

export function runnerDelivery(
  db: Db,
  env: Env,
  /** Tests stand in for the provider; nothing else should. */
  transport?: EmailTransport,
): ReturnType<typeof financeDeliveryAdapters> {
  const mail = mailConfigFor(env);
  return financeDeliveryAdapters(
    db,
    mail === null || transport === undefined ? mail : { ...mail, transport },
    {
      // A receipt's subject and opening lines are admin-editable wording
      // (notification_templates, 0087 — this role keeps SELECT on it). One that
      // no longer validates goes out in the default, and is said here.
      onTemplateProblem: (problem) => {
        logger.error(
          { kind: problem.kind, language: problem.language, reason: problem.reason },
          "notification_template.fallback",
        );
      },
    },
  );
}
