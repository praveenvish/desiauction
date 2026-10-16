import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { processShellArtifact, immutableBuildAsset } from "./shell-artifact";
import { buildScoringShellPolicy, buildContentSecurityPolicy } from "../../lib/csp";
it("hashes exact generated scripts and includes lazy/CSS/font build dependencies", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ls1-shell-"));
  try {
    await mkdir(path.join(directory, "server/app/score"), { recursive: true });
    await mkdir(path.join(directory, "static/chunks"), { recursive: true });
    await mkdir(path.join(directory, "static/css"), { recursive: true });
    await mkdir(path.join(directory, "static/media"), { recursive: true });
    const inline = "window.theme='daylight';",
      external = "window.boot=true;";
    await writeFile(path.join(directory, "BUILD_ID"), "build-a");
    await writeFile(
      path.join(directory, "server/app/score/shell.html"),
      `<html><head><link rel="preload" as="script" href="/_next/static/chunks/shell.js"/><link href="/_next/static/css/shell.css"></head><body><script>${inline}</script><script src="/_next/static/chunks/shell.js" async=""></script><script type="application/json">{"inert":true}</script></body></html>`,
    );
    await writeFile(path.join(directory, "static/chunks/shell.js"), external);
    await writeFile(path.join(directory, "static/chunks/options.js"), "options");
    await writeFile(path.join(directory, "static/chunks/delivery.js"), "delivery");
    await writeFile(path.join(directory, "static/chunks/rally.js"), "rally");
    await writeFile(path.join(directory, "static/chunks/raid.js"), "raid");
    await writeFile(path.join(directory, "static/chunks/timed.js"), "timed");
    await writeFile(path.join(directory, "static/chunks/placement.js"), "placement");
    await writeFile(path.join(directory, "static/chunks/shared-queue.js"), "queue");
    await writeFile(path.join(directory, "static/media/font.woff2"), "font");
    await writeFile(
      path.join(directory, "static/css/shell.css"),
      "@font-face{src:url(../media/font.woff2)}",
    );
    await writeFile(
      path.join(directory, "react-loadable-manifest.json"),
      JSON.stringify({
        "app/score/[fixtureId]/families/pad-entries.tsx -> ../pad": {
          files: ["static/chunks/delivery.js", "static/chunks/shared-queue.js"],
        },
        "app/score/[fixtureId]/families/pad-entries.tsx -> ./placement-pad": {
          files: ["static/chunks/placement.js", "static/chunks/shared-queue.js"],
        },
        "app/score/[fixtureId]/families/pad-entries.tsx -> ./timed-pad": {
          files: ["static/chunks/timed.js", "static/chunks/shared-queue.js"],
        },
        "app/score/[fixtureId]/families/pad-entries.tsx -> ./raid-pad": {
          files: ["static/chunks/raid.js", "static/chunks/shared-queue.js"],
        },
        "app/score/[fixtureId]/families/pad-entries.tsx -> ./rally-pad": {
          files: ["static/chunks/rally.js", "static/chunks/shared-queue.js"],
        },
        "app/score/[fixtureId]/pad.tsx -> ./sheets/options-entry": {
          files: ["static/chunks/options.js"],
        },
      }),
    );
    await writeFile(
      path.join(directory, "app-build-manifest.json"),
      JSON.stringify({ pages: { "/score/shell/page": ["static/chunks/shell.js"] } }),
    );
    const artifact = await processShellArtifact(directory);
    const digest = (script: string) =>
      `sha256-${createHash("sha256").update(script).digest("base64")}`;
    expect(artifact.scriptHashes).toEqual([digest(inline), digest(external)]);
    expect(
      artifact.html.match(
        new RegExp(`integrity="${digest(external).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"),
      ),
    ).toHaveLength(2);
    expect(artifact.assets).toContain("/_next/static/chunks/options.js");
    expect(artifact.assets).toContain("/_next/static/media/font.woff2");
    expect(artifact.assets).toEqual(
      expect.arrayContaining([
        "/_next/static/chunks/delivery.js",
        "/_next/static/chunks/rally.js",
        "/_next/static/chunks/raid.js",
        "/_next/static/chunks/timed.js",
        "/_next/static/chunks/shared-queue.js",
      ]),
    );
    await rm(path.join(directory, "static/chunks/rally.js"));
    await expect(processShellArtifact(directory)).rejects.toThrow("ENOENT");
    await writeFile(path.join(directory, "static/chunks/rally.js"), "rally");
    await writeFile(path.join(directory, "static/chunks/raid.js"), "raid");
    await writeFile(path.join(directory, "static/chunks/timed.js"), "timed");
    await writeFile(path.join(directory, "static/chunks/placement.js"), "placement");
    const input = {
      nonce: "normal-nonce",
      engineWsUrl: "wss://engine.test",
      development: false,
      reportUri: "/api/csp-report",
    };
    const policy = buildScoringShellPolicy(input, artifact.scriptHashes);
    expect(policy).toContain(`'${digest(inline)}'`);
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("normal-nonce");
    expect(policy.split("; ").filter((value) => !value.startsWith("script-src"))).toEqual(
      buildContentSecurityPolicy(input)
        .split("; ")
        .filter((value) => !value.startsWith("script-src")),
    );
    await writeFile(path.join(directory, "react-loadable-manifest.json"), "{}");
    await expect(processShellArtifact(directory)).rejects.toThrow("Missing scoring options");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects non-build assets and policy expansion", () => {
  for (const asset of [
    "/account",
    "/api/score/id/events",
    "https://other.test/_next/static/x.js",
    "/_next/static/../../private",
    "/_next/static/x.js?secret=1",
  ])
    expect(immutableBuildAsset(asset)).toBe(false);
  expect(() =>
    buildScoringShellPolicy(
      { nonce: "n", engineWsUrl: "", development: false, reportUri: "/api/csp-report" },
      ["unsafe-inline"],
    ),
  ).toThrow();
});
