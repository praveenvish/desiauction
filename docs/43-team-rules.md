# 43 — Team Rules

> Canon: C-8 · v1.0 · 2026-07-11

## Team creation & identity

- Teams belong to one tournament (38); name unique within it; branding (logo, colors) optional with tasteful defaults (a team without a logo gets a monogram, never a broken image).
- Created by `tournament:teams` grant-holders during Setup; team count sanity-checked against the Pass tier (45) and pool math (a 16-player squad max × 8 teams needs a 128-player pool warning — advisory, 35-style fact, not a block).

## Ownership (the trust handshake)

- Ownership = an **accepted** grant (39 Ownership machine): organizer invites by mobile → invite token (36) → owner opens, verifies OTP, sees *what they're accepting* (team, tournament, purse, auction date) → accepts → `team:bid` grant exists.
- **Acceptance is required before the auction** (invariant 15: every team needs an accepted owner to go live). Assignment-without-acceptance — the reference's proxied gap — is not representable.
- One person, one team per tournament (invariant 18, schema-enforced). Co-owners: V1 allows one `team:bid` holder per team (the money hand is singular); additional `team:view-own` grants for co-owners/viewers are unlimited.
- Owner-players (registered *and* owning) are legal (38); the conflict is handled at their own lot: the engine refuses the owner bidding on themselves-as-lot only if organizer policy says so (`selfBidPolicy`, default allow — village reality: owner-captains buy themselves; the ledger makes it transparent either way).
- Mid-auction owner revocation/replacement: override-gated; team freezes (cannot bid) until replacement accepts (39) — never silent proxying by admins (the money hand must be a real accepted human).

## Purse

- Purse per team from config (41); uniform in V1.
- **Purse is a projection** (C-9): `remaining = purse − Σ(purchases) − Σ(pre-assignment deductions)`; nothing writes it directly (invariant 11).
- Reserve rule (41 gauntlet #9) guarantees completability; `PurseMeter` (19) renders spent/reserved/available segments identically on every surface (invariant 12).

## Squad composition

- `squadMin`/`squadMax` + role quotas from config (41).
- Squad membership = Purchases + pre-assignments only (invariant 11): no direct "add player to team" edit exists post-pool-lock; pre-lock direct assignments are pre-assignment records (explicit, priced, audited).
- `SquadBoard` (19) shows filled slots, role quota state, and completability ("needs 3 more; purse allows it" — the reserve rule visualized).

## What teams never do in V1 (refused scope)

- No cross-tournament franchise identity (H2 Season lens); no team-level logins (owners are people with grants, C-8); no team wallets/finance beyond the purse (the purse is auction scope, not a bank).
