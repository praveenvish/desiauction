import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE PIN IS PER MATCH, NOT PER ZIP. Cricsheet republishes these URLs every
 * day with the newest matches added, so a checksum of the whole archive broke
 * the nightly the first day after it was taken. `cricsheet-oracle.pins.json`
 * holds a checksum for each match file the oracle was certified on; matches
 * Cricsheet adds later are ignored, and a pinned match it corrects or removes
 * is reported as upstream drift and counted against the same 1% ceiling as an
 * exclusion. Regenerate the pins from archives that pass:
 *
 *   node scripts/cricsheet-oracle.mjs --zip t20s_json.zip --ipl ipl_json.zip --write-pins
 */
const ARCHIVES = [
  { key: "t20s", url: "https://cricsheet.org/downloads/t20s_json.zip", flag: "--zip" },
  { key: "ipl", url: "https://cricsheet.org/downloads/ipl_json.zip", flag: "--ipl" },
];
const CEILING = 0.01;
const args = process.argv.slice(2);
const temporary = mkdtempSync(join(tmpdir(), "ls1-oracle-"));
const root = fileURLToPath(new URL("../", import.meta.url));
const pinsPath = fileURLToPath(new URL("./cricsheet-oracle.pins.json", import.meta.url));
const writePins = args.includes("--write-pins");
const reportDestination = args.includes("--report")
  ? resolve(args[args.indexOf("--report") + 1])
  : join(tmpdir(), "ls1-cricsheet-oracle-report.json");
/** 64 bits of SHA-256: integrity against change, not a defence against forgery. */
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);

try {
  const pins = writePins ? null : JSON.parse(readFileSync(pinsPath, "utf8"));
  const written = { downloaded: new Date().toISOString().slice(0, 10), archives: {} };
  const files = [];
  const drift = [];
  let ignored = 0;
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
    const directory = join(temporary, archive.key);
    mkdirSync(directory);
    execFileSync("unzip", ["-q", path, "-d", directory]);
    const present = readdirSync(directory).filter((name) => name.endsWith(".json"));
    if (writePins) {
      written.archives[archive.key] = Object.fromEntries(
        present.sort().map((name) => [name, digest(join(directory, name))]),
      );
      files.push(...present.map((name) => join(directory, name)));
      continue;
    }
    const pinned = pins.archives[archive.key] ?? {};
    const available = new Set(present);
    ignored += present.filter((name) => !(name in pinned)).length;
    for (const [name, sum] of Object.entries(pinned)) {
      if (!available.has(name)) drift.push(`${archive.key}/${name} removed upstream`);
      else if (digest(join(directory, name)) !== sum)
        drift.push(`${archive.key}/${name} changed upstream`);
      else files.push(join(directory, name));
    }
  }
  if (!writePins && files.length === 0) throw new Error(`No pinned matches found (${pinsPath})`);
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
  const total = summary.total + drift.length;
  const excluded = summary.skips.length + drift.length;
  writeFileSync(reportDestination, JSON.stringify({ ...summary, drift }, null, 2));
  console.log(
    `Cricsheet oracle: ${total} pinned; ${summary.total - summary.failures.length - summary.skips.length} passed; ${summary.failures.length} failures; ${summary.skips.length} skips + ${drift.length} upstream drift (${((100 * excluded) / total).toFixed(4)}%); ${ignored} newer matches ignored; ${summary.adjustedMatches} adjusted matches; ${summary.normalizations} inferred end adjustments.`,
  );
  console.log(`Report: ${reportDestination}`);
  for (const skip of summary.skips)
    console.log(`SKIP ${basename(skip.file)} ${skip.reason}: ${skip.evidence}`);
  for (const entry of drift) console.log(`DRIFT ${entry}`);
  for (const failure of summary.failures) console.log(`FAIL ${failure}`);
  const passed = result.status === 0 && !summary.failures.length && excluded / total <= CEILING;
  if (!passed) process.exitCode = 1;
  else if (writePins) {
    writeFileSync(pinsPath, `${JSON.stringify(written, null, 2)}\n`);
    console.log(`Pinned ${summary.total} matches in ${pinsPath}`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
