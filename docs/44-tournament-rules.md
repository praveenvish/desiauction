# 44 — Tournament Rules

> Canon: C-11, C-21 · v1.0 · 2026-07-11

## Creation & identity

- Anyone with an org (creating a personal org is part of first-run) creates tournaments; a Free-tier Pass attaches automatically (45) — value before payment, always.
- Identity: name, location, dates, slug (immutable post-publish, 16), visibility (`private` default, `public` opt-in), branding + sponsor slots (06).
- One auction per tournament in V1 (38); multi-auction events (separate men's/women's pools) = separate tournaments under one org, honestly modeled until Season lens (H2) earns more.

## The phase engine (39 machine, experienced as guidance)

The tournament's Overview renders the machine as **one singular gate at a time** (32): where you are, what's next, exactly what blocks it. Phases don't nag; they answer "what do I do now?"

## Readiness gates (guards, 39)

### → RegistrationOpen
Name/dates/location set · registration link generated · (fee config valid if enabled).

### → AuctionReady (the big lock)
All must pass; each failing item deep-links to its fix (21 go-live copy):

1. Active Pass covering team/player counts (45)
2. AuctionConfig complete & coherent (purse ≥ squadMin × min base; quotas ≤ squadMax; slabs monotonic — validated as a set, 41)
3. Pool locked: every entry has base price, round, order; pool ≥ teams × squadMin
4. ≥ 2 teams, every team has an **accepted** owner (43)
5. Pre-assignments (if any) priced and within purse

Locking is explicit and ceremonial-adjacent (28 ladder 3): the organizer sees exactly what locks. Post-lock edits = audited overrides only (invariant 16).

### → AuctionLive
Readiness still green (re-checked at start, not just at lock) + engine healthy (its own checks, 51). Invariant 15 verbatim.

### → Completed / Archived
`AuctionComplete → Completed` in V1 (Playing phase is H2). Completion publishes results per visibility; archival makes everything read-only + exportable forever (invariant 26).

## Visibility & publishing

- `private`: all public URLs require view tokens (36).
- `public`: Stage and results are world-readable; **redaction still applies** (money visibility per config invariant 35; person-PII never public, invariant 8).
- Publishing results is an explicit act with a preview ("this is what the world sees"), not a side effect.

## Danger zone (Settings)

- Archive: normal, reversible (`org:manage`).
- Delete: only for tournaments with **no recorded money events** — a drafted mistake deletes cleanly; a tournament where money moved can only archive (invariant 10/24; 28 typed-confirm). The UI explains this honestly rather than hiding the door.
- Transfer to another org: not in V1 (tenancy is sacred, invariant 1); revisited with association features (H3).
