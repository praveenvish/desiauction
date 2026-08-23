# The DesiAuction Agent Team — operating manual

> Status: established 2026-08-19 · Scope: this repository only
> Charters: `docs/operations/agent-charters/*.md` (source of truth, 21 files)
> Runtime: `.claude/agents/*.md` (what Claude Code reads)

## Install

The charters ship in `docs/` because a remote session is not permitted to write into `.claude/` — agent definitions execute with tools, so installing them is deliberately a local, human act. Review them, then:

```sh
mkdir -p .claude/agents
cp docs/operations/agent-charters/*.md .claude/agents/
git add .claude/agents docs/operations/agent-charters docs/operations/AGENT_TEAM.md
git commit -m "chore: establish the DesiAuction agent team"
```

No restart is needed — Claude Code watches the directory. Verify with `/agents`.

Keeping the charters in `docs/` as well as `.claude/` is not accidental: this repo's first rule is that docs are the source of truth, and the team's own constitution should live under that rule. When you change a charter, change it in `docs/` and re-copy.

## What this is

Twenty-one specialist agents, each with its own charter, model tier and tool permissions, covering DesiAuction from R&D through go-live to steady-state operation. They are **project-scoped**: they exist only inside this repository, they know this repository's Canon, and they do not follow you to other work.

They are not a replacement for you. Every one of them prepares, analyses, reviews or drafts. **Praveen decides, and Praveen is accountable.** That boundary is written into each agent and it is deliberate.

## The roster

### Command

| Agent | Model | Use it when |
|---|---|---|
| `cto` | opus | You want a **ruling**, not a report. Architecture decisions, technical trade-offs, sequencing, go/no-go recommendations. Read-only by design — it rules, others implement. |
| `chief-of-staff` | opus | Everything feels urgent and you need the real dependency graph. Prepares decisions with options and a recommendation. Explicitly not a CEO. |

### Governance

| Agent | Model | Use it when |
|---|---|---|
| `canon-keeper` | opus | Before merging anything touching business rules, money, auction mechanics or the domain model. Hunts doc/code drift and checks whether each invariant is *unrepresentable* or merely *forbidden*. |

### Engineering

| Agent | Model | Use it when |
|---|---|---|
| `architect` | opus | Before writing code for any non-trivial change. Designs, checks boundaries, writes the ADR. |
| `code-critic` | opus | On any diff before it merges. Adversarial, read-only, ranks by severity. |
| `engine-guardian` | opus | Anything touching `apps/engine` or `packages/core` — the ledger, single-writer model, timers, idempotency, WebSocket edge, recovery. |
| `db-steward` | sonnet | Any schema change, and before any deploy touching the database. Owns the four-role recipe, RLS, migrations, restore verification. |
| `security-auditor` | opus | Threat modelling, auth, secrets, rate limits, dependency vulnerabilities, pen-test prep. Read-only. |
| `test-engineer` | sonnet | Failing tests, coverage, regression tests, the flaky register. **Currently owns the most blocking non-founder task in the company.** |
| `perf-engineer` | sonnet | Load testing, SLO verification, the staging performance certification. Measures; never estimates. |

### Release and run

| Agent | Model | Use it when |
|---|---|---|
| `release-captain` | opus | Before any deploy. Runs the gate sequence, determines the rollback story, gives GO / NO-GO / GO WITH CONDITIONS. |
| `sre-oncall` | sonnet | Monitoring, alerts, runbooks, incidents, and everything after go-live. |
| `provisioning-tracker` | sonnet | "What do I actually need to buy or configure next?" Tracks the founder-external critical path. |

### Product and design

| Agent | Model | Use it when |
|---|---|---|
| `product-strategist` | opus | Deciding what to build next, and challenging whether work in flight is the highest-value work available. |
| `floodlight-guardian` | sonnet | Before shipping any UI. Colour, type, motion, icons, accessibility, dignity rules. |
| `ux-writer` | sonnet | Any user-facing string: buttons, errors, empty states, notifications, help articles. |

### Business and go-to-market

| Agent | Model | Use it when |
|---|---|---|
| `growth-operator` | sonnet | Go-to-market planning and execution: platforms, the Founding 25, calendar, community, analytics. |
| `content-producer` | sonnet | You need the actual asset written — caption, carousel, Reel script, YouTube description. |
| `support-lead` | sonnet | Organizer onboarding, issue triage, help content, looking after real users. |
| `legal-risk-reviewer` | opus | Spotting what needs a real lawyer. DPDP, contests, ASCI, IP, terms. Not a lawyer. |
| `finance-analyst` | sonnet | Pricing models, unit economics, cost structure. Prepares the analysis; **the price is your decision alone.** |

## How to invoke them

In Claude Code, name the agent:

```
Use engine-guardian to review the idempotency cache changes in apps/engine.
Ask release-captain whether we can deploy today.
Have code-critic review the diff on this branch.
```

Or let Claude route automatically — each `description` is written so the right specialist gets picked for the right task. Name one explicitly when you want *that* perspective specifically.

**Run several in parallel** when the work is independent:

```
In parallel: canon-keeper audits invariants 10-14, security-auditor reviews the
WebSocket edge, and test-engineer reports the real e2e pass count.
```

## The escalation ladder

| Level | Who decides |
|---|---|
| Style, naming, test structure, copy variants | The specialist |
| Architecture within an existing pattern | `architect`, reviewed by `code-critic` |
| Architecture that changes a pattern, or any Canon question | `cto`, recorded as an ADR |
| Anything touching money, dignity, or a real person's data | `cto` + `canon-keeper`, and **Praveen is told before it ships** |
| Pricing, partnerships, legal exposure, spending money | **Praveen alone.** Tier C. No agent decides these. |

## What no agent may do — enforced in every charter

- **Touch the money path (C-10).** No agent places a bid, sets a price, approves or rejects a person, or renders as engine truth.
- **Deploy to production.** They recommend; you execute. None has production credentials and none should ever ask for one.
- **Publish anything naming a real person** without written consent on file.
- **Publish an unsold list, or anything ranking players** (C-23). Structural, not editorial.
- **Declare compliance.** `legal-risk-reviewer` flags; a lawyer opines.
- **Mark work complete that isn't.** A green report on a red repo is the most expensive output available.

## A note on `permissionMode`

Agent files support a `permissionMode` field, and one of its values is `bypassPermissions`. **No agent here uses it, and none should.** It disables the approval prompts that stand between an agent and an irreversible change to your repository. If you ever see it appear in one of these files, someone or something added it and you should find out why.

## The standing cadence

### While pre-launch (now)

| When | Who | What |
|---|---|---|
| Start of a work session | `chief-of-staff` | What's the single next action, and what changed since last time |
| Weekly | `provisioning-tracker` | The founder-external list — what's done, what's next, what it costs |
| Weekly | `test-engineer` | Real e2e pass count, with the run output pasted |
| Before any merge | `code-critic` | Adversarial review of the diff |
| Before any schema change | `db-steward` | Migration plus grants and RLS verification, plus the rollback story |
| Fortnightly | `canon-keeper` | Drift audit — where have code and docs diverged |
| Before any deploy | `release-captain` | The full gate sequence and a GO/NO-GO |

### Launch week

| When | Who | What |
|---|---|---|
| T-7d | `release-captain` + `cto` | Full readiness review against the audit's conditions |
| T-3d | `sre-oncall` | Alerts live, runbooks current, alert-validation drill actually run |
| T-1d | `provisioning-tracker` | Every provider confirmed working, not merely purchased |
| T-0 | `growth-operator` | Launch-day sequence |
| T+1d | `chief-of-staff` | What actually happened versus what was planned |

### Auction nights (the one that matters most)

| When | Who | What |
|---|---|---|
| T-24h | `release-captain` | **Deploy freeze confirmed (C-22).** No migration, no deploy, no risky maintenance. |
| T-2h | `sre-oncall` | Health checks green, engine watchdog alive, runner tick fresh |
| Live | `support-lead` | 30-minute response. The room is told before the internet. |
| T+1d | `sre-oncall` | Postmortem if anything froze, degraded or surprised anyone |

### Steady state, post-launch

| Cadence | Who | What |
|---|---|---|
| Weekly | `sre-oncall` | SLO report against the real budgets |
| Weekly | `growth-operator` | Funnel: reach → activation → **completed auctions** |
| Monthly | `product-strategist` | Capability map health; is the weakest addressable link still the one being worked? |
| Monthly | `security-auditor` | Posture review, including the standing `BYPASSRLS` system-role risk |
| Quarterly | `db-steward` + `sre-oncall` | PITR restore drill on staging, timed against RTO |
| Quarterly | `canon-keeper` | Full Canon and invariant audit |

## Where the real work is right now

Three things, and only one of them is code:

1. **No CI workflow has ever executed** — the repository has no git remote, so every gate CI supposedly enforces is currently theoretical. `release-captain` owns it. It takes an afternoon.
2. **The e2e suite is not green** — last recorded 62 pass / 9 fail. `test-engineer` owns it. The audit's own words: *a NO-GO cannot lift on a suite nobody has seen pass.*
3. **Nothing is provisioned** — and only you can fix that. `provisioning-tracker` owns the list. Start the SMS provider first regardless of its position in the order, because DLT registration and KYC have the longest lead time and login is OTP-first: without SMS, nobody can sign in at all.

## Maintaining the team

These are plain markdown files. Edit them directly when a charter is wrong — that is the point of keeping them in the repo. If an agent gives you bad output twice for the same reason, the fix is usually a sentence in its file, not a better prompt from you.

Keep them in version control. When the Canon changes, the charters that quote it need to change too — that is `canon-keeper`'s drift audit applied to itself.
