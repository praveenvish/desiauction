# 29 — Form Standards

> Canon: C-15, C-24 · v1.0 · 2026-07-11

## Construction

All forms are built from `Field` + `Form` (19): react-hook-form + zod schemas from `packages/contracts` — **the same schema validates client and server** (50); drift is impossible by construction.

## Layout

- Single column, always (multi-column form grids measurably increase errors; the only sanctioned pairing is City+PIN style intrinsic pairs inside one `Field` row).
- Labels above inputs, always visible — **placeholder-is-not-a-label** (13); placeholders show format examples only ("98765 43210") and never information the user must retain.
- Help text under label (persistent) for rules the user needs *before* typing; ≤ 48ch (09).
- Logical sections with headers every 4–7 fields; one primary action, bottom-left aligned with the fields (Console), sticky footer on mobile (14).
- Required is the default; optional fields are marked "(optional)" — never asterisks (in a form where money rules apply, most fields are required; marking the exception is calmer).

## Validation choreography

- **On blur** for format checks; **on submit** for completeness; **live** (as-you-type) only for availability checks (slug, phone uniqueness — debounced, with pending state) and for money fields showing consequences ("Leaves ₹40,000…", 21).
- Errors: inline under field, danger-styled, specific and corrective (24); on submit-with-errors, focus moves to first error and a summary appears at top linking each error (13).
- Errors never appear while the user is still typing their first attempt into a field (no premature red).
- Server rejections map back to fields via the shared schema's error codes; unmapped server errors render at form level with reference ID (24).

## Data-entry ergonomics (phone-first market, C-24)

- Correct input modes everywhere: `inputmode="numeric"` + auto-format for phones (10-digit Indian mobile, `+91` implicit), money fields with Indian-notation live formatting (₹ prefix, lakh grouping — `Money` input variant, 19).
- Autocomplete attributes on all identity fields (name, tel, email) — registration speed matters at scale.
- Paste-friendly: phone fields strip spaces/dashes/`+91` on paste rather than rejecting.

## Persistence

- **Drafts autosave** on any form longer than 5 fields (registration, tournament setup): debounced 2s to local + server draft where the object supports it; "Saved" wisp (T0, 25); restoration offered on return.
- Navigation with dirty state guards with a dialog (16); browser back never silently destroys typing.
- Multi-step (wizards): steps are URL-addressable, validated per-step, reviewable at the end ("Review & create" summary); steps never lose state moving backward. Setup wizards state total steps honestly ("Step 2 of 4").

## Special fields

- Phone verification (OTP): 6-digit, auto-advance, `autocomplete="one-time-code"`, resend with countdown, rate-limit messaging honest (42).
- File/photo upload: client-side compress before upload (player photos on hall Wi-Fi), instant preview, background upload with progress, replace/remove affordances; failures never lose the rest of the form (invariant 19 in miniature).
