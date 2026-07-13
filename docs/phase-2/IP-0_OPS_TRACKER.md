# IP-0 OPERATIONAL READINESS TRACKER
## Single operational dashboard until IP-0 is frozen · Operations Coordinator
## Created 2026-07-13 · update continuously; append changes to §Log

---

## PROGRAM STATUS

| | |
|---|---|
| **Overall freeze readiness** | 🟡 In Progress — engineering done; operational work not started |
| **Completion** | 0 / 14 blocking tasks (0%) · 0 / 19 total |
| **Blocking items remaining** | 14 |
| **Estimated time to freeze** | ~1–2 calendar days once account creation starts (accounts ≈ one 2–3h founder sitting; engineering tail ≈ half a day; Run 2 minutes once staging is live) |
| **Final gate** | see §FREEZE GATE |

## NEXT THREE ACTIONS — always exactly three

1. **Founder: create the GitHub repository and push** (`desiauction-next`, private) — unlocks CI, branch protection, Dependabot, and every deploy path. 15 minutes, unblocks more than anything else.
2. **Founder: create Neon (verify Mumbai region availability FIRST) + Fly.io accounts** — the Run 2 pair. If Neon has no Mumbai region, say so immediately: that finding feeds the Run 2 gate, and we want it before anything else is wired.
3. **Founder: create Vercel + Sentry + AWS accounts** (S3 `ap-south-1` bucket + scoped IAM) — completes the account set; engineering takes over from there.

## TRACKER

Owner F = Founder · E = Engineering · Priority P0 = freeze-blocking chain · Evidence = what proves it done.

### Source Control
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Create GitHub repo + push `main` | Activates CI/Dependabot/collab | F | P0 | Yes | ☐ Not started | — | remote URL; Actions tab shows ci.yml run | — | Private; org or personal |
| Branch protection: require CI, squash-only, linear | Enforce §16–18 discipline | F | P0 | Yes | ☐ | repo | settings screenshot / ruleset | — | 5 min in settings |

### CI/CD
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| First remote CI run green | Prove pipeline off-laptop | E | P0 | Yes | ☐ | repo | green check on main | — | Should be push-and-watch |
| `FLY_API_TOKEN` secret in Actions | Enable engine deploys | F | P0 | Yes | ☐ | Fly account | deploy workflow stops skipping | — | App-scoped token |

### Cloud Infrastructure
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Fly.io account + apps `desiauction-engine-staging`/`-prod` (bom) | Engine home | F | P0 | Yes | ☐ | — | `fly apps list` | — | Prod app scaled to 0 (dark) |
| Vercel account + project (bom1), Git integration | Web home; previews; turbo remote cache | F | P0 | Yes | ☐ | repo | preview URL on a PR | — | `main` → staging domain |
| Engine staging deploy + smoke green | Live engine | E | P0 | Yes | ☐ | Fly + token + Neon | `/healthz` 200 + WS echo from workflow | — | Existing workflow does this |

### Database
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Neon account — **verify Mumbai region** | Run 2 substrate | F | P0 | Yes | ☐ | — | region name on project | — | **If no Mumbai: report immediately — feeds Run 2 gate** |
| Branches dev/staging/prod + migrations applied | Environment model §13 | E | P0 | Yes | ☐ | Neon | `db:migrate` output per branch | — | Prod stays empty |

### Object Storage
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| AWS account + S3 buckets `desiauction-media-{staging,prod}` in `ap-south-1` + scoped IAM | RC-2 / DPDP residency | F | P0 | Yes | ☐ | — | bucket region string; IAM policy JSON | — | Private-only; no public access |

### Monitoring
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Sentry org + 2 projects (web, engine); DSNs into Vercel/Fly | Error tracking live | F | P1 | No* | ☐ | accounts | test event visible | — | *Wiring is guarded; freeze-recommended not freeze-blocking |

### Secrets
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Staging secrets set (DATABASE_URL, SENTRY_DSN) in Fly/Vercel | Apps boot fail-closed | F+E | P0 | Yes | ☐ | accounts | healthz green in staging | — | Never in repo; platform stores only |

### Domains / DNS
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Production domain | Real URLs | F | P2 | No | ☐ | — | — | — | Not needed for freeze; platform domains suffice until IP-8 |

### Authentication / Messaging / Payment providers (NOT freeze gates — long-lead starts)
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| WhatsApp BSP application | IP-6; longest lead | F | P1 | No | ☐ | — | application ref no. | — | Start now, waits later |
| SMS/OTP provider account (RC-1) | IP-2 | F | P1 | No | ☐ | — | account + sender id | — | MSG91/Twilio-class |
| Razorpay KYC start | IP-6 | F | P1 | No | ☐ | — | KYC ref | — | Weeks-long pipeline |

### Security
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2FA on GitHub/Vercel/Fly/Neon/AWS/Sentry | Account takeover defense | F | P0 | Yes | ☐ | accounts | per-service confirmation | — | Do at creation time, not later |

### Developer Access
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Founder machine on Node 24 (optional hygiene) | Match pin | F | P3 | No | ☐ | — | `node -v` | — | Local 25 works; CI governs |

### Production Readiness (the engineering tail — E executes when above lands)
| Task | Purpose | Owner | Pri | Blocking | Status | Depends on | Evidence | Done | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Tracer Run 2** (spike on Fly bom vs Neon Mumbai; measure from Mumbai client) | **The Blueprint exit gate** | E | P0 | Yes | ☐ | staging live | IP-0_TRACER_REPORT §Run-2 filled, PASS/FAIL | — | FAIL ⇒ substrate memo, freeze holds |
| Onboarding <30 min measured (clean machine/user) | §33 DoD | F+E | P0 | Yes | ☐ | repo | timed run log | — | Founder's machine, fresh clone |
| Founder operational-readiness confirmation + demo | Gate 8 | F | P0 | Yes | ☐ | all above | note in GATES.md | — | |
| Drop-spike migration + delete `spikes/tracer-bullet` | Leave no throwaway | E | P0 | Yes | ☐ | Run 2 PASS | migration applied; dir gone | — | |
| Tag `ip0-frozen` | Freeze | E | P0 | Yes | ☐ | everything | annotated tag | — | Last act of IP-0 |

## FREEZE GATE (explicit)

1. All P0 tasks above ✅ → 2. **Tracer Run 2 executed successfully** → 3. **Founder confirms operational readiness** → 4. Recommend `git tag ip0-frozen` → 5. Declare **IP-0 FROZEN** + Freeze Report → stop; wait for **OPEN IP-1**.

## LOG
| Date | Change | Operator |
|---|---|---|
| 2026-07-13 | Tracker created; 19 tasks (14 blocking); status 🟡; next-3 issued | Ops Coordinator |
| 2026-07-13 | ED-1 recorded (ENGINEERING_DIRECTIVE_ED-1.md): account creation uses cost-tier defaults — GitHub Free · Vercel Hobby · Fly shared-cpu-1x · Neon Free · Sentry Free · S3 PAYG; expected burn ≈ $0–10/mo until pilot. No task/sequence changes | Ops Coordinator |
| 2026-07-13 | PRODUCTIVITY SPRINT (founder-directed, no accounts needed): ① pre-push security sweep — gitleaks 24 commits NO LEAKS (history push-safe); audit found HIGH drizzle-orm SQLi (GHSA-qx2v-qp2m-jg93) → patched to 0.45.2 + postcss override → audit CLEAN (first remote CI failure pre-empted). ② Docker path proven end-to-end locally: pnpm-v10 deploy bug found+fixed (--legacy), distroless image built, ran vs live PG — healthz db:ok + ws echo (acceptance-review risk CLOSED). ③ Onboarding rehearsal found REAL quickstart defect: tsx/drizzle-kit don't load .env.local → engine scripts now use node --env-file-if-exists; quickstart verified working as documented; warm-clone→env:check = 8s (formal clean-machine measure stays a freeze item). Full verify green after all changes | CTO |
