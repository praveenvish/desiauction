import { resolve } from "node:path";

import type { Db } from "@desiauction/db";
import { finopsDeps, type FinopsDeps } from "@desiauction/financial-operations/server";

import { env } from "../../env";
import { createPersonInAppAdapter } from "../messaging/in-app-adapter";

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

export function webFinopsDeps(db: Db): FinopsDeps {
  return finopsDeps(db, {
    storageDir: FINOPS_STORAGE_DIR,
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
    delivery: { "in-app": createPersonInAppAdapter(db) },
  });
}
