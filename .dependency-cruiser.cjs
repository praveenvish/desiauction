/**
 * The CI enforcement of IP-0_DESIGN §8. ESLint gives editor feedback;
 * this gate is what merges answer to.
 */
module.exports = {
  forbidden: [
    {
      name: "no-app-to-app",
      comment: "apps never import each other (§8)",
      severity: "error",
      from: { path: "^apps/web" },
      to: { path: "^apps/engine" },
    },
    {
      name: "no-app-to-app-reverse",
      severity: "error",
      from: { path: "^apps/engine" },
      to: { path: "^apps/web" },
    },
    {
      name: "no-package-to-app",
      comment: "packages never know apps exist (§7)",
      severity: "error",
      from: { path: "^packages" },
      to: { path: "^apps" },
    },
    {
      name: "no-app-to-finops-runner",
      comment: "the runner is a leaf process; no app imports it (IP-6 §4)",
      severity: "error",
      from: { path: "^apps/(web|engine)" },
      to: { path: "^apps/finops-runner" },
    },
    {
      name: "finops-runner-imports-packages-only",
      comment: "the runner holds no edge into web or engine (IP-6 §4)",
      severity: "error",
      from: { path: "^apps/finops-runner" },
      to: { path: "^apps/(web|engine)" },
    },
    {
      name: "finops-domain-is-pure",
      comment:
        "packages/financial-operations outside server/ is pure domain: no db, no auction, no apps (IP-6 §5; only src/server may touch @desiauction/db)",
      severity: "error",
      from: {
        path: "^packages/financial-operations/src",
        pathNot: "^packages/financial-operations/src/server",
      },
      to: { path: "^packages/(db|auction)|^apps" },
    },
    {
      name: "finops-never-imports-settlement-server",
      comment:
        "finops consumes frozen settlement PURE folds only; the settlement writer/store live in apps/web and stay out of reach (IP-6 §4)",
      severity: "error",
      from: { path: "^packages/financial-operations" },
      to: { path: "^apps/web/src/server/settlement" },
    },
    {
      name: "no-ui-to-core",
      severity: "error",
      from: { path: "^packages/ui" },
      to: { path: "^packages/core" },
    },
    {
      name: "no-importing-spikes",
      comment: "spikes are throwaway; nothing durable may depend on them (§6)",
      severity: "error",
      from: { path: "^(apps|packages)" },
      to: { path: "^spikes" },
    },
    {
      name: "db-is-a-leaf",
      comment: "db imports only drizzle/postgres/ulidx (IP-2_DESIGN D1)",
      severity: "error",
      from: { path: "^packages/db/src" },
      to: {
        pathNot: "^packages/db/src|node_modules/(drizzle-orm|postgres|ulidx)/",
      },
    },
    {
      name: "only-apps-touch-db",
      comment: "packages never depend on the data layer (IP-2_DESIGN D1)",
      severity: "error",
      from: { path: "^packages/(core|contracts|ui)" },
      to: { path: "^packages/db" },
    },
    {
      name: "core-is-pure",
      comment: "core runtime depends on nothing but itself (ulid whitelisted) (§8)",
      severity: "error",
      from: { path: "^packages/core/src", pathNot: "\\.test\\.ts$" },
      to: {
        pathNot: "^packages/core/src|node_modules/(ulidx|ulid)/",
      },
    },
    {
      name: "contracts-zod-only",
      severity: "error",
      from: { path: "^packages/contracts/src", pathNot: "\\.test\\.ts$" },
      to: {
        pathNot: "^packages/contracts/src|node_modules/zod/",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
  },
};
