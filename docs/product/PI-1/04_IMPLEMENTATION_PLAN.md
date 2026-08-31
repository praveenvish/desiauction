# PI-1 · 04 — Implementation Plan

## Threat model delta · migration strategy · testing strategy · phases · risks · definition of done

---

## 1 · Security threat-model delta (over docs/identity/THREAT_MODEL.md)

PI-1 adds personal data, not attack surface — no new auth entry points, no
new API routes, no new capability sets. The deltas:

| Change | Threat | Mitigation (designed in) |
| --- | --- | --- |
| `player_profiles` (gender, DOB, location) | Over-disclosure; a viewer-level member or public visitor reading protected attributes | Table is platform-to-person (no org read path at all); every read/write is session-self-scoped; **gender and DOB are never rendered on any org or public surface** — public shows only what publication consent already covers; minors' suppression discipline reused verbatim |
| No RLS on `player_profiles` | App-layer-only scoping | Same recorded boundary class as `people`/`sessions` (SESSIONS.md §4); protected by a person-isolation regression test in the shipped pattern (listings never cross accounts) |
| OTP `purpose` column | Regression in the certified verify path | Additive column w/ default; candidate query gains one predicate; the seven integration + eight security regressions must stay green **unmodified**, plus two new cross-purpose tests; RC-4-grade review checklist attached to the PR |
| Signup consent record | Consent write failing must not block login | Same try/catch discipline as registration consent evidence (never fails a committed auth) |
| Career read model (system pool) | Cross-person leak via reader bug | Person id comes from the session only, never a parameter from the client; regression test asserts a foreign personId path cannot be reached from any action signature |
| `entry_category` + eligibility | Gender used as authorization | Structurally prevented: the engine is the only consumer; organizer paths receive advisories, not blocks; capability checks remain the only authz |
| DPDP obligations grow | Erasure vs. career history | Recorded now: erasure = anonymize `people` + null `player_profiles` row; registrations/lots keep their (already person-id-keyed, name-free) facts — matches the inventory's "anonymize, retain money facts" ruling. The inventory file gains rows for gender/DOB/location **in the same PR as the migration** |

Out-of-scope but recorded (pre-existing, unchanged by PI-1): CSP script-src
nonces; phone-lost recovery; system-pool read refactor (~130 sites);
spectator ticket revocability; **D1 media signer — scheduled here as Phase 5
because photos are load-bearing for profile UI**.

---

## 2 · Migration strategy

House rules verified and followed: hand-authored SQL (snapshots frozen at
0018 — `check-snapshots.mjs` refuses `db:generate`), long header comments,
additive/backwards-compatible, no destructive statements, **journal entry
appended with `when` bumped past the hand-spaced future dates** (the known
drizzle-skips-silently trap), new tables need role grants in
`ops/db/create-app-role.sql` + `verify-grants` manifest.

| # | Migration | Contents | Rollback posture |
| --- | --- | --- | --- |
| 0036 | `player_profiles` | table + `person_id` unique index + grants (app: full DML; system/engine/runner: SELECT) | additive — old build ignores it |
| 0037 | `otp_purpose` | `otp_codes.purpose text NOT NULL DEFAULT 'login'` + CHECK | additive; old build's inserts get the default |
| 0038 | `competition_entry_category` | `entry_category text NOT NULL DEFAULT 'open'` + CHECK | additive; every existing row is honestly `open` |
| 0039 | (Phase 6, optional) `franchises` | durable-name table + `teams.franchise_id` nullable + index; clone-path linking | additive |

No backfills required anywhere: absent profile rows are the empty state;
`open` is the true category of every existing competition; existing OTP rows
are all login-purpose in fact.

---

## 3 · Testing strategy (per the shipped harness)

- **Core unit** (vitest, pure): eligibility matrix (every reason + advisory
  path), completeness weights/missing list, new validators, gender enum
  edges, DOB bounds. Target: exhaustive over reasons — the engine is the one
  place gender logic lives, so its test is the platform's gender-correctness
  proof (brief §28 "no accidental gender assumptions").
- **Web regression** (real PG, `fileParallelism:false`):
  `player/profile.regression.test.ts` (self-scoping isolation, upsert,
  audit rows), `player/career.regression.test.ts` (abandoned-auction guard,
  withdrawn rendering, price gating), `auth/otp-purpose.regression.test.ts`
  (cross-purpose refusal ×2), consent-record-on-first-verify, category
  enforcement through `submitRegistrationAction` (block) vs organizer import
  (advisory).
- **Auth tripwires**: the existing 7 integration + 8 security-regression
  tests run **unmodified** — any needed edit escalates to RC-4-grade review
  by definition.
- **E2E** (Playwright, unique-phone STAMP convention, precompiled mode in
  CI): (1) fresh signup sees the consent notice → completes profile from
  `/home` rail → registers with prefill; (2) career page renders after the
  seeded settled demo season (fixed identity `+919999000001` has sold
  history in `seed:demo`'s Demo Cup); (3) women's-category journey: organizer
  sets category → mismatch refusal copy → profile update → success; axe on
  `/me/cricket` + updated `/account`; responsive certification adds
  `/me/cricket` to the route list.
- **No edits during e2e runs** (known harness rule) and no new
  `loading.tsx` above gates (Suspense-breaks-gates rule) — career page uses
  gate-first-then-stream.

---

## 4 · Phased plan

Ordering: data first, then the single enforcement point, then surfaces —
each phase independently shippable and verifiable (`pnpm verify` +
`test:integration` + e2e green at each cut).

| Phase | Scope | Est. |
| --- | --- | --- |
| **P0 — this review** | 00–04 docs; founder sign-off on the two declines (email+password, RBAC tables), the deferrals (self-attested history, public search, multi-sport), and the DPDP notice copy | done |
| **P1 — Domain + migrations** | 0036–0038; core validators + `player-profile.ts` extensions; profile server module (read/upsert, audit); DPDP inventory + grants-manifest updates in the same PR | ~1 wk |
| **P2 — Identity & auth seams** | signup consent notice + record; OTP purpose wiring; four audit actions; `/account` profile editors | ~1 wk |
| **P3 — Eligibility engine** | core engine; refactor-in-place of existing register checks behind it; category enforcement (self-serve block, organizer advisory); organizer/`/c` category surfaces | ~1 wk |
| **P4 — Progressive profile + wizard** | completeness core + `/account`/`/home` surfaces; wizard prefill + write-back checkbox | ~1 wk |
| **P5 — Career + media production path** | career read model; `/me/cricket`; public "also played in" section; organizer person-drawer; **D1: construct the SigV4 `ObjectSigner` for `BucketStorage`** (reuse the proven hand-rolled SigV4 from `s3-artifact-store.ts`) + preflight check goes truthful | ~1.5 wk |
| **P6 — Optional depth** | `franchises` durable team identity (0039) + career grouping upgrade; admin profile filters; admin person career panel | ~1 wk |
| **P7 — Hardening** | full e2e additions; threat-model + identity-doc amendments; perf sanity on career reads (rides `registrations_person_idx`; paginate seasons at 50) | ~0.5 wk |

Total ≈ 6–7 engineering weeks. P5's media signer is the only item touching a
founder external (bucket credentials exist per RC-1/S3 procurement track).

---

## 5 · Risks & tradeoffs

| Risk | Position |
| --- | --- |
| Touching the certified OTP path at all | Smallest possible diff (one column, one predicate, default preserves behavior); tripwire suites unmodified-green is the acceptance bar; if contention arises, P2 can ship without it (it closes a documented-deliberate reuse, not an exploit) |
| Profile/registration duplication of role/DOB/styles | Deliberate snapshot architecture (03 §1) — the alternative (normalize onto profile, registrations reference it) rewrites history when profiles change and reaches inside the auction pool's read path. Duplication here is the auditability feature |
| Gender collection at all | Optional-always with `unspecified` as a first-class answer; single evaluator; not public; not snapshotted. The alternative (competition-level only, no profile field) can't express eligibility at all |
| Career page cost | Read-only projection on an existing index; no caching layer until measured need (house: no premature perf) |
| `player_profiles` outside RLS | Consistent with every platform-to-person table; the compensating regression test is the same one that protects sessions |
| Deferring self-attested history | The brief wants it at registration; shipping it unlabeled would put unverified claims beside certified auction facts. Defer beats corrupt |
| Doc drift (identity docs frozen at IP-2) | P7 amends AUTHENTICATION/AUTHORIZATION/DPDP docs with dated amendment blocks (the 0017/0018 amendment precedent) rather than rewriting frozen sections |

---

## 6 · Definition of done

1. All 23 brief-§31 outputs delivered (00–04) and founder-acknowledged,
   including the declines/deferrals.
2. Migrations 0036–0038 applied on a pristine DB **and** on a dev DB with
   residue; `verify-grants` + `verify-rls` green; journal `when` convention
   honored (migration actually runs — verified by a schema probe, not
   assumed).
3. Auth tripwire suites pass unmodified; new regressions green;
   `pnpm verify:local` green; e2e suite green including the three new
   journeys, axe-clean, responsive-certified.
4. Every new personal-data column has a DPDP inventory row (purpose,
   collection point, retention, disclosure) in the same PR that creates it;
   gender/DOB render on no org-facing or public surface; the signup consent
   record exists for every new account.
5. Eligibility has exactly one evaluator; `grep -r "gender ==="` style
   checks outside `eligibility.ts` return nothing (enforced by a unit test
   over the module boundary, in the guardrails style).
6. Career page shows a real settled season end-to-end from `seed:demo`
   (demo user 1), with prices visible to self and correctly gated publicly.
7. Production media path boots: `MEDIA_STORAGE=bucket` constructs a working
   signer; `preflight:production` passes it honestly.
8. No auction, settlement, or finops table receives a new writer; depcruise
   rules pass unmodified.
9. Docs amended (identity set + doc 38 entity map + this folder marked
   as-built), each with a dated amendment block.
