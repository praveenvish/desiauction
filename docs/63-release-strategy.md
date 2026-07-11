# 63 — Release Strategy

> Canon: C-21, C-22 · v1.0 · 2026-07-11

## Cadence & vehicles

- **Continuous to staging** (every merge, 59); **production promotion** as small, frequent, boring releases — no big-bang trains.
- **Feature flags** (runtime, org-scopable): every user-visible feature ships dark, exposes progressively (internal org → pilot orgs → %-rollout → GA), and keeps a kill switch until proven (AI features permanently, 35). Flags expire: a flag past 90 days without GA/removal is a defect (flag debt is complexity debt, 03 §11).
- Engine changes ride the canary path (60) regardless of flags.

## Release gates (what "GA" means per feature)

A feature GAs when: DoD complete (69) + its Golden Journey impacts pass (70) + budgets hold (57) + a11y pass (13) + docs updated (68) + support/runbook notes exist. Marketing never announces what hasn't GA'd — the changelog (in-app, pull-based, 47) is generated from GA'd flags.

## Versioning

- Platform: date-based releases (`2026.07.2`) — SaaS users don't consume semver; support does.
- `@da/ui` + `packages/contracts`: semver, breaking = major + codemod (18).
- Public API: path-versioned per 50; deprecations with `Sunset` headers + direct email to key holders.

## Season-aware pacing (C-22)

The release calendar respects the auction calendar: **no adventurous GA in the 48h before a weekend's live slate**; risk-bearing releases land Monday–Wednesday. During peak season (tournament-dense months), the error-budget policy (56) tightens promotion criteria automatically — reliability outranks roadmap on the weeks that matter.

## Rollback doctrine

Anything can roll back: web = previous build; engine = previous image + replay (61); migrations = expand/contract discipline means the previous app version always runs on the current schema (52). A release without a tested rollback path doesn't promote (59 staging rehearses this monthly).

## Communication

- Organizer-visible changes: in-app changelog entry with a screenshot, plain language (20).
- Behavior changes affecting a live workflow (Cockpit keys, bid UX): advance in-app notice + a "what changed" card on first use — an operator is never surprised on auction night (02 trust).
- Incidents during rollout: honesty rules (49 breach process posture) — affected orgs hear from us first, in scorer voice.
