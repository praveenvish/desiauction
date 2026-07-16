# IP-6 — FINANCIAL OPERATIONS · CLOSURE REPORT

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · phase closure record

The narrative record of how IP-6 went from a ratified architecture to a
certified platform, what was decided along the way, and what the next
engineering organization inherits. Evidence lives in
[IP-6_FREEZE](IP-6_FREEZE.md); this document is the story and the judgments.

## 1 · What IP-6 is

Settlement (IP-5) froze a machine that tells the truth about an auction's
money. IP-6 built the machine that OPERATES that truth without ever owning
it: the follower that consumes settlement history idempotently; the document
system that turns captures, dues and compensations into densely-numbered,
digest-sealed, forever-reproducible receipts, invoices and corrections; the
delivery and export layer that puts those immutable artifacts into hands and
archives over fail-closed ports; and the governance layer that attests every
day, seals every year with prefix-pinned evidence, derives health from
observation and certifies the whole edifice from replay. The constitutional
line (ADR-1) held to the last commit: **truth vs. testimony** — every money
figure anywhere in IP-6 is a quoted settlement fact, and the settlement log
is bit-identical after everything IP-6 does, measured on every suite run.

## 2 · The milestone arc

- **M-IP6-1 · Foundation** — five aggregates behind one writer; the closed
  23-type catalog (with the document-issuance branches deliberately dormant);
  the follower (rewind-safe cursors, watermarks); the runner (derived job
  keys, leases, deterministic backoff, dead letters); migration `0014` with
  RLS at birth; the third capability partition. Zero financial truth.
- **M-IP6-2 · Documents** — the dormant branches awakened: quotes read off
  the frozen folds (no API accepts an amount), layered issuance validation
  (fiscal legality, watermark coverage, one-cause-one-document, the
  registered-issuer posture gate), canonical rendering sealed by digest, and
  reproduction as the forgery detector. Zero new events, zero schema.
- **M-IP6-3 · Dispatch & Exports** — scan-based pipelines; ports over
  providers (in-app and outbox first-class; SDKs are pre-deploy drop-ins);
  outcomes as events, attempts as audited retries, unknowns as dead letters;
  exports that serialize reproduced document payloads, read-back verify, and
  heal from sources. Zero new events, zero schema.
- **M-IP6-4 · Operations & Fiscal Close** — evidence v2 (prefix-pinned,
  byte-reproducible across reopens forever); the supervisor (derived health,
  unknown-never-healthy, repairs nothing); the completed 8-check daily
  checklist; replay-derived, time-free, double-derived certification. Zero
  new events, zero schema.

## 3 · What the hostile process caught (and why that is the system working)

Three classes of finding, all fixed and regression-locked in-milestone:

1. **Cross-tenant job draining** (M-IP6-3): a global queue drained by
   differently-configured consumers let one tenant's worker claim another's
   sends. Fix: org-scoped claiming — which is also the per-org sharding seam
   the architecture had named as headroom.
2. **Export regeneration vs. lawful growth** (M-IP6-4): regeneration-equality
   verification broke for past exports whenever a new document lawfully moved
   the register. Fix: sealed-digest semantics for health and certification;
   regeneration remains the heal-window fact (ADR-9). The old semantics would
   have been a standing false alarm — the hostile suite caught a DESIGN error
   before any operator did.
3. **A stale drill under a completed checklist** (M-IP6-4): the foundation
   suite's export drill had sealed a fictional digest — honest when no store
   existed, honestly RED once verification did. The drill now stores real
   bytes. Documentation and tests describe reality.

Nothing else was found at freeze re-certification. The IP-4 lesson repeated:
the value came from attacking the platform and then re-attacking the
conclusions.

## 4 · Judgments a reviewer should weigh

- **The catalog never grew.** Every workflow the four authorizations named —
  manual completion, cancellation, retries, certification, year-end — mapped
  onto the ratified 23 shapes or onto audit breadcrumbs. That is the
  strongest possible evidence the original aggregate boundaries were right.
- **One migration for the whole phase.** M-IP6-2/3/4 shipped zero schema
  changes; every capability landed as commands, folds and read models over
  the foundation's substrate.
- **Fail-closed everywhere a guess was possible**: unknown events, unknown
  provider responses, unknown operational state, unverifiable documents,
  unconfigured channels, registered-issuer invoices — all refuse
  deterministically rather than approximate.
- **The two-proof split** (ADR-14) is deliberate: fiscal seals are the
  eternal, pinned proofs; certification is the operational now-proof. A
  reviewer should confirm this split is acceptable before extending the
  certification register's claims.

## 5 · What downstream phases inherit

They may read every register and snapshot, build adapters behind
`DeliveryPort`/`ExportPort`/`ArtifactStorePort`, and consume the fiscal
seals and certification reports. They may not write finops events, mint
document numbers outside the series lanes, calculate money anywhere, or
require a finops or settlement rule change. The named extension points, each
an ADR against this package: GST decomposition (ADR-6) · provider adapters ·
S3 artifact store · doc-impact attention policy · public `/v1` schemas ·
supervisor thresholds as org policy · sampling tiers for the governance
sweeps.

## 6 · Program hygiene

IP-6 enters history as two chronological commits (implementation, then
certification/freeze documentation) and the annotated tag `ip6-frozen`
(v0.6.0), per the freeze authorization. The prior phases' convention —
per-milestone commits — was not followed during IP-6 implementation (the
working tree accumulated all four milestones); the freeze authorization's
two-commit sequence is the recorded remedy, and future phases should return
to per-milestone commits.

## 7 · Closure

IP-6 is complete: designed, built in four approved milestones, reconciled,
hostile-certified, measured, and frozen. The platform now runs a full
financial operations office — follower to seal to certificate — on top of a
settlement core it has provably never touched.
