# DesiAuction screen review inventory

Final planning coverage checklist · 11 October 2026 · Baseline `55c97aef7887` · Local row/state evidence reconciled; external acceptance pending

Every discovered page entry appears below. Group IDs refer to the treatments in [PLAN.md](PLAN.md). Rows link their scoped current/inherited engineering evidence; human, device and release sign-off remain pending. No automatic sign-off from shared components is claimed. Existing capability gates, redirects and development gating remain part of each review.

The source has **141 page entries**. The prior production build reports **137 routes**; parallel slots, catchalls and special build entries make those counts non-equivalent. Dynamic entries represent templates and must be exercised with realistic fixture/season/role data.

For every row, record: reviewer, baseline capture, all existing actions and information, proposed layout, retained URL/permissions, applicable states, visual reference, keyboard/screen-reader result, performance result and final sign-off. Add the route publication fields from [CONTRACTS.md](CONTRACTS.md): public eligibility, session/token requirement, indexing, canonical/OG policy, public-parent eligibility and permitted sharing. Apply [FLOWS.md](FLOWS.md): record role/menu context, entry route, main task, success/next state, named return, browser Back and interruption recovery. No row is complete solely because a shared component changed.

## Route coverage

### G01 Public acquisition

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/about` | [page source](<../../../apps/web/src/app/about/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/careers` | [page source](<../../../apps/web/src/app/careers/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/case-studies/[slug]` | [page source](<../../../apps/web/src/app/case-studies/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/case-studies` | [page source](<../../../apps/web/src/app/case-studies/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/compare/[slug]` | [page source](<../../../apps/web/src/app/compare/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/compare` | [page source](<../../../apps/web/src/app/compare/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/contact` | [page source](<../../../apps/web/src/app/contact/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/features` | [page source](<../../../apps/web/src/app/features/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/for/[slug]` | [page source](<../../../apps/web/src/app/for/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/for` | [page source](<../../../apps/web/src/app/for/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/founding-25` | [page source](<../../../apps/web/src/app/founding-25/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/` | [page source](<../../../apps/web/src/app/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/pricing` | [page source](<../../../apps/web/src/app/pricing/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/releases` | [page source](<../../../apps/web/src/app/releases/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/schedule-demo/booked` | [page source](<../../../apps/web/src/app/schedule-demo/booked/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/schedule-demo` | [page source](<../../../apps/web/src/app/schedule-demo/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/schedule-demo/pick` | [page source](<../../../apps/web/src/app/schedule-demo/pick/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/security` | [page source](<../../../apps/web/src/app/security/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/sports/[slug]` | [page source](<../../../apps/web/src/app/sports/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/sports` | [page source](<../../../apps/web/src/app/sports/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G02 Identity and invitations

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/demo/[token]` | [page source](<../../../apps/web/src/app/demo/[token]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/email/unsubscribe` | [page source](<../../../apps/web/src/app/email/unsubscribe/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/join/[token]` | [page source](<../../../apps/web/src/app/join/[token]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/login` | [page source](<../../../apps/web/src/app/login/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/newsletter/unsubscribe` | [page source](<../../../apps/web/src/app/newsletter/unsubscribe/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/onboarding` | [page source](<../../../apps/web/src/app/onboarding/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/owner-join/[token]` | [page source](<../../../apps/web/src/app/owner-join/[token]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G03 Personal workspace

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/@action/home` | [page source](<../../../apps/web/src/app/@action/home/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/account` | [page source](<../../../apps/web/src/app/account/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/home` | [page source](<../../../apps/web/src/app/home/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/inbox` | [page source](<../../../apps/web/src/app/inbox/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G04 Organisation and season operations

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/@action/orgs` | [page source](<../../../apps/web/src/app/@action/orgs/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/reports` | [page source](<../../../apps/web/src/app/reports/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/players` | [page source](<../../../apps/web/src/app/players/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/@action/seasons/[slug]/teams` | [page source](<../../../apps/web/src/app/@action/seasons/[slug]/teams/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/@action/tournaments` | [page source](<../../../apps/web/src/app/@action/tournaments/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/org/[slug]` | [page source](<../../../apps/web/src/app/org/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/org/[slug]/t/[tournament]` | [page source](<../../../apps/web/src/app/org/[slug]/t/[tournament]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/org/[slug]/venues` | [page source](<../../../apps/web/src/app/org/[slug]/venues/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/orgs` | [page source](<../../../apps/web/src/app/orgs/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]` | [page source](<../../../apps/web/src/app/seasons/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/readiness` | [page source](<../../../apps/web/src/app/seasons/[slug]/readiness/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/register` | [page source](<../../../apps/web/src/app/seasons/[slug]/register/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/registrations` | [page source](<../../../apps/web/src/app/seasons/[slug]/registrations/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/reviews` | [page source](<../../../apps/web/src/app/seasons/[slug]/reviews/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/standings` | [page source](<../../../apps/web/src/app/seasons/[slug]/standings/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/teams` | [page source](<../../../apps/web/src/app/seasons/[slug]/teams/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons` | [page source](<../../../apps/web/src/app/seasons/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/tournaments/[slug]` | [page source](<../../../apps/web/src/app/tournaments/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/tournaments` | [page source](<../../../apps/web/src/app/tournaments/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G05 Fixtures and match day

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/seasons/[slug]/brief/[fixtureId]` | [page source](<../../../apps/web/src/app/seasons/[slug]/brief/[fixtureId]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/fixtures/calendar` | [page source](<../../../apps/web/src/app/seasons/[slug]/fixtures/calendar/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/fixtures/match-day` | [page source](<../../../apps/web/src/app/seasons/[slug]/fixtures/match-day/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/fixtures` | [page source](<../../../apps/web/src/app/seasons/[slug]/fixtures/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/fixtures/today` | [page source](<../../../apps/web/src/app/seasons/[slug]/fixtures/today/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/lineups` | [page source](<../../../apps/web/src/app/seasons/[slug]/lineups/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/posters` | [page source](<../../../apps/web/src/app/seasons/[slug]/posters/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G06 Scoring

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/match/confirm/[token]` | [page source](<../../../apps/web/src/app/match/confirm/[token]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/score/[fixtureId]` | [page source](<../../../apps/web/src/app/score/[fixtureId]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/score/[fixtureId]/setup` | [page source](<../../../apps/web/src/app/score/[fixtureId]/setup/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/score/handover/[token]` | [page source](<../../../apps/web/src/app/score/handover/[token]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/score/new` | [page source](<../../../apps/web/src/app/score/new/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/score` | [page source](<../../../apps/web/src/app/score/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/score/shell` | [page source](<../../../apps/web/src/app/score/shell/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G07 Public competition and match

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/c` | [page source](<../../../apps/web/src/app/c/(directory)/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/m/[shareToken]` | [page source](<../../../apps/web/src/app/m/[shareToken]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/c/[slug]/m/[fixtureNumber]` | [page source](<../../../apps/web/src/app/c/[slug]/m/[fixtureNumber]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/c/[slug]` | [page source](<../../../apps/web/src/app/c/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/c/[slug]/t/[team]` | [page source](<../../../apps/web/src/app/c/[slug]/t/[team]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G08 Profiles insights and awards

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/c/[slug]/p/[number]/insights` | [page source](<../../../apps/web/src/app/c/[slug]/p/[number]/insights/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/c/[slug]/p/[number]` | [page source](<../../../apps/web/src/app/c/[slug]/p/[number]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/me/[sport]` | [page source](<../../../apps/web/src/app/me/[sport]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/me/insights` | [page source](<../../../apps/web/src/app/me/insights/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/me` | [page source](<../../../apps/web/src/app/me/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/awards` | [page source](<../../../apps/web/src/app/seasons/[slug]/awards/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G09 Auction

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/auctions` | [page source](<../../../apps/web/src/app/auctions/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction/cockpit` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/cockpit/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction/engine` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/engine/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction/ledger` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/ledger/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction/live` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/live/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction/plan` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/plan/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction/replay` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/replay/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction/spectate` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/spectate/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G10 Money

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/money` | [page source](<../../../apps/web/src/app/money/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/org/[slug]/money/deliveries` | [page source](<../../../apps/web/src/app/org/[slug]/money/deliveries/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/org/[slug]/money/documents/[docId]` | [page source](<../../../apps/web/src/app/org/[slug]/money/documents/[docId]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/org/[slug]/money` | [page source](<../../../apps/web/src/app/org/[slug]/money/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/org/[slug]/money/reconciliation` | [page source](<../../../apps/web/src/app/org/[slug]/money/reconciliation/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/org/[slug]/settlement` | [page source](<../../../apps/web/src/app/org/[slug]/settlement/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/money/case/[caseId]` | [page source](<../../../apps/web/src/app/seasons/[slug]/money/case/[caseId]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/money` | [page source](<../../../apps/web/src/app/seasons/[slug]/money/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G11 Help content and tools

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/api-docs` | [page source](<../../../apps/web/src/app/api-docs/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/review/[token]` | [page source](<../../../apps/web/src/app/review/[token]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/guides/[slug]` | [page source](<../../../apps/web/src/app/guides/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/guides` | [page source](<../../../apps/web/src/app/guides/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/help/[slug]` | [page source](<../../../apps/web/src/app/help/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/help/category/[slug]` | [page source](<../../../apps/web/src/app/help/category/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/help` | [page source](<../../../apps/web/src/app/help/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/legal/[slug]` | [page source](<../../../apps/web/src/app/legal/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/legal` | [page source](<../../../apps/web/src/app/legal/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/rules-guidelines` | [page source](<../../../apps/web/src/app/rules-guidelines/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/search` | [page source](<../../../apps/web/src/app/search/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/support` | [page source](<../../../apps/web/src/app/support/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/tools` | [page source](<../../../apps/web/src/app/tools/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/tools/purse-calculator` | [page source](<../../../apps/web/src/app/tools/purse-calculator/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/tools/registration-form` | [page source](<../../../apps/web/src/app/tools/registration-form/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/tools/snake-draft` | [page source](<../../../apps/web/src/app/tools/snake-draft/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G12 Administration

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/admin/auctions/[auctionId]` | [page source](<../../../apps/web/src/app/admin/auctions/[auctionId]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/audit` | [page source](<../../../apps/web/src/app/admin/audit/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/demos/availability` | [page source](<../../../apps/web/src/app/admin/demos/availability/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/demos` | [page source](<../../../apps/web/src/app/admin/demos/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/erasure` | [page source](<../../../apps/web/src/app/admin/erasure/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/health` | [page source](<../../../apps/web/src/app/admin/health/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/live` | [page source](<../../../apps/web/src/app/admin/live/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/moderation` | [page source](<../../../apps/web/src/app/admin/moderation/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/newsletter` | [page source](<../../../apps/web/src/app/admin/newsletter/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/notifications/[kind]/email` | [page source](<../../../apps/web/src/app/admin/notifications/[kind]/email/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/notifications/analytics` | [page source](<../../../apps/web/src/app/admin/notifications/analytics/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/notifications` | [page source](<../../../apps/web/src/app/admin/notifications/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/notifications/suppressions` | [page source](<../../../apps/web/src/app/admin/notifications/suppressions/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/notifications/templates` | [page source](<../../../apps/web/src/app/admin/notifications/templates/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/orgs/[slug]` | [page source](<../../../apps/web/src/app/admin/orgs/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/orgs` | [page source](<../../../apps/web/src/app/admin/orgs/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin` | [page source](<../../../apps/web/src/app/admin/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/passes` | [page source](<../../../apps/web/src/app/admin/passes/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/people/[personId]` | [page source](<../../../apps/web/src/app/admin/people/[personId]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/people` | [page source](<../../../apps/web/src/app/admin/people/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/reports` | [page source](<../../../apps/web/src/app/admin/reports/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/reviews` | [page source](<../../../apps/web/src/app/admin/reviews/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/admin/roles` | [page source](<../../../apps/web/src/app/admin/roles/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G13 Broadcast and embeds

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/c/[slug]/m/[fixtureNumber]/board` | [page source](<../../../apps/web/src/app/c/[slug]/m/[fixtureNumber]/board/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/c/[slug]/m/[fixtureNumber]/overlay` | [page source](<../../../apps/web/src/app/c/[slug]/m/[fixtureNumber]/overlay/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/embed/[slug]` | [page source](<../../../apps/web/src/app/embed/[slug]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction/board` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/board/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/seasons/[slug]/auction/overlay` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/overlay/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

### G14 System and development

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/@action/[...missing]` | [page source](<../../../apps/web/src/app/@action/[...missing]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/[...missing]` | [page source](<../../../apps/web/src/app/[...missing]/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/dev/inbox` | [page source](<../../../apps/web/src/app/dev/inbox/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/gallery/emails` | [page source](<../../../apps/web/src/app/gallery/emails/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |
| `/gallery` | [page source](<../../../apps/web/src/app/gallery/page.tsx>) | [Current/inherited row and state evidence](E14-ROUTE-REGISTER.md); external acceptance PENDING |

## Shared boundary surfaces

Include these in each applicable shell review rather than treating them as extra product destinations.

| Source | Required review |
| --- | --- |
| [admin/not-found.tsx](<../../../apps/web/src/app/admin/not-found.tsx>) | Recovery, accurate status, focus, layout stability and role/privacy behaviour |
| [c/(directory)/loading.tsx](<../../../apps/web/src/app/c/(directory)/loading.tsx>) | Recovery, accurate status, focus, layout stability and role/privacy behaviour |
| [error.tsx](<../../../apps/web/src/app/error.tsx>) | Recovery, accurate status, focus, layout stability and role/privacy behaviour |
| [global-error.tsx](<../../../apps/web/src/app/global-error.tsx>) | Recovery, accurate status, focus, layout stability and role/privacy behaviour |
| [not-found.tsx](<../../../apps/web/src/app/not-found.tsx>) | Recovery, accurate status, focus, layout stability and role/privacy behaviour |
| [seasons/[slug]/money/not-found.tsx](<../../../apps/web/src/app/seasons/[slug]/money/not-found.tsx>) | Recovery, accurate status, focus, layout stability and role/privacy behaviour |

## Screens within route templates

A route count understates the design work. Score setup/pad templates cover delivery, rally, raid, timed and placement, sport variations, legal dialogs, correction history, handover, restart, interrupted play and terminal results. Public match templates cover live, delayed, interrupted, confirmed, disputed and unavailable states. Auction surfaces cover preparation, bidding, pause, SOLD, UNSOLD, reconnect and completion. Money covers authorised view, pending work, exceptions and audited consequences. Review each applicable state without inventing unsupported sport capabilities.

The seven initial screenshot observations in PLAN.md inform priorities. Remaining routes require current captures during Stage 1. Older UX1 findings are historical evidence to recheck, not automatic current defects.

The package notes below are historical scoped summaries. Their earlier remaining local rows are reconciled by the current/inherited E14 row register; external acceptance remains pending.

## E05 scoped engineering review

Primary implementer; design references Home prototype and DESIGN-CONTRACT. Source/action mapping and source-bound build in E05-EVIDENCE.md. `/home`: actual composed duties, role/state priority, review/completion, scope selection, phone/laptop/both themes, keyboard/axe/reflow and Back validated. `/login` and `/onboarding`: phone/email/passkey and scalar/repeated return intent, name/session gates and recovery validated. `/join/[token]`: existing acceptance/switch-account/expired/revoked and untouched onboarding exception validated; team entry flow retained. `/account`, onboarding and token sign-out entry points: destructive confirmation, cancellation, pending/error/retry and exact multitab cleanup validated. This does not claim all account/security, inbox or owner-invitation states complete. Their remaining package coverage stays pending. No indexing/access/canonical/OG broadening; private task and token rules in PUBLICATION-MAP remain. Budgets137PASS; E04 scoring performance provenance retained; actual field/device/human acceptance PENDING.

## E06 scoped engineering review

Primary implementer; design references Home/readiness prototype, DESIGN-CONTRACT and FLOWS. `/orgs`, `/org/[slug]`, venues and `/seasons`: actual creation, venue/ground and formation selection journeys validated; existing effective layout retained. Season readiness/teams/registrations: all three formations, canonical counts/actions, private reads, filters/selection, off-page captain and bulk exclusion, retained drafts/recovery, both themes320/390/1440, keyboard/axe/reflow validated. Scheduling/calendar: generate/publish/conflict/resolve/day/export retained; legacy lineups and match-day exact selection validated. Locked/entitled brief exact-match return validated. E06-EVIDENCE binds source/build and limitations. No publication/index/canonical/OG broadening. Other review/standing/report/tournament/poster states remain scoped to later packages. Budgets137PASS; physical-device/human/manual assistive-technology/field acceptance PENDING.

## E07 scoped review

Primary implementer; DESIGN-CONTRACT and shared task workspace reference. /score/[fixtureId], /setup and /shell rally/raid states have action, visual, recovery and local performance evidence in E07-EVIDENCE.md. Actual Matches/watch returns, all seven rally presets/doubles, canonical participant substitution, raid attribution/mat/FIFO/clocks, all terminal/error/offline states and original eligible second viewers are covered. Phone/laptop/both themes, long names, axe0, keyboard and unchanged budgets pass. Publication and permission boundaries remain unchanged. Timed/placement and remaining scoring entry routes remain pending their scoped packages; external human/device/manual-AT/field acceptance remains PENDING.

## E08 scoped review

Primary implementer; DESIGN-CONTRACT, timed/placement prototypes and shared task workspace. /score/[fixtureId], /setup and /shell timed/placement states have action, visual, recovery and matched local performance evidence in E08-EVIDENCE.md. Football/basketball/hockey and complete lobby/four-squad journeys preserve rules, all roster zeroes, cards/substitution/shootout, clocks, corrections and exact terminal results. Long-name320/390/1440/both-theme/keyboard/axe/reflow, invalid entry/draft disclosure, refusal/offline/cold/held/accepted/storage, named returns and original eligible second viewers pass. No permission/publication/index/canonical/OG broadening. E08 engineering BUILD-PASS; external human/device/manual-AT/field acceptance PENDING. Remaining entry/public/report states keep their later scoped gates.
