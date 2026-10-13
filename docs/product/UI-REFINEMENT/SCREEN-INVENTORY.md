# DesiAuction screen review inventory

Final planning coverage checklist · 11 October 2026 · Baseline `55c97aef7887` · Screen review pending

Every discovered page entry appears below. Group IDs refer to the treatments in [PLAN.md](PLAN.md). Rows retain pending scope unless evidence below explicitly closes it; this inventory does not claim a completed visual audit or approval. Existing capability gates, redirects and development gating remain part of each review.

The source has **141 page entries**. The prior production build reports **137 routes**; parallel slots, catchalls and special build entries make those counts non-equivalent. Dynamic entries represent templates and must be exercised with realistic fixture/season/role data.

For every row, record: reviewer, baseline capture, all existing actions and information, proposed layout, retained URL/permissions, applicable states, visual reference, keyboard/screen-reader result, performance result and final sign-off. Add the route publication fields from [CONTRACTS.md](CONTRACTS.md): public eligibility, session/token requirement, indexing, canonical/OG policy, public-parent eligibility and permitted sharing. Apply [FLOWS.md](FLOWS.md): record role/menu context, entry route, main task, success/next state, named return, browser Back and interruption recovery. No row is complete solely because a shared component changed.

## Route coverage

### G01 Public acquisition

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/about` | [page source](<../../../apps/web/src/app/about/page.tsx>) | Pending |
| `/careers` | [page source](<../../../apps/web/src/app/careers/page.tsx>) | Pending |
| `/case-studies/[slug]` | [page source](<../../../apps/web/src/app/case-studies/[slug]/page.tsx>) | Pending |
| `/case-studies` | [page source](<../../../apps/web/src/app/case-studies/page.tsx>) | Pending |
| `/compare/[slug]` | [page source](<../../../apps/web/src/app/compare/[slug]/page.tsx>) | Pending |
| `/compare` | [page source](<../../../apps/web/src/app/compare/page.tsx>) | Pending |
| `/contact` | [page source](<../../../apps/web/src/app/contact/page.tsx>) | Pending |
| `/features` | [page source](<../../../apps/web/src/app/features/page.tsx>) | E12 local BUILD-PASS; state/function/64-theme-width/metrics: [evidence](E12-EVIDENCE.md); external acceptance pending |
| `/for/[slug]` | [page source](<../../../apps/web/src/app/for/[slug]/page.tsx>) | Pending |
| `/for` | [page source](<../../../apps/web/src/app/for/page.tsx>) | Pending |
| `/founding-25` | [page source](<../../../apps/web/src/app/founding-25/page.tsx>) | E12 local BUILD-PASS; state/function/64-theme-width/metrics: [evidence](E12-EVIDENCE.md); external acceptance pending |
| `/` | [page source](<../../../apps/web/src/app/page.tsx>) | E12 local BUILD-PASS; state/function/64-theme-width/metrics: [evidence](E12-EVIDENCE.md); external acceptance pending |
| `/pricing` | [page source](<../../../apps/web/src/app/pricing/page.tsx>) | Pending |
| `/releases` | [page source](<../../../apps/web/src/app/releases/page.tsx>) | Pending |
| `/schedule-demo/booked` | [page source](<../../../apps/web/src/app/schedule-demo/booked/page.tsx>) | E12 local BUILD-PASS; state/function/64-theme-width/metrics: [evidence](E12-EVIDENCE.md); external acceptance pending |
| `/schedule-demo` | [page source](<../../../apps/web/src/app/schedule-demo/page.tsx>) | E12 local BUILD-PASS; state/function/64-theme-width/metrics: [evidence](E12-EVIDENCE.md); external acceptance pending |
| `/schedule-demo/pick` | [page source](<../../../apps/web/src/app/schedule-demo/pick/page.tsx>) | E12 local BUILD-PASS; state/function/64-theme-width/metrics: [evidence](E12-EVIDENCE.md); external acceptance pending |
| `/security` | [page source](<../../../apps/web/src/app/security/page.tsx>) | Pending |
| `/sports/[slug]` | [page source](<../../../apps/web/src/app/sports/[slug]/page.tsx>) | Pending |
| `/sports` | [page source](<../../../apps/web/src/app/sports/page.tsx>) | Pending |

### G02 Identity and invitations

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/demo/[token]` | [page source](<../../../apps/web/src/app/demo/[token]/page.tsx>) | Pending |
| `/email/unsubscribe` | [page source](<../../../apps/web/src/app/email/unsubscribe/page.tsx>) | Pending |
| `/join/[token]` | [page source](<../../../apps/web/src/app/join/[token]/page.tsx>) | Pending |
| `/login` | [page source](<../../../apps/web/src/app/login/page.tsx>) | Pending |
| `/newsletter/unsubscribe` | [page source](<../../../apps/web/src/app/newsletter/unsubscribe/page.tsx>) | Pending |
| `/onboarding` | [page source](<../../../apps/web/src/app/onboarding/page.tsx>) | Pending |
| `/owner-join/[token]` | [page source](<../../../apps/web/src/app/owner-join/[token]/page.tsx>) | Pending |

### G03 Personal workspace

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/@action/home` | [page source](<../../../apps/web/src/app/@action/home/page.tsx>) | Parallel action slot |
| `/account` | [page source](<../../../apps/web/src/app/account/page.tsx>) | Pending |
| `/home` | [page source](<../../../apps/web/src/app/home/page.tsx>) | Pending |
| `/inbox` | [page source](<../../../apps/web/src/app/inbox/page.tsx>) | Pending |

### G04 Organisation and season operations

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/@action/orgs` | [page source](<../../../apps/web/src/app/@action/orgs/page.tsx>) | Parallel action slot |
| `/reports` | [page source](<../../../apps/web/src/app/reports/page.tsx>) | Pending |
| `/players` | [page source](<../../../apps/web/src/app/players/page.tsx>) | Pending |
| `/@action/seasons/[slug]/teams` | [page source](<../../../apps/web/src/app/@action/seasons/[slug]/teams/page.tsx>) | Parallel action slot |
| `/@action/tournaments` | [page source](<../../../apps/web/src/app/@action/tournaments/page.tsx>) | Parallel action slot |
| `/org/[slug]` | [page source](<../../../apps/web/src/app/org/[slug]/page.tsx>) | Pending |
| `/org/[slug]/t/[tournament]` | [page source](<../../../apps/web/src/app/org/[slug]/t/[tournament]/page.tsx>) | Pending |
| `/org/[slug]/venues` | [page source](<../../../apps/web/src/app/org/[slug]/venues/page.tsx>) | Pending |
| `/orgs` | [page source](<../../../apps/web/src/app/orgs/page.tsx>) | Pending |
| `/seasons/[slug]` | [page source](<../../../apps/web/src/app/seasons/[slug]/page.tsx>) | Pending |
| `/seasons/[slug]/readiness` | [page source](<../../../apps/web/src/app/seasons/[slug]/readiness/page.tsx>) | Pending |
| `/seasons/[slug]/register` | [page source](<../../../apps/web/src/app/seasons/[slug]/register/page.tsx>) | Pending |
| `/seasons/[slug]/registrations` | [page source](<../../../apps/web/src/app/seasons/[slug]/registrations/page.tsx>) | Pending |
| `/seasons/[slug]/reviews` | [page source](<../../../apps/web/src/app/seasons/[slug]/reviews/page.tsx>) | Pending |
| `/seasons/[slug]/standings` | [page source](<../../../apps/web/src/app/seasons/[slug]/standings/page.tsx>) | Pending |
| `/seasons/[slug]/teams` | [page source](<../../../apps/web/src/app/seasons/[slug]/teams/page.tsx>) | Pending |
| `/seasons` | [page source](<../../../apps/web/src/app/seasons/page.tsx>) | Pending |
| `/tournaments/[slug]` | [page source](<../../../apps/web/src/app/tournaments/[slug]/page.tsx>) | Pending |
| `/tournaments` | [page source](<../../../apps/web/src/app/tournaments/page.tsx>) | Pending |

### G05 Fixtures and match day

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/seasons/[slug]/brief/[fixtureId]` | [page source](<../../../apps/web/src/app/seasons/[slug]/brief/[fixtureId]/page.tsx>) | Pending |
| `/seasons/[slug]/fixtures/calendar` | [page source](<../../../apps/web/src/app/seasons/[slug]/fixtures/calendar/page.tsx>) | Pending |
| `/seasons/[slug]/fixtures/match-day` | [page source](<../../../apps/web/src/app/seasons/[slug]/fixtures/match-day/page.tsx>) | Pending |
| `/seasons/[slug]/fixtures` | [page source](<../../../apps/web/src/app/seasons/[slug]/fixtures/page.tsx>) | Pending |
| `/seasons/[slug]/fixtures/today` | [page source](<../../../apps/web/src/app/seasons/[slug]/fixtures/today/page.tsx>) | Pending |
| `/seasons/[slug]/lineups` | [page source](<../../../apps/web/src/app/seasons/[slug]/lineups/page.tsx>) | Pending |
| `/seasons/[slug]/posters` | [page source](<../../../apps/web/src/app/seasons/[slug]/posters/page.tsx>) | Pending |

### G06 Scoring

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/match/confirm/[token]` | [page source](<../../../apps/web/src/app/match/confirm/[token]/page.tsx>) | Pending |
| `/score/[fixtureId]` | [page source](<../../../apps/web/src/app/score/[fixtureId]/page.tsx>) | [E04 scoped engineering evidence](E04-EVIDENCE.md); remaining family/state review pending |
| `/score/[fixtureId]/setup` | [page source](<../../../apps/web/src/app/score/[fixtureId]/setup/page.tsx>) | [E04 scoped engineering evidence](E04-EVIDENCE.md); remaining family/state review pending |
| `/score/handover/[token]` | [page source](<../../../apps/web/src/app/score/handover/[token]/page.tsx>) | Pending |
| `/score/new` | [page source](<../../../apps/web/src/app/score/new/page.tsx>) | Pending |
| `/score` | [page source](<../../../apps/web/src/app/score/page.tsx>) | Pending |
| `/score/shell` | [page source](<../../../apps/web/src/app/score/shell/page.tsx>) | [E04 scoped engineering evidence](E04-EVIDENCE.md); remaining family/state review pending |

### G07 Public competition and match

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/c` | [page source](<../../../apps/web/src/app/c/(directory)/page.tsx>) | Pending |
| `/m/[shareToken]` | [page source](<../../../apps/web/src/app/m/[shareToken]/page.tsx>) | Pending |
| `/c/[slug]/m/[fixtureNumber]` | [page source](<../../../apps/web/src/app/c/[slug]/m/[fixtureNumber]/page.tsx>) | [E04 scoped engineering evidence](E04-EVIDENCE.md); remaining family/state review pending |
| `/c/[slug]` | [page source](<../../../apps/web/src/app/c/[slug]/page.tsx>) | Pending |
| `/c/[slug]/t/[team]` | [page source](<../../../apps/web/src/app/c/[slug]/t/[team]/page.tsx>) | Pending |

### G08 Profiles insights and awards

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/c/[slug]/p/[number]/insights` | [page source](<../../../apps/web/src/app/c/[slug]/p/[number]/insights/page.tsx>) | Pending |
| `/c/[slug]/p/[number]` | [page source](<../../../apps/web/src/app/c/[slug]/p/[number]/page.tsx>) | Pending |
| `/me/[sport]` | [page source](<../../../apps/web/src/app/me/[sport]/page.tsx>) | Pending |
| `/me/insights` | [page source](<../../../apps/web/src/app/me/insights/page.tsx>) | Pending |
| `/me` | [page source](<../../../apps/web/src/app/me/page.tsx>) | Pending |
| `/seasons/[slug]/awards` | [page source](<../../../apps/web/src/app/seasons/[slug]/awards/page.tsx>) | Pending |

### G09 Auction

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/auctions` | [page source](<../../../apps/web/src/app/auctions/page.tsx>) | Pending |
| `/seasons/[slug]/auction/cockpit` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/cockpit/page.tsx>) | Pending |
| `/seasons/[slug]/auction/engine` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/engine/page.tsx>) | Pending |
| `/seasons/[slug]/auction/ledger` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/ledger/page.tsx>) | Pending |
| `/seasons/[slug]/auction/live` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/live/page.tsx>) | Pending |
| `/seasons/[slug]/auction` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/page.tsx>) | Pending |
| `/seasons/[slug]/auction/plan` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/plan/page.tsx>) | Pending |
| `/seasons/[slug]/auction/replay` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/replay/page.tsx>) | Pending |
| `/seasons/[slug]/auction/spectate` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/spectate/page.tsx>) | Pending |

### G10 Money

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/money` | [page source](<../../../apps/web/src/app/money/page.tsx>) | E11 BUILD-PASS; primary/Astra engineering evidence [E11](E11-EVIDENCE.md); human/device acceptance pending |
| `/org/[slug]/money/deliveries` | [page source](<../../../apps/web/src/app/org/[slug]/money/deliveries/page.tsx>) | E11 BUILD-PASS; primary/Astra engineering evidence [E11](E11-EVIDENCE.md); human/device acceptance pending |
| `/org/[slug]/money/documents/[docId]` | [page source](<../../../apps/web/src/app/org/[slug]/money/documents/[docId]/page.tsx>) | E11 BUILD-PASS; primary/Astra engineering evidence [E11](E11-EVIDENCE.md); human/device acceptance pending |
| `/org/[slug]/money` | [page source](<../../../apps/web/src/app/org/[slug]/money/page.tsx>) | E11 BUILD-PASS; primary/Astra engineering evidence [E11](E11-EVIDENCE.md); human/device acceptance pending |
| `/org/[slug]/money/reconciliation` | [page source](<../../../apps/web/src/app/org/[slug]/money/reconciliation/page.tsx>) | E11 BUILD-PASS; primary/Astra engineering evidence [E11](E11-EVIDENCE.md); human/device acceptance pending |
| `/org/[slug]/settlement` | [page source](<../../../apps/web/src/app/org/[slug]/settlement/page.tsx>) | E11 BUILD-PASS; primary/Astra engineering evidence [E11](E11-EVIDENCE.md); human/device acceptance pending |
| `/seasons/[slug]/money/case/[caseId]` | [page source](<../../../apps/web/src/app/seasons/[slug]/money/case/[caseId]/page.tsx>) | E11 BUILD-PASS; primary/Astra engineering evidence [E11](E11-EVIDENCE.md); human/device acceptance pending |
| `/seasons/[slug]/money` | [page source](<../../../apps/web/src/app/seasons/[slug]/money/page.tsx>) | E11 BUILD-PASS; primary/Astra engineering evidence [E11](E11-EVIDENCE.md); human/device acceptance pending |

### G11 Help content and tools

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/api-docs` | [page source](<../../../apps/web/src/app/api-docs/page.tsx>) | Pending |
| `/review/[token]` | [page source](<../../../apps/web/src/app/review/[token]/page.tsx>) | Pending |
| `/guides/[slug]` | [page source](<../../../apps/web/src/app/guides/[slug]/page.tsx>) | Pending |
| `/guides` | [page source](<../../../apps/web/src/app/guides/page.tsx>) | Pending |
| `/help/[slug]` | [page source](<../../../apps/web/src/app/help/[slug]/page.tsx>) | Pending |
| `/help/category/[slug]` | [page source](<../../../apps/web/src/app/help/category/[slug]/page.tsx>) | Pending |
| `/help` | [page source](<../../../apps/web/src/app/help/page.tsx>) | E12 local BUILD-PASS; state/function/64-theme-width/metrics: [evidence](E12-EVIDENCE.md); external acceptance pending |
| `/legal/[slug]` | [page source](<../../../apps/web/src/app/legal/[slug]/page.tsx>) | Pending |
| `/legal` | [page source](<../../../apps/web/src/app/legal/page.tsx>) | Pending |
| `/rules-guidelines` | [page source](<../../../apps/web/src/app/rules-guidelines/page.tsx>) | Pending |
| `/search` | [page source](<../../../apps/web/src/app/search/page.tsx>) | Pending |
| `/support` | [page source](<../../../apps/web/src/app/support/page.tsx>) | Pending |
| `/tools` | [page source](<../../../apps/web/src/app/tools/page.tsx>) | E12 local BUILD-PASS; state/function/64-theme-width/metrics: [evidence](E12-EVIDENCE.md); external acceptance pending |
| `/tools/purse-calculator` | [page source](<../../../apps/web/src/app/tools/purse-calculator/page.tsx>) | Pending |
| `/tools/registration-form` | [page source](<../../../apps/web/src/app/tools/registration-form/page.tsx>) | Pending |
| `/tools/snake-draft` | [page source](<../../../apps/web/src/app/tools/snake-draft/page.tsx>) | Pending |

### G12 Administration

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/admin/auctions/[auctionId]` | [page source](<../../../apps/web/src/app/admin/auctions/[auctionId]/page.tsx>) | Pending |
| `/admin/audit` | [page source](<../../../apps/web/src/app/admin/audit/page.tsx>) | Pending |
| `/admin/demos/availability` | [page source](<../../../apps/web/src/app/admin/demos/availability/page.tsx>) | Pending |
| `/admin/demos` | [page source](<../../../apps/web/src/app/admin/demos/page.tsx>) | Pending |
| `/admin/erasure` | [page source](<../../../apps/web/src/app/admin/erasure/page.tsx>) | Pending |
| `/admin/health` | [page source](<../../../apps/web/src/app/admin/health/page.tsx>) | Pending |
| `/admin/live` | [page source](<../../../apps/web/src/app/admin/live/page.tsx>) | Pending |
| `/admin/moderation` | [page source](<../../../apps/web/src/app/admin/moderation/page.tsx>) | Pending |
| `/admin/newsletter` | [page source](<../../../apps/web/src/app/admin/newsletter/page.tsx>) | Pending |
| `/admin/notifications/[kind]/email` | [page source](<../../../apps/web/src/app/admin/notifications/[kind]/email/page.tsx>) | Pending |
| `/admin/notifications/analytics` | [page source](<../../../apps/web/src/app/admin/notifications/analytics/page.tsx>) | Pending |
| `/admin/notifications` | [page source](<../../../apps/web/src/app/admin/notifications/page.tsx>) | Pending |
| `/admin/notifications/suppressions` | [page source](<../../../apps/web/src/app/admin/notifications/suppressions/page.tsx>) | Pending |
| `/admin/notifications/templates` | [page source](<../../../apps/web/src/app/admin/notifications/templates/page.tsx>) | Pending |
| `/admin/orgs/[slug]` | [page source](<../../../apps/web/src/app/admin/orgs/[slug]/page.tsx>) | Pending |
| `/admin/orgs` | [page source](<../../../apps/web/src/app/admin/orgs/page.tsx>) | Pending |
| `/admin` | [page source](<../../../apps/web/src/app/admin/page.tsx>) | Pending |
| `/admin/passes` | [page source](<../../../apps/web/src/app/admin/passes/page.tsx>) | Pending |
| `/admin/people/[personId]` | [page source](<../../../apps/web/src/app/admin/people/[personId]/page.tsx>) | Pending |
| `/admin/people` | [page source](<../../../apps/web/src/app/admin/people/page.tsx>) | Pending |
| `/admin/reports` | [page source](<../../../apps/web/src/app/admin/reports/page.tsx>) | Pending |
| `/admin/reviews` | [page source](<../../../apps/web/src/app/admin/reviews/page.tsx>) | Pending |
| `/admin/roles` | [page source](<../../../apps/web/src/app/admin/roles/page.tsx>) | Pending |

### G13 Broadcast and embeds

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/c/[slug]/m/[fixtureNumber]/board` | [page source](<../../../apps/web/src/app/c/[slug]/m/[fixtureNumber]/board/page.tsx>) | Pending |
| `/c/[slug]/m/[fixtureNumber]/overlay` | [page source](<../../../apps/web/src/app/c/[slug]/m/[fixtureNumber]/overlay/page.tsx>) | Pending |
| `/embed/[slug]` | [page source](<../../../apps/web/src/app/embed/[slug]/page.tsx>) | Pending |
| `/seasons/[slug]/auction/board` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/board/page.tsx>) | Pending |
| `/seasons/[slug]/auction/overlay` | [page source](<../../../apps/web/src/app/seasons/[slug]/auction/overlay/page.tsx>) | Pending |

### G14 System and development

| Entry or slot | Source | Review status |
| --- | --- | --- |
| `/@action/[...missing]` | [page source](<../../../apps/web/src/app/@action/[...missing]/page.tsx>) | Parallel action slot |
| `/[...missing]` | [page source](<../../../apps/web/src/app/[...missing]/page.tsx>) | Pending |
| `/dev/inbox` | [page source](<../../../apps/web/src/app/dev/inbox/page.tsx>) | Pending |
| `/gallery/emails` | [page source](<../../../apps/web/src/app/gallery/emails/page.tsx>) | Pending |
| `/gallery` | [page source](<../../../apps/web/src/app/gallery/page.tsx>) | Pending |

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

## E05 scoped engineering review

Primary implementer; design references Home prototype and DESIGN-CONTRACT. Source/action mapping and source-bound build in E05-EVIDENCE.md. `/home`: actual composed duties, role/state priority, review/completion, scope selection, phone/laptop/both themes, keyboard/axe/reflow and Back validated. `/login` and `/onboarding`: phone/email/passkey and scalar/repeated return intent, name/session gates and recovery validated. `/join/[token]`: existing acceptance/switch-account/expired/revoked and untouched onboarding exception validated; team entry flow retained. `/account`, onboarding and token sign-out entry points: destructive confirmation, cancellation, pending/error/retry and exact multitab cleanup validated. This does not claim all account/security, inbox or owner-invitation states complete. Their remaining package coverage stays pending. No indexing/access/canonical/OG broadening; private task and token rules in PUBLICATION-MAP remain. Budgets137PASS; E04 scoring performance provenance retained; actual field/device/human acceptance PENDING.

## E06 scoped engineering review

Primary implementer; design references Home/readiness prototype, DESIGN-CONTRACT and FLOWS. `/orgs`, `/org/[slug]`, venues and `/seasons`: actual creation, venue/ground and formation selection journeys validated; existing effective layout retained. Season readiness/teams/registrations: all three formations, canonical counts/actions, private reads, filters/selection, off-page captain and bulk exclusion, retained drafts/recovery, both themes320/390/1440, keyboard/axe/reflow validated. Scheduling/calendar: generate/publish/conflict/resolve/day/export retained; legacy lineups and match-day exact selection validated. Locked/entitled brief exact-match return validated. E06-EVIDENCE binds source/build and limitations. No publication/index/canonical/OG broadening. Other review/standing/report/tournament/poster states remain scoped to later packages. Budgets137PASS; physical-device/human/manual assistive-technology/field acceptance PENDING.

## E07 scoped review

Primary implementer; DESIGN-CONTRACT and shared task workspace reference. /score/[fixtureId], /setup and /shell rally/raid states have action, visual, recovery and local performance evidence in E07-EVIDENCE.md. Actual Matches/watch returns, all seven rally presets/doubles, canonical participant substitution, raid attribution/mat/FIFO/clocks, all terminal/error/offline states and original eligible second viewers are covered. Phone/laptop/both themes, long names, axe0, keyboard and unchanged budgets pass. Publication and permission boundaries remain unchanged. Timed/placement and remaining scoring entry routes remain pending their scoped packages; external human/device/manual-AT/field acceptance remains PENDING.

## E08 scoped review

Primary implementer; DESIGN-CONTRACT, timed/placement prototypes and shared task workspace. /score/[fixtureId], /setup and /shell timed/placement states have action, visual, recovery and matched local performance evidence in E08-EVIDENCE.md. Football/basketball/hockey and complete lobby/four-squad journeys preserve rules, all roster zeroes, cards/substitution/shootout, clocks, corrections and exact terminal results. Long-name320/390/1440/both-theme/keyboard/axe/reflow, invalid entry/draft disclosure, refusal/offline/cold/held/accepted/storage, named returns and original eligible second viewers pass. No permission/publication/index/canonical/OG broadening. E08 engineering BUILD-PASS; external human/device/manual-AT/field acceptance PENDING. Remaining entry/public/report states keep their later scoped gates.
