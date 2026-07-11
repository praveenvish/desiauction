# 15 — Interaction Design

> Canon: C-4, C-9, C-15 · v1.0 · 2026-07-11

## Input state model

Every interactive element implements the full set: `rest → hover → focus-visible → active → busy → disabled`, plus `selected` where applicable. Specified once in `@da/ui` primitives; screens never hand-roll states (19).

- Hover: enhancement only (14); 80ms; never reveals sole affordances.
- Disabled: **always with a reason** — disabled controls carry a tooltip/inline note explaining why and what unlocks them (carried from the reference Cockpit's best pattern). An unexplained disabled control is a defect.
- Busy: the control itself shows progress (spinner-in-button), input locked, label persists ("Approving…"); no full-screen spinners for scoped actions (23).

## Feedback contract (mutation classes)

Every mutation belongs to one class, declared in its API contract (50):

| Class | UX | Where |
|-------|----|-------|
| **Optimistic** | Applies instantly, reconciles quietly, rolls back with explanation on failure | Low-risk, reversible: notes, filters, view prefs |
| **Acknowledged** | Control busy → server confirms → success state | Default for Console CRUD |
| **Confirmed** | Explicit confirmation step before send; success is ceremonial or receipt-backed | Money, people-outcomes, irreversible: bids, approvals, lot close, purchases |

**Nothing on the money path is optimistic** (C-9): a bid button is `busy` until the engine acks with a seq — the previous product proved sub-150ms acks make this feel instant without lying.

## The bid interaction (Owner Room)

The product's most important control:

- Primary: one large bid button showing the exact next amount ("Bid ₹95,000") — never a bare "+". Amount is always explicit; increments follow slabs (41).
- Custom amounts snap to valid increments **at input time** with visible snapping (the server still validates; the UI just never invites invalid bids).
- Anti-fat-finger: bids ≥ 25% of remaining purse get one confirm tap ("Confirm ₹2.4 L — leaves ₹1.1 L"); below that, single tap (speed matters in a live room; the threshold is tuned, not debated per bid).
- After tap: button busy → ack → the *room's* bid landing animation is the success state (11); no toast (27 — the world changing IS the feedback).
- Outbid: the button re-arms with the new next amount within 300ms; a subtle haptic (where supported) signals "you were outbid" without alarm.

## Cockpit conduct model

- Keyboard-first: `Space` hold-to-gavel (400ms hold with visible progress — prevents accidental closes; carried best pattern), `P` pause, `→` next lot, `U` undo (opens audited override dialog, 41), `?` help overlay.
- Every conduct action has a disabled-with-reason state derived from the engine state machine (39) — the Cockpit physically cannot ask the engine for an illegal transition.
- Destructive/irreversible conduct (close lot with no bids → UNSOLD) requires the same hold gesture — friction proportional to consequence.

## Selection, drag, undo

- Selection: checkbox column + shift-range in tables (30); selected state is a fill, never color-only (13).
- Drag-and-drop: only for genuinely spatial tasks (pool ordering); always with keyboard alternative (grab/arrows/drop) and drop-target previews. Never drag for state changes that have buttons.
- Undo: UI-level undo (toast with Undo, 5s) only for reversible actions; money-path corrections are **audited overrides** with dialogs, never casual undo (invariant 16).

## Latency honesty

- <100ms: no indicator. 100–400ms: control-local busy. >400ms: progress with label. >2s expected: background job with notification on completion (53).
- Live surfaces show staleness, not spinners: if the stream gaps, the LiveBadge degrades ("Reconnecting — showing as of 19:42:10, seq 482") rather than blanking content (23).
