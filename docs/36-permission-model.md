# 36 — Permission Model

> Canon: C-8 · v1.0 · 2026-07-11

## Grants, not roles (C-8)

The unit of authorization is the **Grant**: `(person, scope, capability set, granted-by, granted-at, expires?)`. Roles exist only as **named capability sets** — ergonomic bundles (37) — never as enforcement units. The reference implementation's three overlapping role enums are the cautionary tale; here there is one mechanism.

```
Grant
├── person      → Person (authenticated identity)
├── scope       → Org | Tournament | Team   (exactly one)
├── capability set → named bundle of capabilities
└── audit       → who granted, when, why (48)
```

## Capabilities (enforcement atoms)

Verb-object strings, checked individually at every boundary (API, engine command, read model):

```
org:manage, org:billing, org:grants, org:audit-read
tournament:manage, tournament:registrations, tournament:pool,
tournament:teams, tournament:auction-setup, tournament:conduct,
tournament:override, tournament:results, tournament:export
team:bid, team:view-own
platform:support-read (internal, break-glass, heavily audited)
```

Rules:

- **Deny by default**; capabilities are additive; there are no negative grants (simpler to reason about; exclusion = don't grant).
- Scope inheritance downward only: an org-scope grant covers its tournaments; tournament covers its teams. Never upward or sideways.
- `tournament:conduct` ≠ `tournament:override`: conducting the auction and reversing recorded outcomes are separate powers (the auctioneer/undo separation carried from reference AUCTIONEER restrictions).
- `team:bid` is the money capability: exactly one accepted owner-grant per team holds it at auction time (43); every bid traces to the grant that placed it (invariant, 40 #19-adjacent).

## Structural invariants (enforced in schema, not policy)

- An org never has zero holders of `org:manage`-full (owner set) — invariant 2.
- One person cannot hold `team:bid` for two teams in one tournament — invariant 18.
- Grant changes are grant-gated (`org:grants`) and always audited; audit failure fails the change (invariant 28).

## Access tokens (the anonymous layer)

Capability-carrying URLs for people without accounts (16 URL grammar):

| Token | Grants | Notes |
|-------|--------|-------|
| `view` | Read a tournament's public read model | Money-visibility switch redacts purse detail **at the read model** (invariant 35) |
| `registration` | Submit one registration form | Rate-limited, expiring, revocable |
| `invite` | Accept a specific grant (owner/staff) | Single-use; acceptance creates the Grant + account |

Tokens are scoped, expiring, revocable, ULID-unguessable, and every use is logged (48). Tokens never escalate: a token is a narrow capability, not an identity.

## Enforcement architecture

- One policy module in `packages/core` (`can(actor, capability, resource)`) — pure, unit-tested, shared by web and engine. No inline permission checks scattered in routes (the drift that killed the old model).
- Read models are **grant-filtered at query time** (C-8, 33): unauthorized data is absent from responses, not hidden by UI.
- Engine commands carry the actor's grant context; the engine re-checks — the UI's disabled states (15) are courtesy, never the security boundary.
- Existence privacy: unauthorized object access returns 404, not 403, for non-members (49).
