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
