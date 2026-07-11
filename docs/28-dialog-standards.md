# 28 — Dialog Standards

> Canon: C-15, C-23 · v1.0 · 2026-07-11

## When a dialog is allowed

A dialog interrupts; interruption must be earned. Sanctioned uses: **confirmation of consequence**, **a focused single decision** (reject-with-reason), **short focused creation** (≤ 5 fields; more than that is a page or drawer). Everything else — inspection (use Peek, 31), long forms (page), FYIs (banner/toast) — is not a dialog.

## Sizes & types

| Type | Width | Use |
|------|-------|-----|
| `ConfirmDialog` | 400px | One decision, two buttons |
| `Dialog` (form) | 480–560px | Short creation/edit |
| `Drawer` | 480px right | Contextual multi-step (import mapping) |
| `HoldToConfirm` | 400px | Highest-consequence money/irreversible acts |

## Confirmation ladder

Friction proportional to consequence (15):

1. **No dialog** — reversible actions; undo toast instead (27).
2. **ConfirmDialog** — consequential but recoverable: reject registration, remove owner invite. Button carries the object: "Reject Arjun's registration".
3. **ConfirmDialog + consequence sentence** — locks and go-lives (21 canonical strings): states *what changes and for whom*.
4. **HoldToConfirm** — audited overrides and irreversible money acts (reopen sold lot, cancel auction): a 400ms hold with progress (matching the Cockpit gavel gesture), plus the audit sentence "This is recorded with your name" (48).

Typed-name confirmation ("type DELETE") is used exactly once in the product: deleting a tournament with recorded money history — and even that only *archives* publicly, never destroys ledger rows (invariant 10; 44 danger zone).

## Behavior rules

- Focus: trapped; initial focus on the least-destructive control; `Esc` cancels; return focus to the invoker (13).
- The destructive/primary action is **never** focused by default and never the `Enter` target on ladder-3+ dialogs.
- Backdrop click closes only ladder-1/2 dialogs with no dirty state; dirty forms guard ("Discard changes?").
- Buttons: verbs with objects (20); cancel is always "Cancel", always secondary, always leftmost of the pair (RTL-flips).
- Dialogs never stack more than two (a confirm atop a form-dialog is the max); a third level means the flow needs redesign.
- Async submit: primary button goes busy in place (15); the dialog closes only on success — failures render inside the dialog (24), input preserved.
- Every dialog is labelled by its title; consequence sentences are part of the accessible description (C-15).

## People-dignity note (C-23)

Dialogs about people (reject, remove) use neutral styling — the *dialog* isn't danger-red because a decision involves a person; red is reserved for destructive system acts (delete data). The reject dialog's tone: respectful, reason-required, private (21).
