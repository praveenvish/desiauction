import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * THE CLIENT/SERVER IMPORT BOUNDARY.
 *
 * A production build break shipped through six screens of review and was found
 * by accident. A `"use client"` component imported a pure arithmetic helper
 * from `server/financial-operations/views.ts`; that module imports
 * `@desiauction/db`, which imports `postgres`, which imports node's `net`. The
 * browser bundle therefore pulled in a database driver and `next build` failed
 * with "Module not found: Can't resolve 'net'".
 *
 * Every gate in this repo passed the entire time — lint, typecheck, format and
 * five hundred integration tests. None of them resolves a client bundle, so
 * none of them could see it. Only a full production build could, and a full
 * production build is minutes long and needs a database and a valid
 * environment, which is why nobody ran one.
 *
 * This test is the cheap version of that build. It reads the source, follows
 * the non-type imports out of every client component, and fails if the closure
 * reaches a module that imports a server-only package. It runs in milliseconds
 * and needs nothing but the filesystem.
 *
 * Why a test and not a dependency-cruiser rule: the boundary IS the
 * `"use client"` directive, and dependency-cruiser matches on paths, not on
 * file contents. A path rule would have to forbid `app/** -> server/**`
 * wholesale, which is wrong — server components under `app/` import from
 * `server/` correctly and constantly.
 *
 * `import type` is deliberately allowed through: type-only imports are erased
 * before bundling, which is exactly how a client component may keep using
 * `RegisterRow` from a module it must not execute.
 *
 * `"use server"` modules are also allowed through, and this is the crux of the
 * original bug. A client component importing a server action is correct and
 * ordinary — Next replaces the import with an RPC stub and the module never
 * enters the bundle. `server/marketing/actions.ts` reaches `@desiauction/db`
 * and is imported by a client form every day without trouble. What broke the
 * build was `server/financial-operations/views.ts`, which carries NO directive,
 * so importing it really does bundle it. The directive is the boundary; the
 * directory name is not.
 */

// `src`, not this file's own directory: the scan must cover every client
// component in the app, and this test lives under `src/components` only
// because that is one of the three trees `pnpm test:integration` runs
// (`vitest run src/server src/components src/content`). A guard outside the
// glob is a guard that never runs — which is how the original break shipped.
const WEB_SRC = resolve(__dirname, "..");

/** Packages that drag a Node runtime into whatever imports them. */
const SERVER_ONLY = [
  "@desiauction/db",
  "@desiauction/financial-operations/server",
  "@desiauction/settlement",
  "postgres",
  "node:fs",
  "node:net",
  "node:crypto",
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Value imports only. `import type { X }` and `import { type X }` are erased at
 * compile time and cannot pull a runtime dependency into the bundle.
 */
function valueImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const typeOnlyKeyword = match[1] !== undefined;
    const clause = match[2] ?? "";
    const specifier = match[3] ?? "";
    if (typeOnlyKeyword || specifier === "") {
      continue;
    }
    // `import { type A, type B } from "x"` is also fully erased.
    const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (named !== null) {
      const parts = (named[1] ?? "").split(",").filter((p) => p.trim() !== "");
      if (parts.length > 0 && parts.every((p) => p.trim().startsWith("type "))) {
        continue;
      }
    }
    specifiers.push(specifier);
  }
  return specifiers;
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Not this one — try the next shape.
    }
  }
  return null;
}

/** The first server-only package this file reaches, and the path it took. */
function reachesServerOnly(entry: string): { via: string[]; pkg: string } | null {
  const seen = new Set<string>();
  const queue: { file: string; trail: string[] }[] = [{ file: entry, trail: [entry] }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next.file)) {
      continue;
    }
    seen.add(next.file);
    let source: string;
    try {
      source = readFileSync(next.file, "utf8");
    } catch {
      continue;
    }
    // A "use server" module is an RPC boundary, not a bundling one: Next
    // replaces the import with a stub and the body never reaches the browser.
    // Stop here rather than following it into the database layer. This is only
    // safe BELOW the entry point — the entry itself is a client component.
    if (next.file !== entry && /^["']use server["']/.test(source.trimStart())) {
      continue;
    }
    for (const specifier of valueImports(source)) {
      const server = SERVER_ONLY.find(
        (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
      );
      if (server !== undefined) {
        return { via: next.trail, pkg: server };
      }
      const local = resolveLocal(next.file, specifier);
      if (local !== null) {
        queue.push({ file: local, trail: [...next.trail, local] });
      }
    }
  }
  return null;
}

describe("the client/server import boundary", () => {
  const clients = sourceFiles(WEB_SRC).filter((file) =>
    /^["']use client["']/.test(readFileSync(file, "utf8").trimStart()),
  );

  it("finds the client components (so a silent zero cannot pass this suite)", () => {
    expect(clients.length).toBeGreaterThan(50);
  });

  it("no client component reaches a server-only package through a value import", () => {
    const offenders = clients
      .map((file) => ({ file, hit: reachesServerOnly(file) }))
      .filter((row) => row.hit !== null)
      .map(({ file, hit }) => {
        const trail = (hit?.via ?? []).map((f) => relative(WEB_SRC, f)).join("\n      -> ");
        return `${relative(WEB_SRC, file)}\n      -> ${trail}\n      -> ${hit?.pkg ?? ""}`;
      });
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These "use client" components pull a server-only package into the browser bundle.\n` +
            `\`next build\` will fail with "Module not found". Move the shared value into a\n` +
            `plain module beside it, or import it as a TYPE if that is all you need.\n\n` +
            offenders.join("\n\n"),
    ).toEqual([]);
  });
});
