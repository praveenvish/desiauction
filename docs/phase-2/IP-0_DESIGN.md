# IP-0 — ENGINEERING FOUNDATION · DETAILED DESIGN
## DesiAuction NEXT · v1.0 · 2026-07-12 · CTO · Status: AWAITING FOUNDER APPROVAL

> Governed by Blueprint v1.1 (FROZEN) §IP-0, Canon C-12/C-13/C-17, conditions RC-2/RC-5/RC-6. This is the only detailed engineering design in existence; everything IP-1+ is named and deferred (§4). Code begins on founder approval (§37) — not before.

---

## 1 · Executive summary

IP-0 builds the platform the next five years stand on: a pnpm+Turborepo monorepo with lint-enforced package boundaries, a CI pipeline where every quality gate is automated, three real environments (local / staging / prod-provisioned), migration discipline proven end-to-end, structured logging + error tracking wired from the first commit — and the **tracer bullet**: a throwaway vertical spike that measures whether Neon+Fly can host the auction engine (VA-5: append→ack p99 ≤ 20ms, 10k-event replay < 10s) and whether one process can fan out to a venue's worth of viewers (RC-5: 200 WS subscribers, p95 < 500ms). If the substrate fails, the decision reopens here for the price of a spike, not in IP-4 for the price of the engine.

Bias throughout: **boring, pinned, right-sized for founder+AI.** Rejected during internal review (§34.1): Nx/Bazel, Kubernetes, microservices, GraphQL, secrets-manager SaaS, feature-flag SaaS, self-hosted observability, local git hooks.

## 2 · Scope

Monorepo scaffold; toolchain pinning; CI/CD; environments + secrets; Drizzle migration discipline (proven with the spike table only); logging/error/observability foundation; typed config; security baseline; object-storage provisioning (RC-2); developer onboarding; the tracer bullet + report.

## 3 · Goals

G1 `git clone` → running local stack in < 30 min. G2 every Blueprint §4 automated gate runs on every PR. G3 deploy of a hello-engine to Fly Mumbai and hello-web to Vercel, repeatable from CI. G4 tracer-bullet numbers committed (pass or fail — the number is the deliverable). G5 zero decisions left for "later" that IP-1/IP-2 would trip over (their *external* dependencies are provisioned here).

## 4 · Non-goals (explicit deferrals)

No auction engine (IP-4) · no schema beyond the spike table (IP-3+) · no auth flows (IP-2; OTP **provider account** procured now per RC-1) · no UI components or tokens (IP-1; `packages/ui` is an empty shell) · no player-identity implementation (IP-1/IP-3; **storage bucket** provisioned now per RC-2) · no business APIs, money, messaging, notifications (IP-6) · no RLS policies (IP-2) · no CDN (decided at IP-3 when photos ship).

## 5 · Repository strategy

**This repo (`desiauction-next`), single monorepo, forever.** `docs/` (frozen governance) and `prototypes/` (frozen `va1-rc1` reference) remain untouched; new top level: `apps/`, `packages/`, `spikes/`, `.github/`. One repo = one CI, one lockfile, atomic cross-package changes — the correct trade for a 2-app system owned by one team.

## 6 · Workspace structure

```
apps/
  web/        Next.js (App Router) — Console, Stage, Owner Room, registration (C-12)
  engine/     Fastify + ws Node service — auction runtime + realtime (C-12)
packages/
  core/       pure domain: reducers, invariants, money math — ZERO runtime deps except ulid
  contracts/  Zod schemas + inferred types for every API/event/config shape
  ui/         FLOODLIGHT components — EMPTY SHELL until IP-1
  config/     shared tsconfig bases, eslint config, prettier config
spikes/
  tracer-bullet/   throwaway (§32); excluded from turbo graph; DELETED at IP-0 exit
```

## 7 · Package boundaries

`core` = the crown jewels: pure functions, no IO, no framework, no env access; its tests need no infrastructure. `contracts` = the only place types cross a wire; Zod is the single schema source, TS types inferred, never hand-duplicated. `ui` = React + tokens only (IP-1 fills it). Apps compose packages; packages never know apps exist.

## 8 · Dependency rules (machine-enforced, not documented-and-hoped)

Allowed edges only: `web → core|contracts|ui|config` · `engine → core|contracts|config` · `ui → config` · `contracts → (zod only)` · `core → (ulid only)`. Forbidden: app→app, package→app, `ui→core`, anything→`spikes`. **Enforced by dependency-cruiser in CI (gate) + ESLint `no-restricted-imports` (editor feedback).** `core` additionally bans `process`, `fetch`, `Date.now` (clock is injected — determinism is C-9's oxygen; lint rule from day one so IP-4 inherits it).

## 9 · Technology stack (pinned at scaffold; upgrades only via dedicated PRs)

| Layer | Choice | Why (one line) |
|---|---|---|
| Runtime | **Node 24 LTS** (pinned `.node-version` + engines) | Active LTS through 2028 — the 5-year answer |
| Package manager | **pnpm 10** via corepack (`packageManager` field) | Deterministic, workspace-native |
| Orchestration | **Turborepo** + Vercel remote cache | Task graph + caching without Nx ceremony |
| Language | **TypeScript 5.x `strict`**, `noUncheckedIndexedAccess` | Non-negotiable |
| Web | **Next.js (current stable), App Router, RSC-first** on Vercel (region `bom1`) | C-12; Vercel = zero ops for the stateless app |
| Engine | **Fastify + `ws`** on Fly.io (region `bom`), Docker image, 1 machine per env | Boring, fast, single-writer-friendly (C-9/C-16) |
| Database | **Neon Postgres 17**, branch-per-environment | Serverless PG, Mumbai target — **verified by the tracer, §32; if Mumbai unavailable or latency fails, substrate decision reopens HERE** |
| ORM/migrations | **Drizzle + drizzle-kit**, SQL files committed | C-13; migrations are code-reviewed SQL, not magic |
| IDs | **ULID** (`ulidx`), `char(26)` columns | C-13 |
| Validation | **Zod v4** at every boundary | One schema language everywhere |
| Unit/integration tests | **Vitest** (workspace projects) | One runner both apps + packages |
| E2E | **Playwright** (installed now, one smoke test) | Harness exists before GJ journeys need it |
| Lint/format | **ESLint 9 flat + Prettier** (config in `packages/config`) | Zero-error policy |
| Logging | **pino** (JSON prod, pretty dev) | §27 |
| Errors/APM | **Sentry** both apps (+ tracing, low sample) | C-17 right-sized; OTel-compatible exit path noted |
| Object storage | **AWS S3, region `ap-south-1` (Mumbai)** + scoped IAM | RC-2: *explicit* India residency for DPDP/R-9 — R2/others don't guarantee it |
| CI/CD | **GitHub Actions** | §20 |

## 10 · Local development environment

`docker compose up -d` → Postgres 17 (matching Neon major) on 5433 + MinIO (S3-compatible, mirrors the RC-2 bucket locally). `pnpm dev` → turbo runs `web` (:3000) + `engine` (:4000) with watch. `.env.example` lists every variable with a comment; `pnpm env:check` validates (fail-closed, §11). No cloud account needed for local work — that's a hard requirement, not a nicety.

## 11 · Configuration strategy

One `env.ts` per app: a **Zod-validated, frozen, typed config object parsed once at boot; the process refuses to start on any missing/invalid var.** Direct `process.env` access outside `env.ts` is a lint error. Config is data, not behaviour: no `if (env.X)` business logic outside the config module's derived flags.

## 12 · Secrets strategy

No secrets SaaS (rejected §34.1). Truth per environment: **local** = `.env.local` (git-ignored); **CI** = GitHub Actions secrets (least-privilege: `FLY_API_TOKEN` app-scoped, Vercel via Git integration needing no token, `DATABASE_URL` staging-branch only); **staging/prod** = Fly secrets + Vercel env vars, set by founder or CI, never committed. Controls: **gitleaks in CI on every PR** + `.env*` git-ignored + `.env.example` never contains a real value + quarterly rotation note in the runbook. Any leaked secret: rotate first, investigate second.

## 13 · Environment management

| Env | Web | Engine | DB | Storage | Purpose |
|---|---|---|---|---|---|
| local | :3000 | :4000 | docker PG | MinIO | development |
| preview | Vercel preview per PR | — (uses staging engine) | Neon `dev` branch | staging bucket | PR review |
| staging | Vercel `main` → staging domain | Fly `desiauction-engine-staging` | Neon `staging` branch | `desiauction-media-staging` | the always-truthful integration env |
| prod | provisioned, no domain until IP-8 | Fly `desiauction-engine-prod` (created, scaled to 0) | Neon `prod` branch (empty) | `desiauction-media-prod` | exists from day 0 so IP-8 rehearses deploys, not creation |

## 14 · Coding standards

TS strict; **no `any`** (lint error, no suppressions without a linked issue); no default exports except where Next.js requires; discriminated unions over enums with behaviour; money is **integer paise in a branded type** (`Paise`) defined in `core` from day one (C-7 — the branding makes unit bugs type errors); public functions of `core`/`contracts` carry JSDoc stating the invariant they uphold, nothing else (comments state constraints, not narration).

## 15 · Repository conventions

kebab-case filenames; `src/` in every workspace; tests co-located `*.test.ts`; barrels (`index.ts`) only at package roots; one concept per file; `scripts/` for repo tooling (TS, run via `tsx`); every workspace has a 10-line README stating its boundary.

## 16–17 · Git workflow & branch strategy

Trunk-based (Blueprint §3, restated operationally): `main` protected — required checks = full CI, linear history, **squash merge only** (PR title becomes the conventional commit). Branches `ip0/<slug>`, deleted on merge, target lifetime < 2 days. No release branches — releases are tags (`ip<N>-frozen`, later `v*`). No local git hooks (rejected §34.1): CI is the enforcer; `pnpm verify` (lint+typecheck+test+format-check) exists for developers who want pre-push confidence.

## 18 · Pull request standards

Template enforces: **what/why (≤5 lines) · governing citations (Canon/doc/RC/invariant IDs) when touching governed behaviour · test evidence · rollback note for anything touching deploy/migrations.** Conventional-commit title (commitlint in CI). Small PRs; a PR that can't be described in five lines is two PRs.

## 19 · Code review checklist (lives in the PR template)

boundary rules respected (dep-cruiser green) · no new `any`/suppression · errors handled per §28 (no silent catch) · logs structured, no PII (§27) · config via `env.ts` only · migration reversible-in-dev / expand-contract note · tests actually assert behaviour (not snapshots-of-everything) · docs touched if behaviour moved. Founder reviews gate PRs and anything touching deploy, money, auth; routine PRs self-reviewed against this list, honestly (R-11 mitigations apply).

## 20 · CI/CD architecture

GitHub Actions, three workflows:
- **`ci.yml`** (every PR + main): pnpm frozen-lockfile install → turbo affected: `lint`, `typecheck`, `test:unit`, `build` → `test:integration` against a PG 17 service container (migrations applied first — every CI run proves migration-up) → dependency-cruiser → gitleaks → commitlint → `pnpm audit --prod` (fail on high/critical).
- **`deploy-engine.yml`** (push to main): build Docker → `flyctl deploy` staging → post-deploy smoke (`/healthz` 200 + WS echo). Prod deploy = manual `workflow_dispatch` only (and blocked by C-22 live-window check from IP-7 onward).
- **web**: Vercel Git integration (preview per PR, `main` → staging). No custom workflow needed — less to own.
Turbo remote caching keeps the whole PR pipeline target **< 8 minutes**.

## 21 · Build pipeline

`turbo build`: `contracts` → `core` → `ui` → apps (graph-ordered, cached). Engine ships as a distroless-based Docker image built in CI (deterministic, no builds on Fly). Next build on Vercel. All builds reproducible from lockfile — a cache-cold CI build is the canonical artifact.

## 22 · Test infrastructure

Vitest workspace: **unit** (packages + app logic; no IO; `core` tests import nothing but `core`) and **integration** (engine+web against real PG — docker locally, service container in CI; each file owns a schema-isolated database created/dropped per run). **E2E**: Playwright with exactly one smoke test in IP-0 (web renders health page) — the harness, not the journeys. Simulation harness is IP-4's; the runner conventions it will use are established here.

## 23–25 · Linting, formatting, type safety

ESLint 9 flat config in `packages/config`: zero errors merged, warnings are errors in CI; rule sets: typescript-eslint strict-type-checked, import ordering, boundary rules (§8), `no-console` outside logger, `process.env` ban outside `env.ts`. Prettier owns formatting entirely (no ESLint formatting rules); `--check` in CI. `tsc --noEmit` per workspace in CI; shared `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.

## 26 · Quality gates

Blueprint §4 mapping for IP-0: gates 1–4 = `ci.yml` (§20); gate 5 (a11y) = axe harness installed, exercised from IP-1; gate 6 (performance) = **the tracer report**; gate 7 (visual) = n/a this phase; gates 8–10 = founder demo of G1–G5, this doc reconciled, boundary audit. Recorded in `docs/phase-2/GATES.md` at phase close.

## 27 · Logging strategy

pino, JSON in deployed envs, pretty locally. Base bindings: `app`, `env`, `version` (git SHA), `req_id` (Fastify request id; Next middleware generates and forwards). Domain fields when present: `org_id`, `auction_id`, `seq`. **PII policy (DPDP): no phone numbers, names, or tokens in logs — pino `redact` paths configured now, list grows with IP-2.** Levels: `info` = state changes, `warn` = handled abnormality, `error` = Sentry-worthy. No `console.*` (lint).

## 28 · Error handling

Two worlds, one rule each. **`core` (domain):** expected outcomes are values — discriminated-union results (`{ ok } | { err }` with typed reasons), throwing reserved for programmer error; no Result library (rejected §34.1 — plain unions, zero deps). **Apps (infrastructure):** throw; translate at the boundary (Fastify error handler / Next error boundary) into typed contract errors; every unexpected error → Sentry with `req_id`. Absolute rules: no empty catch; no catch-and-continue without a `warn` log; `cause` chained on rethrow; engine process handlers for `unhandledRejection`/`uncaughtException` → log fatal, Sentry flush, exit 1 (Fly restarts — a dead process is safer than a lying one, per C-9 single-writer semantics).

## 29 · Observability foundation

Sentry in both apps (errors + tracing, 10% sample staging, tuned later) with release = git SHA, environment tag. `/healthz` on both apps: `{ status, version, checks: { db, storage } }`, fail-closed. Fly machine metrics + Vercel analytics as-is. **OTel decision: not installed in IP-0** — Sentry covers error+trace needs at this scale; the pino/Sentry seams are OTel-compatible, and C-17's full OTel lands with the engine SLOs in IP-4 where the spans actually matter. (Deliberate deferral, recorded.)

## 30 · Feature flag foundation

Pattern only, no service (Blueprint §3): flags are **typed, documented fields in `env.ts` derived config**, defaulting safe. Two names reserved for later phases: `REALTIME_FANOUT_DISABLED`, `MESSAGING_DISABLED`. Any proposed third kill-switch requires a founder decision — scarcity is the discipline.

## 31 · Security foundation

(Auth itself is IP-2.) 2FA mandatory on GitHub/Vercel/Fly/Neon/AWS/Sentry; least-privilege tokens (§12); branch protection; gitleaks + `pnpm audit` + Dependabot (security-only autoupdates); engine Docker: non-root user, distroless base, read-only fs; web security headers from day one (HSTS, X-Frame-Options DENY, nosniff; CSP arrives with real pages in IP-1/IP-3); TLS everywhere by platform; S3 bucket private-only, presigned access pattern decided at IP-3.

## 32 · Infrastructure requirements & the tracer bullet

**Accounts (founder, day-0 list):** GitHub repo (exists) · Vercel · Fly.io · Neon · Sentry · AWS (S3 `ap-south-1` + IAM) — plus non-IP-0 procurements riding the same window: SMS/OTP provider (RC-1), WhatsApp BSP (VA-9), Razorpay KYC.

**Tracer bullet (`spikes/tracer-bullet/`, ≤500 lines, throwaway):**
- *Shape:* one Drizzle table `spike_ledger(id char(26), auction_id, seq bigint, type text, payload jsonb, created_at)` with `unique(auction_id, seq)`; toy reducer in the spike (not in `core` — throwaway stays throwaway); Fastify `POST /cmd` → in-process per-auction mutex → read last seq → insert seq+1 → reduce → broadcast over `ws` → ack; `GET /replay` rebuilds state from the full ledger.
- *Measurements (pre-registered — VA-5 + RC-5):* **M1** append→ack p99 ≤ 20 ms engine-internal over 10,000 sequential commands (Fly `bom` ↔ Neon). **M2** replay of 10,000 events < 10 s. **M3 (RC-5)** 200 concurrent WS subscribers all receive a published event, delivery p95 < 500 ms, on one shared-cpu Fly machine. **M4 (observational)** client→ack RTT from a Mumbai-region client, reported not gated.
- *Load driver:* a Node script in the spike (opens N ws clients, timestamps, prints percentiles) — no k6/artillery dependency for a throwaway.
- *Honesty rules:* numbers reported as measured, pass or fail; **if Neon Mumbai is unavailable at signup or M1/M2/M3 fail, IP-0 does not silently continue — the substrate decision reopens with the numbers on the table** (that is this phase's purpose). Report → `docs/phase-2/IP-0_TRACER_REPORT.md`; spike deleted at exit; report survives.

## 33 · Developer onboarding

`README.md` at repo root: prerequisites (git, docker, corepack) → `pnpm i` → `docker compose up -d` → `cp .env.example .env.local` → `pnpm env:check` → `pnpm dev` → both apps up → `pnpm verify` green. **Target < 30 min on a clean machine; measured once during IP-0 as an acceptance item.** Architecture orientation = this doc + Blueprint; no separate wiki (docs rot in proportion to their count).

## 34 · Risks

| Risk | Sev | Handling |
|---|---|---|
| Neon has no Mumbai region / latency fails M1 | High | The tracer exists for this; fallback candidates priced in the report (Neon Singapore measured for real, RDS/Supabase Mumbai as alternates) — decision with numbers, not vibes |
| Fly single shared-cpu machine fails M3 fan-out | Med | Report includes one scaled retry (performance-cpu); if still failing, fan-out tier (separate ws relay) becomes an IP-4 design input — known before engine code exists |
| CI creep (pipeline > 8 min) | Med | Turbo cache + affected-only; pipeline time is a tracked number in GATES.md |
| Toolchain churn (Next/ESLint majors mid-phase) | Low | Everything pinned; upgrades are dedicated PRs, never drive-by |
| Solo-founder account creation stalls the spike (R-3) | Med | §32 account list is the founder's only IP-0 work; everything else proceeds locally without cloud |

### 34.1 · Internal CTO review — challenged and rejected
**Nx/Bazel** (power we won't use; turbo+pnpm is enough for 5 workspaces) · **Kubernetes/self-managed infra** (two managed platforms beat one cluster and a pager) · **microservices** (two apps is the architecture, not a starting point) · **GraphQL** (contracts+RPC is C-14's answer; no second API paradigm) · **secrets-manager SaaS** (three platform secret stores + gitleaks; one fewer vendor) · **feature-flag SaaS** (env-config pattern; scarcity by design) · **OTel now** (§29 — Sentry covers it until IP-4 makes spans meaningful) · **local git hooks** (CI enforces; onboarding stays frictionless) · **neverthrow/fp-ts** (plain discriminated unions; no dependency owns our control flow). Each of these I would still defend in three years, which was the bar.

## 35 · Definition of Ready
Blueprint v1.1 frozen ✅ · this design founder-approved ☐ · GitHub repo access ✅ · §32 accounts created or scheduled within week 1 ☐.

## 36 · Definition of Done (IP-0)
Monorepo scaffold complete with §8 boundaries machine-enforced · `ci.yml` green with every §20 stage live · local `< 30 min` onboarding measured · staging env fully deployed (hello-web + hello-engine + `/healthz` green) · prod env provisioned (not serving) · S3 `ap-south-1` buckets + scoped IAM live (RC-2) · migration discipline proven (spike migration generated, applied in CI and staging, rolled forward) · **tracer report committed with M1–M4 measured** (pass → IP-1 authorized; fail → substrate decision memo) · spike deleted · Blueprint §4 gates recorded in `GATES.md` · phase tagged `ip0-frozen`.

## 37 · Approval checklist (founder)
☐ Stack table (§9) approved — especially Node 24 / Fly / Neon-with-tracer-escape / **S3 Mumbai for RC-2**
☐ Environment model (§13) approved — prod provisioned-but-dark until IP-8
☐ No-secrets-SaaS ruling (§12) accepted
☐ Tracer measurements M1–M4 (§32) accepted as pre-registered pass/fail
☐ §34.1 rejections accepted (no k8s, no GraphQL, no flag/secret SaaS, no OTel-yet)
☐ **APPROVED — IP-0 build begins**

*IP-0_DESIGN.md v1.0 · CTO · 2026-07-12. On approval, first PRs: repo scaffold → CI → local env → deploys → tracer.*
