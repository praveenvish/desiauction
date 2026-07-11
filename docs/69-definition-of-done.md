# 69 — Definition of Done

> Canon: C-15, C-21 · v1.0 · 2026-07-11

"Done" is a checklist, not a feeling. Three scopes, each containing the previous.

## A change is done when

- [ ] Implements a documented behavior (doc section cited, 59 #9) — or the doc was updated first
- [ ] Types strict-clean, lint clean, all CI gates green (59)
- [ ] Tests at the right layer for what it is (58): core rules → unit+property; API → contract; UI → story+axe(+visual if look changed); flows → E2E touched
- [ ] Invariant tests updated if it touches any of the 35 (40 enforcement map)
- [ ] States designed, not defaulted: loading/empty/error/success per 22–25 for any new UI
- [ ] A11y: keyboard path + announcements verified for new interactions (13)
- [ ] Observability: new failure modes log with correlation (55); new user-visible errors carry refs (24)
- [ ] Reviewed per 64 (two approvals where required)

## A feature is done when

- [ ] All its changes are done (above), assembled behind its flag (63)
- [ ] Copy uses canonical strings/terminology (20, 21) in externalized string files
- [ ] Both themes verified where applicable (C-4); reduced-motion parity for any motion (11)
- [ ] Responsive verified at the surface's designed extremes (14) on the reference device (57)
- [ ] Performance budgets hold (57 CI evidence)
- [ ] Security posture reviewed if it touches auth/grants/money/PII (49)
- [ ] **Live-verified**: exercised end-to-end in staging against real services (the reference program's rule: render + API + permission + cleanup) — a feature never GAs on unit tests alone
- [ ] Docs/changelog/runbooks updated (68); support notes written if it changes operator-facing behavior (63)

## A phase is done when (README phase gates)

- [ ] Every feature in scope is done (above)
- [ ] The phase's Golden Journey acceptance passes end-to-end in a real browser, evidence recorded (70)
- [ ] The eight reviews pass: Product, UX, Architecture, Security, Performance, Accessibility, Engineering, AI (README) — findings resolved or explicitly accepted with owner + date
- [ ] No known P0/P1 defects; P2s inventoried honestly with owners
- [ ] Founder approval recorded

**The standing rule:** anything not on these lists that everyone "knows" should be checked — gets added to these lists. The checklist is the memory (C-20 spirit).
