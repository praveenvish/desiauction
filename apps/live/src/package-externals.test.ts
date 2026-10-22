import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * The live image ships dist/index.mjs plus `pnpm deploy --prod` node_modules,
 * which holds only THIS package's dependencies. A package left external in the
 * bundle but brought in by a workspace package (ulidx via @desiauction/db) was
 * missing at runtime: the first production deploy crash-looped on
 * ERR_MODULE_NOT_FOUND. Every external must be a declared dependency.
 */
it("declares every package the bundle leaves external", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: { build: string }; dependencies: Record<string, string> };
  const externals = [...manifest.scripts.build.matchAll(/--external:(\S+)/g)].map(
    (match) => match[1] ?? "",
  );
  expect(externals.length).toBeGreaterThan(0);
  expect(externals.filter((name) => !(name in manifest.dependencies))).toEqual([]);
});
