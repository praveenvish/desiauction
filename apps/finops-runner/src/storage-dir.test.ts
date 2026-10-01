import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LOCAL_FINOPS_STORAGE_DIR,
  primaryCheckoutRoot,
  resolveFinopsStorageDir,
} from "@desiauction/messaging/finops-storage";
import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

/**
 * ONE ARTIFACT ROOT PER DATABASE, NOT PER CHECKOUT.
 *
 * Every worktree on a developer's machine shares the one local database, but
 * the finops artifact root resolved against each checkout's own cwd. The seed,
 * run in the main checkout, wrote demo-club's export there; a worktree's web
 * tier and runner verified the same database row against an empty `.local`,
 * and the money board read "exports failed" and the runner certified FAIL.
 */

/** A main checkout at `<tmp>/main` and a linked worktree at `<tmp>/wt`, laid
 *  out on disk exactly as `git worktree add` does. */
function checkouts(): { main: string; worktree: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "finops-root-")));
  const main = join(base, "main");
  const worktree = join(base, "wt");
  const privateGitDir = join(main, ".git", "worktrees", "wt");
  mkdirSync(privateGitDir, { recursive: true });
  writeFileSync(join(privateGitDir, "commondir"), "../..\n");
  mkdirSync(join(main, "apps", "finops-runner"), { recursive: true });
  mkdirSync(join(worktree, "apps", "finops-runner"), { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${privateGitDir}\n`);
  return { main, worktree };
}

describe("the finops artifact root", () => {
  it("is the runner's default, and the web tier's (pinned in web env.regression)", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://u:p@localhost:5436/db" });
    expect(env.FINOPS_STORAGE_DIR).toBe(LOCAL_FINOPS_STORAGE_DIR);
  });

  it("resolves the default to the PRIMARY checkout from a linked worktree", () => {
    const { main, worktree } = checkouts();
    expect(primaryCheckoutRoot(join(worktree, "apps", "finops-runner"))).toBe(main);
    expect(
      resolveFinopsStorageDir(LOCAL_FINOPS_STORAGE_DIR, join(worktree, "apps", "finops-runner")),
    ).toBe(join(main, ".local", "finops-artifacts"));
  });

  it("is unchanged in the main checkout — the one CI has", () => {
    const { main } = checkouts();
    expect(
      resolveFinopsStorageDir(LOCAL_FINOPS_STORAGE_DIR, join(main, "apps", "finops-runner")),
    ).toBe(join(main, ".local", "finops-artifacts"));
  });

  it("falls back to the cwd outside git (a container image ships no .git)", () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "finops-nogit-")));
    const cwd = join(bare, "app", "srv");
    expect(resolveFinopsStorageDir(LOCAL_FINOPS_STORAGE_DIR, cwd)).toBe(
      join(bare, ".local", "finops-artifacts"),
    );
  });

  it("honours a value someone actually set", () => {
    const { worktree } = checkouts();
    const cwd = join(worktree, "apps", "finops-runner");
    expect(resolveFinopsStorageDir("/var/lib/desiauction/finops", cwd)).toBe(
      "/var/lib/desiauction/finops",
    );
    expect(resolveFinopsStorageDir("./artifacts", cwd)).toBe(join(cwd, "artifacts"));
  });
});
