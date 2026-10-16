import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const zip = args.includes("--zip") ? args[args.indexOf("--zip") + 1] : args[0];
const ipl = args.includes("--ipl") ? args[args.indexOf("--ipl") + 1] : undefined;
if (!zip || !ipl)
  throw new Error(
    "Usage: node scripts/cricsheet-curate.mjs --zip t20s_json.zip --ipl ipl_json.zip",
  );
const temporary = mkdtempSync(join(tmpdir(), "ls1-curate-"));
const destination = fileURLToPath(
  new URL("../packages/core/src/scoring/delivery/__fixtures__/cricsheet/", import.meta.url),
);
try {
  const matches = [];
  for (const [kind, archive] of [
    ["t20s", zip],
    ["ipl", ipl],
  ]) {
    const directory = join(temporary, kind);
    mkdirSync(directory);
    execFileSync("unzip", ["-q", resolve(archive), "-d", directory]);
    for (const filename of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
      const path = join(directory, filename);
      const json = JSON.parse(readFileSync(path, "utf8"));
      matches.push({
        kind,
        filename,
        path,
        json,
        balls: json.innings.flatMap((i) => i.overs.flatMap((o) => o.deliveries)),
      });
    }
  }
  const reportPath = join(temporary, "preflight.json");
  const configPath = join(temporary, "vitest.config.mjs");
  writeFileSync(
    configPath,
    `export default ${JSON.stringify({ test: { provide: { ls1Oracle: { files: matches.map((m) => m.path), report: reportPath, preflight: true } } } })}`,
  );
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@desiauction/core",
      "exec",
      "vitest",
      "run",
      "src/scoring/delivery/cricsheet.test.ts",
      "--config",
      configPath,
      "-t",
      "source preflight",
    ],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "pipe" },
  );
  const preflight = JSON.parse(readFileSync(reportPath, "utf8"));
  const excludedPaths = new Set(preflight.skips.map((skip) => skip.file));
  matches.sort((a, b) => a.filename.localeCompare(b.filename) || a.kind.localeCompare(b.kind));
  const wickets = (i) =>
    i.overs
      .flatMap((o) => o.deliveries)
      .flatMap((b) => b.wickets ?? [])
      .filter((w) => !["retired hurt", "retired not out"].includes(w.kind)).length;
  const legal = (i) =>
    i.overs.flatMap((o) => o.deliveries).filter((b) => !b.extras?.wides && !b.extras?.noballs)
      .length;
  const criteria = [
    ["super over", 4, (m) => m.json.innings.some((i) => i.super_over)],
    ["D/L", 4, (m) => ["D/L", "DLS"].includes(m.json.info.outcome.method)],
    ["penalty extras", 3, (m) => m.balls.some((b) => b.extras?.penalty)],
    [
      "retired hurt",
      3,
      (m) => m.balls.some((b) => b.wickets?.some((w) => w.kind === "retired hurt")),
    ],
    [
      "run out on no-ball",
      2,
      (m) => m.balls.some((b) => b.extras?.noballs && b.wickets?.some((w) => w.kind === "run out")),
    ],
    [
      "stumped on wide",
      2,
      (m) => m.balls.some((b) => b.extras?.wides && b.wickets?.some((w) => w.kind === "stumped")),
    ],
    [
      "all out within overs",
      6,
      (m) =>
        m.json.innings.some(
          (i) =>
            !i.super_over &&
            wickets(i) >= 10 &&
            legal(i) < m.json.info.overs * m.json.info.balls_per_over,
        ),
    ],
    [
      "chased with balls to spare",
      6,
      (m) =>
        m.json.info.outcome.by?.wickets &&
        m.json.innings[1] &&
        legal(m.json.innings[1]) < m.json.info.overs * m.json.info.balls_per_over,
    ],
    [
      "tie or no result without super over",
      2,
      (m) =>
        ["tie", "no result"].includes(m.json.info.outcome.result) &&
        !m.json.innings.some((i) => i.super_over),
    ],
    ["female", 6, (m) => m.json.info.gender === "female"],
    ["IPL", 10, (m) => m.kind === "ipl"],
    ["remaining T20Is", 12, (m) => m.kind === "t20s"],
  ];
  const selected = new Set();
  const manifest = [];
  mkdirSync(destination, { recursive: true });
  for (const [label, count, predicate] of criteria) {
    const candidates = matches
      .filter((m) => !selected.has(m.filename) && !excludedPaths.has(m.path) && predicate(m))
      .slice(0, count);
    if (candidates.length !== count)
      throw new Error(`Insufficient fixtures for ${label}: ${candidates.length}/${count}`);
    for (const match of candidates) {
      selected.add(match.filename);
      copyFileSync(match.path, join(destination, basename(match.filename)));
      manifest.push(`| ${label} | ${match.kind}:${match.filename} |`);
    }
  }
  for (const file of readdirSync(destination))
    if (file.endsWith(".json") && !selected.has(file)) rmSync(join(destination, file));
  writeFileSync(
    join(destination, "NOTICE.md"),
    `Ball-by-ball data from Cricsheet (cricsheet.org), licensed under the Open Data Commons Attribution License (ODC-BY 1.0). Files unmodified.\n\nLicense: https://opendatacommons.org/licenses/by/1-0/\n\nSelection: match IDs sorted lexicographically; first unused matches satisfying each criterion, in plan order.\n\n| Criterion | Source |\n|---|---|\n${manifest.join("\n")}\n\nSource-only exclusions (all remain in the full oracle denominator):\n\n${preflight.skips.map((skip) => `- ${basename(skip.file)}: ${skip.reason}; ${skip.evidence}`).join("\n")}\n`,
  );
  console.log(`Curated ${selected.size} unmodified fixtures.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
