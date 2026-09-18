/**
 * The CI enforcement of IP-0_DESIGN §8. ESLint gives editor feedback;
 * this gate is what merges answer to.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "PX-11 architecture gate: no import cycles, including type-only ones (tsPreCompilationDeps is on). A type-only cycle is harmless at runtime but is a real coupling smell and a latent init-order trap; this caught deliveries ↔ views in the finops web layer.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
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
      name: "admin-is-read-only",
      comment:
        "PX-9: Platform Administration OBSERVES. It may not import any DOMAIN's writer, store or server actions — the modules through which every business mutation on this platform passes. Administration reads tables and certified snapshots; the day someone needs a button here, this rule fails and the conversation happens at review, not in production. (`auth/actions` is deliberately absent from this list: `currentSession` is where EVERY gate in the app — settlement's, finops' and now administration's — resolves identity, so forbidding it would forbid the gate itself. Auth's own writes are person-scoped self-service, not administration of others, and the runtime proof in admin-foundation.regression.test.ts covers what this rule cannot: it drives every admin view through a db handle that throws on insert/update/delete, so a write would fail the suite no matter which module it came through.)",
      severity: "error",
      from: { path: "^apps/web/src/(server|app)/admin" },
      to: {
        path: "^apps/web/src/server/(settlement|financial-operations|auction|competition|orgs)/(actions|writer|store|conduct-actions|live-actions|owner-actions|webhook|recovery)",
      },
    },
    {
      name: "admin-projections-hold-no-write",
      comment:
        "PX-9 + Screen 21: `access-log.ts` is the ONE module in administration that holds a write verb (see its header for the decision and its four locks). The PROJECTIONS must never acquire it: a read path that can also write is a read path nobody can reason about, and the runtime read-only proof drives exactly these modules. If a projection needs to record something, that is the review conversation, not an import.",
      severity: "error",
      from: {
        path: "^apps/web/src/server/admin/(views|format|capabilities)\\.ts$",
      },
      to: { path: "^apps/web/src/server/admin/access-log\\.ts$" },
    },
    {
      name: "admin-never-imports-finops-commands",
      comment:
        "PX-9: the finops server barrel carries the WRITER alongside the snapshots. Administration's views may consume snapshots (imported by name), but nothing under admin may reach the command surface of a domain package.",
      severity: "error",
      from: { path: "^apps/web/src/(server|app)/admin" },
      to: {
        path: "^packages/(financial-operations|settlement|auction)/src/server/(writer|commands)",
      },
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
    /*
     * GENERATED OUTPUT IS NOT ARCHITECTURE.
     *
     * Nothing excluded build directories, so every run cruised `.next`,
     * `.next-e2e` and every `dist/` alongside the source it exists to police —
     * webpack chunks, the standalone server trace, the esbuild bundles. That is
     * not merely wasted work: it is thousands of generated modules whose import
     * graph is a bundler's business and not a boundary anybody wrote, and it
     * grew the run past the default V8 heap, so `pnpm verify` aborted with
     * "Reached heap limit" on any machine that had built the app — the gate
     * failing precisely because the thing it guards had been compiled.
     *
     * `.local` is here for the same reason and is the bigger half: it is the
     * gitignored scratch directory (`apps/web/.local`), and on this machine it
     * was 996 of the 1,999 modules the cruise walked — untracked experiments
     * with their own `@ts-ignore`s, dwarfing the 532 real modules of
     * `apps/web/src`. It does not exist in CI, which is exactly why the heap
     * crash only ever happened to a developer and never to the gate.
     *
     * Measured on this tree: a heap crash before, 987 modules in seconds
     * after, with `apps/web/src` coverage unchanged at 532.
     */
    exclude: {
      path: "(^|/)(\\.next|\\.next-e2e|\\.local|dist|coverage|playwright-report|test-results)/",
    },
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
  },
};
