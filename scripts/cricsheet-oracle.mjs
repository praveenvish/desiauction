import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ARCHIVES = [
  {
    key: "t20s",
    url: "https://cricsheet.org/downloads/t20s_json.zip",
    sha256: "3b35ddaaa2fd9ac914a640a8511389682f7f1ea3876b13f07f4416c7f9e987da",
    flag: "--zip",
  },
  {
    key: "ipl",
    url: "https://cricsheet.org/downloads/ipl_json.zip",
    sha256: "5757e04287179767ff8495f02902bd13812b9572ec8fa2ac1347ec2e9c6d4709",
    flag: "--ipl",
  },
];
const args = process.argv.slice(2);
const temporary = mkdtempSync(join(tmpdir(), "ls1-oracle-"));
const root = fileURLToPath(new URL("../", import.meta.url));
const reportDestination = args.includes("--report")
  ? resolve(args[args.indexOf("--report") + 1])
  : join(tmpdir(), "ls1-cricsheet-oracle-report.json");
try {
  const files = [];
  for (const archive of ARCHIVES) {
    const option = args.indexOf(archive.flag);
    let path;
    if (option !== -1) path = resolve(args[option + 1]);
    else {
      path = join(temporary, `${archive.key}.zip`);
      const response = await fetch(archive.url);
      if (!response.ok) throw new Error(`Download failed: ${archive.url}: ${response.status}`);
      writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    }
    const checksum = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (checksum !== archive.sha256)
      throw new Error(
        `Pinned SHA-256 mismatch for ${basename(path)}: expected ${archive.sha256}, received ${checksum}`,
      );
    const directory = join(temporary, archive.key);
    mkdirSync(directory);
    execFileSync("unzip", ["-q", path, "-d", directory]);
    files.push(
      ...readdirSync(directory)
        .filter((name) => name.endsWith(".json"))
        .map((name) => join(directory, name)),
    );
  }
  files.sort();
  const report = join(temporary, "report.json");
  const config = join(temporary, "vitest.config.mjs");
  writeFileSync(
    config,
    `export default ${JSON.stringify({ test: { provide: { ls1Oracle: { files, report, preflight: args.includes("--preflight") } } } })}`,
  );
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@desiauction/core",
      "exec",
      "vitest",
      "run",
      "src/scoring/delivery/cricsheet.test.ts",
      "--config",
      config,
      "-t",
      args.includes("--preflight") ? "source preflight" : "full Cricsheet oracle",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const summary = JSON.parse(readFileSync(report, "utf8"));
  writeFileSync(reportDestination, JSON.stringify(summary, null, 2));
  console.log(
    `Cricsheet oracle: ${summary.total} total; ${summary.total - summary.failures.length - summary.skips.length} passed; ${summary.failures.length} failures; ${summary.skips.length} skips (${((100 * summary.skips.length) / summary.total).toFixed(4)}%); ${summary.adjustedMatches} adjusted matches; ${summary.normalizations} inferred end adjustments.`,
  );
  console.log(`Report: ${reportDestination}`);
  for (const skip of summary.skips)
    console.log(`SKIP ${basename(skip.file)} ${skip.reason}: ${skip.evidence}`);
  for (const failure of summary.failures) console.log(`FAIL ${failure}`);
  if (result.status !== 0 || summary.failures.length || summary.skips.length / summary.total > 0.01)
    process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
