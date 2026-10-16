import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const require = createRequire(path.join(root, "apps/web/package.json"));
const ts = require("typescript");
const app = "apps/web/src/app";
const output = "docs/product/UI-REFINEMENT/BASELINE.json";
const sealFile = "docs/product/UI-REFINEMENT/BASELINE.sha256";
const baselineHead = "55c97aef78873172793d8a22a6e69d00af93314d";
if (execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== baselineHead) {
  throw new Error(
    "Baseline HEAD changed; preserve BASELINE.json and create a separately identified candidate audit.",
  );
}
if (
  execFileSync("git", ["diff", baselineHead, "--", "apps/web/src", "packages/ui"], {
    encoding: "utf8",
  }).trim()
) {
  throw new Error(
    "Application sources changed; frozen baseline cannot be overwritten by a candidate.",
  );
}
const untracked = execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "--", "apps/web/src", "packages/ui"],
  { encoding: "utf8" },
).trim();
if (untracked)
  throw new Error(
    "Untracked application source changes; create a candidate instead of overwriting baseline.",
  );
const cache = new Map();
const controls = new Set([
  "button",
  "Button",
  "ButtonLink",
  "Link",
  "a",
  "input",
  "select",
  "textarea",
  "Field",
  "Select",
  "Dialog",
  "FormDialog",
  "Drawer",
  "Tabs",
  "SegmentedTabs",
]);

async function filesBelow(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const rows = await Promise.all(
    entries.map(async (entry) => {
      const file = path.posix.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(file) : [file];
    }),
  );
  return rows.flat().sort();
}

async function resolveLocal(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(root, path.dirname(from), specifier);
  for (const suffix of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const candidate = base + suffix;
    try {
      if ((await stat(candidate)).isFile()) return path.relative(root, candidate);
    } catch {
      /* A missing import candidate is expected during resolution. */
    }
  }
  return null;
}

async function inspect(file) {
  if (cache.has(file)) return cache.get(file);
  const text = await readFile(path.join(root, file), "utf8");
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const row = {
    file,
    sha256: createHash("sha256").update(text).digest("hex"),
    client: text.startsWith('"use client"') || text.startsWith("'use client'"),
    imports: [],
    controls: [],
    forms: [],
    exports: [],
    guardCalls: [],
  };
  cache.set(file, row);
  function lineOf(node) {
    return tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      row.imports.push({
        kind: "static",
        module: node.moduleSpecifier.text,
        clause: node.importClause?.getText(tree) ?? "",
        line: lineOf(node),
      });
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      row.imports.push({ kind: "reexport", module: node.moduleSpecifier.text, line: lineOf(node) });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      row.imports.push({
        kind: "dynamic",
        module: argument && ts.isStringLiteralLike(argument) ? argument.text : null,
        expression: argument?.getText(tree),
        line: lineOf(node),
      });
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(tree);
      const item = { name, line: lineOf(node), attributes: node.attributes.getText(tree) };
      if (controls.has(name)) row.controls.push(item);
      if (name === "form") row.forms.push(item);
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(tree);
      if (/notFound|redirect|Gate|Capability|Session|hasGrant|require.*|publicPage/.test(name)) {
        row.guardCalls.push({
          call: name,
          line: lineOf(node),
          arguments: node.arguments.map((arg) => arg.getText(tree)),
        });
      }
    }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of node.declarationList.declarations) {
        const name = declaration.name.getText(tree);
        if (["metadata", "dynamic", "revalidate"].includes(name))
          row.exports.push({
            name,
            value: declaration.initializer?.getText(tree),
            line: lineOf(declaration),
          });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return row;
}

async function closure(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  visited.add(entry);
  const source = await inspect(entry);
  for (const imported of source.imports) {
    const target = imported.module ? await resolveLocal(entry, imported.module) : null;
    imported.resolved = target;
    if (target && /\.tsx?$/.test(target) && target.startsWith("apps/web/src/"))
      await closure(target, visited);
  }
  return visited;
}

const pages = (await filesBelow(app)).filter((file) => file.endsWith("/page.tsx"));
const appFiles = new Set(await filesBelow(app));
const routes = [];
for (const file of pages) {
  const roots = [file];
  let directory = path.posix.dirname(file);
  while (directory.startsWith(app)) {
    for (const name of [
      "layout.tsx",
      "loading.tsx",
      "error.tsx",
      "not-found.tsx",
      "global-error.tsx",
    ]) {
      const boundary = path.posix.join(directory, name);
      if (appFiles.has(boundary)) roots.push(boundary);
    }
    if (directory === app) break;
    directory = path.posix.dirname(directory);
  }
  const visited = new Set();
  for (const entry of roots) await closure(entry, visited);
  const dependencies = [...visited].sort();
  const source = await inspect(file);
  const relative = file.slice(app.length + 1).replace(/(?:^|\/)page\.tsx$/, "");
  routes.push({
    entry: file,
    path:
      "/" +
      relative
        .split("/")
        .filter((part) => !/^\(.*\)$/.test(part))
        .join("/"),
    kind: relative.includes("@action/") ? "parallel-action-slot" : "page-template",
    sha256: source.sha256,
    directImports: source.imports,
    directMetadata: source.exports,
    directGuards: source.guardCalls,
    sourceRoots: roots,
    componentFiles: dependencies,
    unresolvedEdges: dependencies.flatMap((dependency) =>
      cache
        .get(dependency)
        .imports.filter((item) => !item.resolved)
        .map((item) => ({ file: dependency, ...item })),
    ),
    controlReferences: dependencies.flatMap((dependency) =>
      cache.get(dependency).controls.map((item) => ({ file: dependency, ...item })),
    ),
    formReferences: dependencies.flatMap((dependency) =>
      cache.get(dependency).forms.map((item) => ({ file: dependency, ...item })),
    ),
    evidence:
      "Static import/dynamic-import/reexport and ancestor shell/boundary closure. External packages, custom/data-driven controls, inherited publication and runtime states require scoped manual verification; this is not runtime approval.",
  });
}
if (pages.length !== 141)
  throw new Error(
    `Expected 141 reviewed page entries, found ${pages.length}; reconcile the inventory.`,
  );
const build = JSON.parse(
  await readFile(path.join(root, "apps/web/.next-e2e/app-path-routes-manifest.json"), "utf8"),
);
const baseline = {
  baselineHead,
  buildId: (await readFile(path.join(root, "apps/web/.next-e2e/BUILD_ID"), "utf8")).trim(),
  scope:
    "All page entries, ancestor layouts/boundaries, local TS/TSX static/dynamic/reexport edges; no application execution, database or mutations.",
  pageEntries: pages.length,
  sourceFiles: cache.size,
  styleFiles: await Promise.all(
    (await Promise.all([filesBelow("apps/web/src"), filesBelow("packages/ui/src")]))
      .flat()
      .filter((file) => file.endsWith(".css"))
      .map(async (file) => ({
        file,
        sha256: createHash("sha256")
          .update(await readFile(path.join(root, file)))
          .digest("hex"),
      })),
  ),
  compiledRouteMap: build,
  routes,
};
const serialized = JSON.stringify(baseline, null, 2) + "\n";
const digest = createHash("sha256").update(serialized).digest("hex");
let seal;
try {
  seal = (await readFile(path.join(root, sealFile), "utf8")).trim();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (seal && seal !== digest)
  throw new Error(
    "Frozen baseline differs; write a separate candidate, never refresh baseline evidence.",
  );
await writeFile(path.join(root, output), serialized);
if (!seal) await writeFile(path.join(root, sealFile), digest + "\n");
process.stdout.write(
  `Baseline: ${pages.length} page entries, ${cache.size} TS/TSX sources, ${routes.reduce((sum, row) => sum + row.controlReferences.length, 0)} control references. Saved ${output}.\n`,
);
