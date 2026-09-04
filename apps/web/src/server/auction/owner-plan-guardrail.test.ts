import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * NOBODY BUT THE OWNER READS THE PLAN (WR-1).
 *
 * The database keeps rivals and plain members out with the participant-arm
 * policy. Two readers are NOT held by that policy and are held here instead:
 *
 *   · the platform admin explorer reads cross-tenant on the RLS-exempt system
 *     pool, so a projection that imported the plan tables would print every
 *     owner's ceiling to whoever holds platform:admin;
 *   · the engine and the auction package fold with BYPASSRLS credentials, and
 *     a plan is not auction truth — nothing they build may depend on it.
 *
 * This test greps, because an import is the only way in and a grep is the
 * cheapest gate that fails before a reviewer has to notice.
 */
const REPO = path.resolve(__dirname, "../../../../..");
const FORBIDDEN =
  /auctionTeamTargets|auction_team_targets|auctionTeamTargetRevisions|auction_team_target_revisions/;

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFilesUnder(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("WR-1 · the plan tables are imported only where an owner is reading", () => {
  for (const relative of [
    "apps/web/src/server/admin",
    "apps/web/src/app/admin",
    "apps/engine/src",
    "packages/auction/src",
  ]) {
    it(`${relative} never names them`, () => {
      const offenders = sourceFilesUnder(path.join(REPO, relative)).filter((file) =>
        FORBIDDEN.test(readFileSync(file, "utf8")),
      );
      expect(offenders.map((file) => path.relative(REPO, file))).toEqual([]);
    });
  }
});
