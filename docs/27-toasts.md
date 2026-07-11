# 27 — Toasts

> Canon: C-15 · v1.0 · 2026-07-11

## Contract

Toasts are the ephemeral confirmation layer (T2 successes, 25) and *nothing else*. If losing the message would harm the user, it is not a toast (26 sorting rules).

## Rules

- **Placement:** bottom-left on Console (clear of primary actions and dialogs), top-center on mobile surfaces. Never over live auction content — live surfaces use almost no toasts at all (the stream is the feedback, 15).
- **Duration:** 5s default; 8s with an action; pause on hover/focus; dismissible always.
- **Stacking:** max 3 visible, oldest collapses; identical toasts coalesce with a counter rather than stacking ("3 players approved").
- **Content:** one fact + at most one action (View / Undo). Scorer voice, ≤ 90 chars (21). Icons per intent (12); success/info/warning variants — **error toasts are banned** (errors render in context, 24; a vanishing error is a lie about severity).
- **Undo toasts:** only for the reversible class (15); undo window = toast lifetime; the action executes immediately and undo re-inverts it (never "delayed commit" — that fakes the timeline).
- **A11y (C-15):** toasts announce politely via the `Announcer`; they never receive focus automatically; their actions are keyboard-reachable via the toast region shortcut (F6 rotation); duration timers respect `prefers-reduced-motion` users by extending to 10s.
- **API:** `toast.success(fact, { action })` from `@da/ui` — intent-typed; free-form styling is not exposed.

## Litmus tests

- Would a user need this tomorrow? → tray (26), not toast.
- Is it about the page they're on, ongoing? → banner.
- Did the world already visibly change in view? → nothing (T0/T1, 25).
- Is it an error? → in context, styled honestly (24).
