# FINANCIAL OPERATIONS SECURITY & THREAT MODEL

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · **FROZEN** (IP-6 freeze)

> What an attacker can and cannot do to financial operations. Source of
> truth: `packages/financial-operations` (pure invariants + server tier),
> migration `0014` (RLS). Every claim below is backed by a permanent
> regression test (`financial-operations-*.regression.test.ts`, 77 tests,
> live PG17). Governed by canon C-8/C-9/C-13, docs 48/49, and the frozen
> IP-5 security model one platform down.

## 1 · The trust boundary

Financial operations is a purely additive consumer of the frozen platforms.
It **reads** `settlement_events`, settlement projections (discovery only) and
reference data; it **writes** only its own five streams, their disposable
projections, and operational state (cursors, jobs, schedules) — plus one
sanctioned cross-context write (finops grant issuance, gated by the frozen
`grant.issue`). It holds **no write path** to `settlement_events`,
`auction_events`, any frozen row, or either frozen capability engine: the
settlement source port has no write method, the dependency graph forbids the
imports, and every regression suite ends with the meter — **the settlement
log is bit-identical across everything finops does** (runtime proof, every
run).

## 2 · Authorization (the three-way partition)

Three engines partition the capability space with **no bleed in any of the
six directions**, proven by test: the frozen engine, the settlement engine
and the finops engine each expand the others' sets to nothing. Atoms:
`finops.view` · `finops.manage` · `finops.document` · `finops.dispatch` ·
`finops.export` · `finops.operate` · `finops.close` · `finops.override`.
Sets: `finops:clerk` ⊂ `finops:accountant` ⊂ `finops:controller`. Separation
of powers: issuing documents confers neither sealing years nor reopening
them; operating the queue confers neither. The writer re-checks capability
inside command execution; system paths (runner, follower, recovery) run under
the all-zero sentinel and are audited like any actor. Dead-letter requeue is
`finops.operate`-gated and audited.

## 3 · Tenant isolation (RLS)

All **ten** org-scoped finops tables (`finops_events`, `finops_profiles`,
`finops_series`, `finops_documents`, `finops_dispatches`, `finops_exports`,
`finops_periods`, `finops_period_days`, `finops_cursors`, `finops_jobs`) ship
`ENABLE` + `FORCE ROW LEVEL SECURITY` with both `USING` and `WITH CHECK`
keyed to `current_setting('app.org_id', true)` — fail-closed, no self-row
disjunct. `finops_schedules` is the ONE exception: platform slot names and
epoch instants, zero tenant rows. **Certified:** under a dedicated
non-superuser role, no context and a foreign context fold to zero rows on all
ten tables; a foreign-org write is rejected by `WITH CHECK` even while
holding a legitimate context. **Runtime tenancy has a second, structural
layer**: a document can only quote history the org's own follower consumed
(`watermark_behind_source`) — foreign streams have no cursor. Inherited
pre-deploy fact unchanged: `withTenant` call sites = 0; every finops path is
withTenant-compatible ([RUNBOOKS](RUNBOOKS.md) §10.1).

## 4 · Forgery — the layered defense

| Attack | Detection | Certified |
|---|---|---|
| Tampered projection row (any column, any table) | fold-vs-row diff on every command → `finops_halted`; recovery heals byte-identical | ✓ |
| Forged EVENT, sloppy (bad number/watermark/shape/type) | reducers fail closed (19-reason set); recovery refuses; restore is a prefix | ✓ |
| Forged EVENT, competent (self-consistent numbers) | **reproduction**: no honest re-render from settlement agrees with a dishonest figure — the document can neither be delivered (`document_not_reproducible`) nor exported (poisons no archive) and every snapshot shows the verdict | ✓ |
| Tampered/lost export artifact | sealed-digest verification; regeneration from sources; regeneration REFUSES to whitewash a run whose sources contradict its seal | ✓ |
| Forged fiscal evidence (row) | halt + heal; the seal lives in the EVENT and re-derives from pins | ✓ |
| Forged certification claim | re-derivation contradicts the planted digest (`certificationRegisterSnapshot`) | ✓ |
| False health (prettied rows) | health derives from folds and observation, never from mutable projections; unknown ⇒ never healthy | ✓ |
| Replayed/late/out-of-order provider callback | idempotent by `provider:{eventRef}` (original ack); terminal machines bounce contradictions; rejections audited as evidence | ✓ |
| Watermark corruption (cursor ahead of head) | supervisor fails the follower component; rewind heals | ✓ |

## 5 · Delivery-plane ingress

Provider callbacks are adapter-verified before any tenant is trusted
(unverifiable ⇒ nothing loaded, the IP-5 trusted-envelope doctrine);
transitions are idempotent by provider event ref; manual attestations carry
the `manual:{commandId}` sentinel and never masquerade as provider truth.
Unknown provider behaviour (anything outside the typed port contract) is a
crash → deterministic retries → DEAD LETTER for a human — never a guess. No
provider SDK exists in the package; the filesystem artifact store confines
keys to its root (path escape reads as missing, fail closed).

## 6 · What an attacker with DB write access can and cannot do

CAN: corrupt projections (healed byte-identically), plant self-consistent
document events (unmasked by reproduction, undeliverable, unexportable),
corrupt artifacts (detected by digest, regenerated), plant certification
claims (contradicted by re-derivation), corrupt cursors (supervisor-failed,
rewound). CANNOT, without detection: alter what any document SAYS (the
sealed digest + frozen settlement folds contradict it), alter a sealed
year's evidence (pins re-derive), make a broken system look healthy, or touch
settlement truth through any finops surface. Corrupting `finops_events`
itself is unhealable-by-design → restore (runbooks §4); the pre-deploy
writer-role restriction turns forged appends into permission errors.

## 7 · DPDP posture

Documents carry party label SNAPSHOTS (readable after renames/erasure);
erasure upstream pseudonymizes identity while issued financial documents
retain their facts for statutory horizons (docs 48/49). Delivery logs carry
recipient REFERENCES, not contact data; outbox files live under the org's
storage root. The runner logs identifiers and counts only (pino, doc 55).
