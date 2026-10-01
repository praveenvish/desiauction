import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/**
 * The finops artifact root every LOCAL process falls back to: web, the seed and
 * the runner each start one directory below the repo root, so this lands all
 * three on `<repo>/.local/finops-artifacts`. Deployments set an absolute path
 * (preflight:production refuses this one).
 */
export const LOCAL_FINOPS_STORAGE_DIR = "../../.local/finops-artifacts";

/**
 * The primary checkout's root when `from` is inside a git checkout — the MAIN
 * one even when `from` is in a linked worktree — or null outside git (a
 * container image ships no `.git`).
 */
export function primaryCheckoutRoot(from: string): string | null {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) {
        return dir;
      }
      // A linked worktree: `.git` is a file naming its private git dir, and
      // that dir's `commondir` names the shared one the main checkout owns.
      const gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
      if (gitDir === undefined) {
        return null;
      }
      const privateDir = resolve(dir, gitDir);
      const commonFile = join(privateDir, "commondir");
      const commonDir = existsSync(commonFile)
        ? resolve(privateDir, readFileSync(commonFile, "utf8").trim())
        : privateDir;
      return basename(commonDir) === ".git" ? dirname(commonDir) : null;
    }
    if (dirname(dir) === dir) {
      return null;
    }
  }
}

/**
 * Where the finops artifact store lives, given the configured value.
 *
 * The local default used to resolve against the process cwd, i.e. against
 * whichever CHECKOUT the process ran in. The local database is not per
 * checkout: every worktree on this machine shares the one on :5436. So the seed
 * run in one checkout wrote demo-club's export artifact there, and a worktree's
 * web tier and runner then verified that same database row against their own
 * empty `.local`. The money board said "exports failed" and the runner recorded
 * a FAIL certification, over bytes that were fine one directory tree away.
 *
 * The default therefore resolves against the PRIMARY checkout, which every
 * worktree shares just as it shares the database. A value someone actually set
 * is honoured as given.
 */
export function resolveFinopsStorageDir(configured: string, cwd: string): string {
  if (configured === LOCAL_FINOPS_STORAGE_DIR) {
    const root = primaryCheckoutRoot(cwd);
    if (root !== null) {
      return join(root, ".local", "finops-artifacts");
    }
  }
  return isAbsolute(configured) ? configured : resolve(cwd, configured);
}
