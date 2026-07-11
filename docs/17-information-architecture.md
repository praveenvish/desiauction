# 17 — Information Architecture

> Canon: C-3, C-8, C-9 · v1.0 · 2026-07-11

## The shape of the product

**One engine, five surfaces** (C-3). The Engine is the only writer of auction truth; every surface is a read model plus the narrow set of commands its audience is granted. This is the single most important architectural *and* experiential fact: it is why screens can never disagree (invariant 12).

```
                    ┌─────────────┐
        commands →  │   ENGINE    │  → event ledger (seq)
                    └──────┬──────┘
      ┌──────────┬─────────┼──────────┬──────────┐
   CONSOLE    COCKPIT   OWNER ROOM   STAGE    OVERLAY
  organizer   conduct    owners      public   projector
```

## Surface charters

| Surface | Audience | May command | Never shows |
|---------|----------|-------------|-------------|
| **Console** | Organizer/staff (granted) | All setup CRUD; auction setup; approvals; exports | Live conduct controls (that's Cockpit's job) |
| **Cockpit** | Auctioneer/director | Start/pause/resume auction; open/close lots; audited overrides; (proxy bids in manual mode, 41) | Anything not needed mid-conduct — no settings, no lists, no admin |
| **Owner Room** | Team owners | Place bids; view own purse/squad/receipts | Other teams' remaining-purse detail when money-visibility redacts it (invariant 35) |
| **Stage** | Spectators/players | Nothing (pure view) | Contact details, payment states, rejection reasons, unsold galleries (C-23) |
| **Overlay** | Projector/stream operator | Layout/scene selection only | Interactive anything — it is chromeless output |

## Console information hierarchy

```
Org home ── attention queue (what needs me today) + tournaments list
└── Tournament hub
    ├── Overview        phase engine: where we are, what's next, what's blocked (32, 44)
    ├── Registrations   intake queue → approve/reject (42)
    ├── Pool            approved players → lots: base prices, order, rounds (41)
    ├── Teams           teams, owners, purses, readiness (43)
    ├── Auction         rules config, readiness checklist, "Enter Cockpit", post-live: ledger
    ├── Results         squads, spend, receipts, publishing (post-auction); fixtures/standings in H2
    └── Settings        identity, branding, visibility, tokens, pass/billing, danger zone
```

Object pages follow **overview → detail-on-demand**: a person, team, or lot has a *peek* (slide-over summary, 31) from any list, and a full page only where a full page earns its existence (team page, player profile). Lists are the workhorses; peeks prevent navigation churn (16).

## The live room's information physics

During a lot, attention priority on every live surface, in order: **current bid → leading team → timer → player identity → purse context → history**. Layouts implement this priority at every breakpoint (14); anything that inverts it (e.g., a huge player photo dwarfing the bid on Stage) violates 05 law 4.

Cockpit adds a second lane: **conduct state** (what can I do right now, why not, what's queued) — the operator's attention derivation (8 attention states, 39) decides the one highlighted action.

## Content objects and ownership

| Object | Owned by | Surfaced on |
|--------|----------|-------------|
| Organization, grants | Console/Settings | Console |
| Tournament, pass | Console | All (identity strip) |
| Registration | Registrations | Console; player's own status page |
| Player (pool entry / lot) | Pool | All live surfaces during their lot |
| Team, ownership, purse | Teams | Console, Owner Room, Stage (redaction-aware) |
| Auction config | Auction tab | Cockpit (read), locked at readiness gate (44) |
| Ledger (bids, purchases) | Engine | Cockpit/Owner Room live; Console/Results after; receipts |
| Results/squads | Derived from ledger | Results, Stage/results, exports |
| Audit | Platform | Console/Settings → Audit (48) |

## Search & findability

⌘K palette in Console spans entities + actions (33); public surfaces have no search in V1 (a tournament's public pages are small and linear); every entity's canonical URL is stable (16) so external search and shared links work forever.
