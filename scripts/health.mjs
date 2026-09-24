// Local health check (pnpm health): one PASS/FAIL row per dependency, exit 1
// on any failure. `--no-apps` limits the check to infrastructure (used by
// setup:local before the app processes exist).
import { spawnSync } from "node:child_process";

const noApps = process.argv.includes("--no-apps");
const sh = (cmd) => spawnSync(cmd, { shell: true, encoding: "utf8" }).status === 0;
const http = (url) => sh(`curl -sf --max-time 3 ${url} > /dev/null`);

const checks = [
  ["database (postgres:5433)", () => sh("docker compose exec -T db pg_isready -U desiauction")],
  ["storage  (minio:9000)", () => http("http://localhost:9000/minio/health/live")],
  ...(noApps
    ? []
    : [
        ["web      (:3000/healthz)", () => http("http://localhost:3000/healthz")],
        ["engine   (:4000/healthz)", () => http("http://localhost:4000/healthz")],
        // The runner serves nothing by design — liveness = a dev process whose
        // working directory is apps/finops-runner (its argv is identical to the
        // engine's, so the cwd is the only distinguishing fact).
        [
          "runner   (process)",
          () =>
            sh(
              "for pid in $(pgrep -f 'tsx/dist/cli.mjs watch src/index.ts'); do " +
                "(lsof -a -p $pid -d cwd -Fn 2>/dev/null | grep -q 'apps/finops-runner$' || " +
                "readlink /proc/$pid/cwd 2>/dev/null | grep -q 'apps/finops-runner$') && exit 0; " +
                "done; exit 1",
            ),
        ],
      ]),
];

let failed = 0;
console.log("");
for (const [name, probe] of checks) {
  const ok = probe();
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}
// Redis: the platform is deliberately Redis-free (no code path uses it); the
// row exists so nobody hunts for a missing service.
console.log("  N/A   redis (platform has no Redis dependency by design)");
console.log(failed === 0 ? "\nHEALTH: PASS" : `\nHEALTH: FAIL (${failed})`);
if (!noApps && failed > 0) console.log("  → apps not running? start them with: pnpm dev");
process.exit(failed === 0 ? 0 : 1);
