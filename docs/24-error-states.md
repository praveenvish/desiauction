# 24 — Error States

> Canon: C-17, C-23 · v1.0 · 2026-07-11

## Doctrine

Errors are moments the product proves its honesty (03 §5). Every error answers: **what happened → what it means for your data → what happens next.** The middle clause is this product's signature: users are moving money; "your bids are safe" is the sentence that matters.

## Error taxonomy → UX

| Class | Example | Surface treatment |
|-------|---------|-------------------|
| **Field validation** | Bad phone number | Inline under field, on blur; summary-on-submit links to fields (29) |
| **Action rejection** (expected, rule-based) | Bid below current (41) | Inline near control, scorer tone with the corrective fact (21) — **not styled as system failure**; these are the rules working |
| **Action failure** (unexpected) | Approve call 500s | Control returns to rest, danger inline + retry; input preserved always |
| **Scoped outage** | Exports service down | Degraded-empty in that zone (22); rest of page fully functional (invariant 19) |
| **Page failure** | Route data irrecoverable | Full-zone error with reference ID + retry + door back home; chrome persists |
| **Live-stream failure** | Transport down mid-auction | Never an error page — the staleness ladder (23) + reassurance strings (21) |
| **Money freeze** (invariant 17) | Non-deterministic money op | Distinct **frozen** treatment (warning, not danger): "This sale is held for review — nothing is lost. The organizer resolves it in the Cockpit." Freezes always name the human who can act |

## Rules

- **Danger styling is for systems, never for people-outcomes** (C-23): unsold, rejected, removed use neutral ink treatment; red pixels mean *the machine failed*, and that meaning is never diluted.
- Every unexpected error shows a short **reference ID** (correlates to Sentry/trace, 55) — "Something failed on our side. Ref `7XK2-D4`" — support can find it in one search.
- No dead ends: every error state has at least one action (retry, go back, contact) and never traps focus.
- Retry is smart: idempotency keys (50) make retry always-safe on money-adjacent calls; the UI can therefore offer retry confidently instead of "did it go through?" ambiguity — the exact WhatsApp-era failure this product exists to kill.
- Error copy never speculates about cause; if we don't know, "on our side" is the honest phrase.
- 404/permission distinction is deliberate: unauthorized = honest permission-empty (22); nonexistent = 404. Private resources return 404 to non-members (no existence leaks, 49).

## Logging contract

Every rendered unexpected error emits a structured client event with the reference ID, surface, seq (if live), and sanitized context (55) — "zero silent failures" (C-2) includes the frontend.
