import { resolve } from "node:path";

import type { Db } from "@desiauction/db";
import type { DeliveryPort } from "@desiauction/financial-operations";
import {
  bucketArtifactStoreFromEnv,
  finopsDeps,
  type FinopsDeps,
} from "@desiauction/financial-operations/server";

import { env } from "../../env";
import { createHttpEmailAdapter, type EmailResolver } from "../messaging/email-adapter";
import { createPersonInAppAdapter, ownersOfRecipient } from "../messaging/in-app-adapter";
import { verifiedEmailOf } from "../auth/email-change";

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

/**
 * The email adapter, or null when the provider is not fully configured.
 *
 * Resolved once at module load rather than per request: the answer cannot
 * change without a restart, and a per-request check would invite a deploy where
 * half the requests mail and half write files.
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
 */
function resolveOwnerEmail(db: Db): EmailResolver {
  return async (recipientRef: string) => {
    const owners = await ownersOfRecipient(db, recipientRef);
    for (const personId of owners) {
      const email = await verifiedEmailOf(db, personId);
      if (email !== null) {
        return email;
      }
    }
    return null;
  };
}

/**
 * The email adapter, or null when the provider is not fully configured.
 *
 * Resolved once at module load rather than per request: the answer cannot
 * change without a restart, and a per-request check would invite a deploy where
 * half the requests mail and half write files.
 */
const emailAdapter: ((db: Db) => DeliveryPort) | null =
  env.EMAIL_API_ENDPOINT !== undefined &&
  env.EMAIL_API_KEY !== undefined &&
  env.EMAIL_FROM !== undefined
    ? (db: Db) =>
        createHttpEmailAdapter(
          {
            endpoint: env.EMAIL_API_ENDPOINT ?? "",
            apiKey: env.EMAIL_API_KEY ?? "",
            from: env.EMAIL_FROM ?? "",
          },
          resolveOwnerEmail(db),
        )
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
     */
    delivery: {
      "in-app": createPersonInAppAdapter(db),
      /*
       * Email is overridden ONLY when fully configured. Unconfigured, the
       * platform's filesystem outbox stays — it writes a file nobody reads,
       * which is the wrong outcome but a VISIBLE one. A half-configured mailer
       * that accepts documents and drops them is the same failure, silently.
       */
      ...(emailAdapter === null ? {} : { email: emailAdapter(db) }),
    },
  });
}
