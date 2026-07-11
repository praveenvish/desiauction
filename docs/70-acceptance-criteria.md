# 70 — Acceptance Criteria

> Canon: C-21 · v1.0 · 2026-07-11

Releases are defined by journeys that pass end-to-end in real browsers with evidence — the reference program's hardest-won discipline (its six Golden Journeys took the product to engineering freeze; ours are carried in spirit and upgraded to this rebuild's scope).

## The six Golden Journeys

Each journey lists its **non-negotiable assertions**; full scripts live with the E2E suite (58), named for these IDs.

### GJ-1 — Registration: from link to pool, with dignity

Player registers on a 360px phone (OTP verify at submit) → organizer triages via peek queue → approve/reject/waitlist.
**Asserts:** OTP delivery + rate limits; duplicate-mobile block with self-service help; human-gate (invariant 5); private rejection reason (inv 6); player status page correct at every state; triage of 60 registrations ≤ 20 min (42); draft survival on connection loss (29).

### GJ-2 — Tournament: from creation to auction-ready

Create org+tournament → configure auction (slabs, quotas, purse) → teams + owner invites → owners *accept* on phones → pool priced/ordered → readiness gate → lock.
**Asserts:** phase engine guidance correct at each step (44); every readiness failure deep-links to its fix; invariant 15 unbypassable (API-level attempts rejected); lock ceremony + post-lock edit attempts require override (inv 16); Free-tier limits enforced politely (45).

### GJ-3 — The auction night (conduct): calm command

Director runs the full night from the Cockpit: start → lots → gavel (hold) → pause/resume → an undo (override) → a frozen-lot resolution → complete.
**Asserts:** keyboard-complete conduct (13/15); disabled-with-reason everywhere; undo appends compensating events, history intact (41); freeze never blocks the next lot (inv 19); manual/proxy mode mid-auction; paper-mode export available (61); Cockpit INP < 100ms under event load (57).

### GJ-4 — The auction night (money): owners bid, truth holds

8 owners on phones bid a contested slate: snipe wars, increments, reserve pressure, a disconnect/reconnect mid-lot.
**Asserts:** the validation gauntlet end-to-end, every rejection code with correct copy (41/21); anti-snipe never shrinks (inv 14); reconnect → catch-up ≤ 2s with correct seq (04 beat 2); receipt ≤ 10s after SOLD (04 beat 3); purse identical across Cockpit/Owner Room/Stage at same seq (inv 12, **asserted by simultaneous scrape**); bid ack p99 within SLO under load (56).

### GJ-5 — The public night: the show and the record

Spectators watch the Stage (phone + projector); SOLD ceremonies land; auction completes; results publish; links shared.
**Asserts:** ceremony renders only after commit (inv 13) and syncs across surfaces < 1s; unsold dignity grammar (inv 7, C-23); redaction per money-visibility on public read model (inv 35); results page correct, fast (57), and lives at a stable URL post-archive (inv 26); 5,000-viewer load holds (57); zero PII on any public surface (inv 8).

### GJ-6 — Commerce: pass, pay, entitle, export

Organizer upgrades to Pro Pass (Razorpay UPI) → entitlements activate → runs tournament → exports everything → lets the pass lapse → data remains readable/exportable.
**Asserts:** webhook-driven activation (46); immutable invoice + GST fields (inv 24); refund-before-live path with credit note; entitlement-loss locks capabilities but never data (inv 26); every export audited with provenance (inv 33).

## Cross-cutting acceptance (every release)

- **The 35 invariants** each have at least one passing automated test (40 map) — the invariant suite is release-blocking.
- The five-second premium test (01) on each surface's landing state — founder-judged, recorded.
- The five emotional beats (04) demonstrably intact — reviewed against GJ-3/4/5 evidence.
- A11y manual pass on the journeys' critical screens (13); budgets green (57); SLO dashboards healthy over the release's staging soak (56).

## Evidence standard

A journey "passes" when: run on staging (or production pilot) · real browsers at the designed extremes (14) · evidence captured (recording + assertion logs + seq references) · filed with the release record (69 phase gate). Verbal "it works" has no standing (67 §2).
