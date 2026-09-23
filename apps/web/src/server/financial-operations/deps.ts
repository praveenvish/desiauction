import { resolve } from "node:path";

import type { Db } from "@desiauction/db";
import {
  bucketArtifactStoreFromEnv,
  finopsDeps,
  type FinopsDeps,
} from "@desiauction/financial-operations/server";

import type { EmailAdapterConfig } from "@desiauction/messaging/email-adapter";
import {
  financeDeliveryAdapters,
  resolveOwnerEmail,
} from "@desiauction/messaging/finance-delivery";

import { env } from "../../env";
import { logger } from "../logger";

/**
 * The web tier's FinOps dependencies — built in exactly ONE place (PX-8).
 *
 * `finopsDeps` defaults its artifact + outbox root to `os.tmpdir()`. That
 * default is a trap for a multi-process deployment: the runner GENERATES export
 * artifacts and the web tier VERIFIES them, so if the two resolve different
 * roots, `verifyExport` cannot find the bytes, the exports component reports
 * `failed`, and the ops board shows a permanent RED that no operator action can
 * clear — a lie, produced entirely by configuration.
 *
 * This module is the fix: one env-configured root, shared by web, the seed and
 * the runner. Production replaces the filesystem store with the S3-compatible
 * one (IP-6 freeze, pre-deploy) — the port does not change, only the adapter.
 */
export const FINOPS_STORAGE_DIR: string = resolve(process.cwd(), env.FINOPS_STORAGE_DIR);

// Moved to packages/messaging with the adapters (the runner needs it too);
// re-exported for the regression suite that drives it directly.
export { resolveOwnerEmail };

/**
 * The email adapter, or null when the provider is not fully configured.
 *
 * Resolved once at module load rather than per request: the answer cannot
 * change without a restart, and a per-request check would invite a deploy where
 * half the requests mail and half write files.
 */
const emailConfig: EmailAdapterConfig | null =
  env.EMAIL_API_ENDPOINT !== undefined &&
  env.EMAIL_API_KEY !== undefined &&
  env.EMAIL_FROM !== undefined
    ? { endpoint: env.EMAIL_API_ENDPOINT, apiKey: env.EMAIL_API_KEY, from: env.EMAIL_FROM }
    : null;

// PRR P1-4: the shared S3 store when configured, otherwise the filesystem store
// (finopsDeps falls back to it when `artifacts` is undefined). Built once.
const artifactStore = bucketArtifactStoreFromEnv(env) ?? undefined;

export function webFinopsDeps(db: Db): FinopsDeps {
  return finopsDeps(db, {
    storageDir: FINOPS_STORAGE_DIR,
    ...(artifactStore === undefined ? {} : { artifacts: artifactStore }),
    /*
     * The platform's own in-app adapter confirms every dispatch having done
     * nothing, on the reasoning that the dispatch register IS the delivery.
     * That register is finance-gated, so the person the document is addressed
     * to gets a 404 from it — a paying team owner could see their receipt on
     * zero surfaces.
     *
     * `finopsDeps` takes adapter overrides, so the fix is an injection rather
     * than a change to the frozen module: this one resolves the recipient to
     * the people who actually bid for that team and writes each a person-scoped
     * row, which is what /inbox reads.
     *
     * Email is overridden ONLY when fully configured. Unconfigured, the
     * platform's filesystem outbox stays — it writes a file nobody reads,
     * which is the wrong outcome but a VISIBLE one. A half-configured mailer
     * that accepts documents and drops them is the same failure, silently.
     *
     * The runner, which is what actually SENDS dispatches, injects the same
     * adapters (packages/messaging/src/finance-delivery.ts); this copy serves
     * the web tier's reads of `configured` and the provider callback route.
     */
    delivery: financeDeliveryAdapters(db, emailConfig, {
      publicBaseUrl: env.PUBLIC_BASE_URL,
      onTemplateProblem: (problem) => {
        logger().error(
          { kind: problem.kind, language: problem.language, reason: problem.reason },
          "notification_template.fallback",
        );
      },
    }),
  });
}
