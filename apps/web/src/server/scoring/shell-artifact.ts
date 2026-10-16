import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../env";

export interface ShellArtifact {
  html: string;
  scriptHashes: string[];
  assets: string[];
  buildId: string;
}
const hash = (content: string | Buffer) =>
  `sha256-${createHash("sha256").update(content).digest("base64")}`;
export function immutableBuildAsset(url: string): boolean {
  return /^\/_next\/static\/[A-Za-z0-9_./-]+$/.test(url) && !url.split("/").includes("..");
}
/** Generated build paths only: never derive a filesystem path from a request. */
export async function processShellArtifact(buildDir: string): Promise<ShellArtifact> {
  const buildId = (await readFile(path.join(buildDir, "BUILD_ID"), "utf8")).trim();
  if (!buildId) throw new Error("Missing scoring shell build ID");
  let html = await readFile(path.join(buildDir, "server/app/score/shell.html"), "utf8");
  const loadable = JSON.parse(
    await readFile(path.join(buildDir, "react-loadable-manifest.json"), "utf8"),
  ) as Record<string, { files: string[] }>;
  const appManifest = JSON.parse(
    await readFile(path.join(buildDir, "app-build-manifest.json"), "utf8"),
  ) as { pages: Record<string, string[]> };
  const lazy = Object.entries(loadable).filter(
    ([key]) =>
      key.includes("app/score/") &&
      ["options-entry", "pad-entries"].some((entry) => key.includes(entry)),
  );
  if (!lazy.some(([key]) => key.includes("options-entry")))
    throw new Error("Missing scoring options build entry");
  for (const entry of ["../pad", "./rally-pad", "./raid-pad", "./timed-pad", "./placement-pad"]) {
    if (!lazy.some(([key]) => key.includes("pad-entries") && key.endsWith(` -> ${entry}`)))
      throw new Error(`Missing scoring family build entry: ${entry}`);
  }
  const assets = new Set<string>();
  function add(url: string) {
    if (!immutableBuildAsset(url)) throw new Error("Invalid scoring shell build asset");
    assets.add(url);
  }
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+)"/g))
    add(match[1] ?? "");
  for (const [key, files] of Object.entries(appManifest.pages))
    if (key.includes("/score/shell/")) for (const file of files) add(`/_next/${file}`);
  for (const [, entry] of lazy) for (const file of entry.files) add(`/_next/${file}`);
  const hashes: string[] = [];
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  for (const script of scripts) {
    const attributes = script[1] ?? "",
      body = script[2] ?? "";
    const type = /\btype="([^"]+)"/.exec(attributes)?.[1];
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
    const src = /\bsrc="([^"]+)"/.exec(attributes)?.[1];
    if (src) {
      add(src);
      const digest = hash(await readFile(path.join(buildDir, src.slice("/_next/".length))));
      hashes.push(digest);
      html = html.replace(
        script[0],
        `<script${attributes.replace(/\s+integrity="[^"]*"/g, "")} integrity="${digest}">${body}</script>`,
      );
    } else hashes.push(hash(body));
  }
  for (const link of [...html.matchAll(/<link\b([^>]*)>/g)]) {
    const attributes = link[1] ?? "";
    if (!/\bas="script"/.test(attributes) || !/\brel="preload"/.test(attributes)) continue;
    const href = /\bhref="([^"]+)"/.exec(attributes)?.[1];
    if (!href) throw new Error("Missing scoring shell script preload path");
    add(href);
    const digest = hash(await readFile(path.join(buildDir, href.slice("/_next/".length))));
    if (!hashes.includes(digest)) throw new Error("Scoring shell preload has no authorised script");
    html = html.replace(
      link[0],
      `<link${attributes.replace(/\s+integrity="[^"]*"/g, "").replace(/\/$/, "")} integrity="${digest}"/>`,
    );
  }
  // CSS font/image references belong to this immutable build, not media storage.
  for (const asset of assets) {
    const content = await readFile(path.join(buildDir, asset.slice("/_next/".length)));
    if (asset.endsWith(".css"))
      for (const match of content.toString().matchAll(/url\((?:["']?)([^)'"\s]+)(?:["']?)\)/g)) {
        const relative = match[1] ?? "";
        if (relative.startsWith("data:")) continue;
        const url = new URL(relative, `https://shell.invalid${asset}`);
        if (url.origin !== "https://shell.invalid")
          throw new Error("External scoring shell stylesheet asset");
        add(url.pathname);
      }
  }
  html = html.replace(
    "</head>",
    `<meta name="ls1-build-assets" content="${encodeURIComponent(JSON.stringify([...assets]))}"></head>`,
  );
  return { html, scriptHashes: [...new Set(hashes)], assets: [...assets], buildId };
}
let cached: { buildId: string; artifact: Promise<ShellArtifact> } | undefined;
export async function scoringShellArtifact(): Promise<ShellArtifact> {
  const buildDir = path.resolve(process.cwd(), env.NEXT_DIST_DIR ?? ".next");
  const buildId = (await readFile(path.join(buildDir, "BUILD_ID"), "utf8")).trim();
  if (!cached || cached.buildId !== buildId)
    cached = { buildId, artifact: processShellArtifact(buildDir) };
  return cached.artifact;
}
