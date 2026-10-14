# DesiAuction interface refinement plan

Final plan verified by Astra · 11 October 2026 · Baseline `55c97aef7887` · Implementation authorised; execution in progress

DesiAuction should feel like a precise sports operations product: calm while organising, fast while scoring or bidding, and expressive when watching or celebrating. Improve the whole platform around those three contexts. Preserve the accepted business rules, permissions, scoring history and financial safeguards. The user has authorised local implementation after Astra verification. The execution contract distinguishes engineering completion from genuine human, device and release acceptance.

The strongest opportunity is better hierarchy and interaction design. Use the existing brand, typography and Daylight/Floodlight system, make the next action unmistakable, and let screens adapt to their task and device. Decorative depth should support comprehension without delaying entry into a live match.

[FLOWS.md](FLOWS.md) is the detailed role, menu and journey specification. It defines next-action priority, multi-role and multi-team behaviour, first use, success transitions, Back/Close/Exit, preserved state and interruption recovery. Review it together with this plan and the screen inventory; journey continuity is a required acceptance gate for every screen treatment.

[CONTRACTS.md](CONTRACTS.md) binds role/task projections, destructive sign-out boundaries, inherited safety, route publication and research coverage. [EXECUTION.md](EXECUTION.md) gives the ordered E00–E14 work packages, evidence and verification gates. [REVIEW.md](REVIEW.md) records Astra's review and the resulting amendments. These are one coordinated plan; approval of a document does not establish implementation or field results.

## Baseline and evidence

The completed LS1 baseline has 137 production build routes and passing local functional gates. Source discovery finds 141 `page.tsx` entries, including parallel action slots and development surfaces; that is not 141 independent user journeys. [SCREEN-INVENTORY.md](SCREEN-INVENTORY.md) maps every entry into the redesign scope and includes shared error surfaces.

This initial review combines current route and shell source, token definitions, prior design documents and seven final LS1 screenshots: cricket scoring, football scoring on laptop, rally scoring, raid scoring, lobby scoring, player insights on laptop and awards on phone. Screen-specific findings below apply to those captured states. The rest of the platform has a proposed review scope, not a completed visual or usability audit. Full route/state review is the first delivery stage.

| Observed screen | Opportunity | Proposed treatment |
| --- | --- | --- |
| Cricket scoring on phone | Large run controls and restrained secondary actions already support fast entry | Preserve that speed; strengthen player identity, legal-choice sheets, correction context and persistent sync status |
| Football scoring on laptop | A narrow vertical form leaves much of the screen unused; goal, clock and disciplinary controls compete | Score and clock header, event workspace, separate recent-event panel; distinguish routine events from match controls |
| Raid scoring on phone | Long checkbox lists separate the raider, defenders and commit action | Compact selectable player rows, clear on-mat summary, outcome preview and reachable commit control |
| Lobby scoring on phone | Two squads with eleven player fields each produce a roughly 2,775px capture; save, undo and stop have similar emphasis | Squad sections with compact labelled rows and totals, completion summary and one primary save; keep every roster entry and zero |
| Rally scoring on phone | Two large scoring targets work well; server identity is mainly conveyed by text | Preserve bilateral scoring; add a compact serve/ends indicator with redundant text and explicit game context |
| Insights on laptop | Large field diagrams persist even when dismissal data is absent; small-sample caveats sit apart from interpretation | Lead with a question, show sample size beside every conclusion, replace empty diagrams with explanations and keep accessible data tables |
| Awards on phone | Many cards and a long leaderboard produce a roughly 5,468px capture | Featured awards, compact remaining awards and a focused leaderboard with metric controls; keep every row accessible |

Two governance differences need explicit reconciliation: the original `05-design-language.md` limits gold to ceremonies, whereas current theme tokens deliberately use gold for everyday interaction; older PX navigation rules also differ from the later RN1 role-based shell. Keep current production behaviour as the baseline. Record accepted visual changes in one current design contract rather than silently reviving older rules.

## Audience and adoption strategy

Prioritise the organiser who already has squads and an auction season. The core journey is registration → squads → fixtures → live match → confirmation → results and awards. Make that continuity visible instead of making the organiser rediscover a different product at each step.

| Audience | Primary need | Success signal |
| --- | --- | --- |
| Organiser | Know what needs attention and prepare match day | Finds the next blocking task and reaches it without assistance |
| Scorer or official | Record accurately under time and connectivity pressure | Fast correct entries; understands whether work is accepted or pending |
| Team owner | Know the player, next bid and purse consequence | Correct bid and confirmation without amount ambiguity |
| Player or captain | Register, find team and understand performance | Completes entry and finds their own relevant match or stats |
| Spectator | Understand who is winning and what changed | Reads the situation quickly and shares a useful public link |
| Finance or platform staff | Resolve exceptions safely | Finds evidence and completes an authorised action with its audit trail |

Use competitors as references for jobs, not templates. CricHeroes publicly emphasises live scores, scorecards, tournaments and player discovery; those are relevant expectations for sports users. DesiAuction's proposed differentiator is the continuity from auction through match day. Linear's public product framing provides a useful model for organising work around a lifecycle. Neither website establishes that copying its interface will improve our conversion. Sources: [CricHeroes](https://cricheroes.com/) and [Linear features](https://linear.app/features).

## Design direction

Keep the recognisable gold and ink identity, self-hosted type and two themes. Use a quieter operational surface, clear typography and restrained borders; reserve the largest numerals and most expressive composition for live scores, bids and results. Define semantic usage for primary action, selection, link, warning and ceremony so gold does not make every control equally important.

1. **One task hierarchy.** Give each workspace one dominant next action or one coherent scoring action group. Bilateral rally controls and cricket run keys remain equally reachable within that group. Undo, interrupt, restart and finalise occupy a separate secondary or consequence area.
2. **Purposeful density.** Forms remain readable; scoring and operations use available laptop space. Prefer structured rows over a card around every value. Use whitespace between tasks, not between every field in a roster.
3. **Stable identity and context.** Keep season, fixture, sport, teams, phase and viewer role clear. Truncate long names only with an accessible way to read them. Selected team must be unmistakable before an attributed event.
4. **Truth beside the action.** Distinguish accepted, saving, stored on device, offline, rejected and no longer holding the scoring claim. Keep stale public data labelled. Status cannot depend on colour or disappear inside a toast.
5. **Progressive disclosure with continuity.** Reveal infrequent choices in sheets or expandable sections. Preserve entered values, expose validation errors and never hide an incomplete required task behind a completed-looking summary.
6. **Designed empty states.** Say whether data is missing, unavailable, filtered, delayed, private or not yet eligible. Provide a relevant next action only when the viewer can take it.

### Visual depth and 3D

Treat the request for 3D as a desire for clear depth and a premium presentation. Use layered surfaces, crisp SVG fields/courts, perspective in promotional illustrations and restrained result ceremonies. Keep operational controls flat, stable and easy to hit. Field graphics must have textual labels and a tabular equivalent.

If actual interactive 3D is desired, prototype one optional marketing or broadcast experience after the main design direction is approved. Load it only after explicit interaction, isolate its dependency, provide a static fallback and respect reduced motion. It must demonstrate better comprehension or engagement and meet the same performance budget. No 3D dependency belongs in the scoring or bidding critical path by default.

## Screen treatments

The inventory assigns every page entry to one of these treatments. Existing URLs and capability gates stay intact; navigation labels change only after a reviewed terminology decision.

| Group | Proposed screen changes | Important acceptance journey |
| --- | --- | --- |
| G01 Public acquisition | Explain the product quickly with real screen evidence, one primary start action and a secondary demo path; organise feature/sport/audience pages around specific jobs; simplify pricing comparison without inventing availability | Visitor understands the offering, chooses an appropriate path and retains intent through sign-in |
| G02 Identity and invitations | Clear purpose before OTP/passkey; persistent labels, recoverable errors, expiry and resend states; invitation names organisation and role; retain redirect intent | New and returning users, expired invite and interrupted authentication recover without losing context |
| G03 Personal workspace | Keep RN1 role composition; next task first, live obligations visible, remaining sections compact; inbox grouped by actionable status; profile and personal insights separate identity from performance | A person with multiple roles finds both responsibilities without receiving unrelated access |
| G04 Organisation and season operations | Stable context header, phase/readiness summary, compact task list; registrations and teams use search/filter/bulk tools; clear selected-count and consequence preview | Organiser resolves readiness, approves entries and prepares squads without losing selection or filters |
| G05 Fixtures and match day | Today/next match prominent; calendar and list share state; lineup completeness and assigned official visible; concise match brief and poster preview | Official finds the right fixture and moves from brief to scoring setup |
| G06 Scoring | Shared status/context scaffold with family-specific fast controls; phone thumb area and laptop workspace; history/correction drawer; explicit safe end-of-period and match controls | Complete, correct, hand over and recover a match across all five families |
| G07 Public competition and match | Situation first, readable live/scorecard/squad navigation, useful recent activity, fresh/delayed status, restrained sharing; reduce full marketing chrome during match viewing | Anonymous viewer opens a shared link and understands live or terminal state immediately |
| G08 Profiles insights and awards | Identity and sample size first; explain metric denominators, unknowns and eligibility; readable charts with tables; focused metric leaderboard, clear computed/override provenance | Player interprets a small sample correctly and organiser can inspect an award reason |
| G09 Auction | Player and current amount dominate; owner sees exact next bid and remaining purse consequence; cockpit groups conduct/readiness/history; stage, overlay and replay optimise for their viewing distance | Bid, outbid, conduct, audited correction and reconnect retain all safeguards |
| G10 Money | Amount due, payment state and next allowed task first; obligations table then receipts/evidence; preserve exact amounts and server reasons; distinguish controller actions | Owner finds a receipt; officer resolves a case; controller confirms a consequential operation |
| G11 Help content and tools | Searchable help and useful related steps; examples tied to real product terms; tools show inputs, assumptions and outputs; clear validation and empty results | User answers a task question or completes a tool without contacting support |
| G12 Administration | Dense, filterable lists; visible tenant/actor scope; details and audit context before actions; consistent status/retry/error patterns | Staff investigates an exception without crossing scope or losing evidence |
| G13 Broadcast and embeds | Fixed geometry, legible at distance, clean sponsor boundaries, stable reserved slots; no interactive chrome inside an overlay | Public board/OBS output remains readable during reconnect and long names |
| G14 System and development | Consistent loading, forbidden, unavailable, expiry and 404 treatment; accessible recovery; development galleries cover component states and stay correctly gated | Error and reduced-motion users can recover; dev surfaces remain gated |

### Scoring layouts

On phones, use a compact sticky context/status area, the current situation, active participants and a reachable scoring action zone. History and rare controls remain one deliberate action away. Sticky elements account for keyboard, safe areas and focus scrolling. On laptops, use the main scoring workspace beside recent events and match context; avoid stretching fields across the whole display.

| Family | Main interaction | Detail that must survive refinement |
| --- | --- | --- |
| Delivery | Runs grid, extras selection, legal wicket sheet | Quotas, strike, retirement, corrections, targets, super overs, shot zones and bowler/style rules |
| Rally | Two side controls and clear serving/game state | Serve/ends, deuce/caps, rubber/set structure, side-out rules and volleyball substitutions |
| Raid | Raider and compact on-mat roster selection, outcome preview | Primary/assist attribution, FIFO revivals, bonus eligibility, all-out/super-tackle and canonical clock |
| Timed | Team-aware event palette with player attribution and separate clock controls | Active/bench eligibility, sport-specific periods, fouls/cards/substitutions and existing shootout rules |
| Placement | Squad rows, placement and individual kills, per-squad total and round review | All scheduled squads, every actual playing roster member including zeroes, per-round limits and shared ranks |

Never fabricate a sport capability to make a screen feel complete. Unsupported awards, untracked events and unknown historical data remain honestly unavailable. A compact squad section may collapse visually, but validation must expand the relevant error and save must still include all required entries. Repeated team-side controls must show who receives the event.

## Components and engineering boundaries

Extend `@desiauction/ui`; use semantic tokens and existing primitives. Consolidate patterns for a context header, sync status, action group, selected player row, responsive data row, filter bar, empty-data explanation and audited confirmation. Add a component only when real screen uses justify it. Do not replace the shell or install a second visual framework.

Keep orchestration in page/view components and business rules in current typed domain/server modules. Reuse canonical next actions and capability checks; CSS cannot become a rule engine. Preserve native form semantics, labelled buttons and links, server-rendered public information, and tested mutation acknowledgement classes. No business-rule/schema rewrite is part of UI refinement.

Protect immutable scoring history, idempotency, pending queue retention, claim ownership, guest identity, financial confirmations, tenant boundaries, minors' privacy and publication delay. Visual undo must use the existing audited correction path. Never render a successful save before the accepted acknowledgement. No appearance experiment on a live safety mechanism without explicit protocol review.

## Accessibility performance and search

Target WCAG 2.2 AA with manual keyboard and screen-reader journeys as well as automated checks. Use 44×44 CSS px as the product target for main touch controls; WCAG's AA minimum target criterion is 24×24 subject to its exceptions. Keep visible focus, non-colour status, correct tab order and unclipped labels. Verify sticky controls do not obscure focus, 200% zoom and 320px reflow, long names, English/Hindi, Western numerals, reduced motion and both themes. Sources: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum).

Retain every current route budget in `bundle-budget.json` and the existing family overhead ceiling of 60,000 gzip bytes. Prefer server rendering, small client islands, existing fonts/icons, dimensioned images and deferred below-fold content. Charts and optional demonstrations must not enlarge the scorer's shared dependency graph. Do not increase budgets merely to accommodate polish.

Use real-user targets of LCP ≤2.5s, INP ≤200ms and CLS ≤0.1 at the 75th percentile, segmented by device and screen family. Before release, compare repeated cold/warm lab journeys against the baseline on the same devices, network and dataset, including a modest Android phone and live updates. Laboratory results do not establish field compliance; instrument consent-appropriate real-user measurement. Source: [Google Web Vitals](https://web.dev/articles/vitals).

Preserve the existing public score delay and the required accepted-delivery-to-viewer limit under the original applicable test conditions. Compare polling traffic, render work and memory across repeated events; avoid remounting the whole workspace for each update. Correctness and loading stability outrank animated transitions.

Keep crawlable public pages with useful server-rendered headings, canonical URLs, accurate titles/descriptions, internal links, dimensioned imagery and supported truthful structured data. Keep private, token-only, minor-restricted, development and operational surfaces appropriately excluded; never insert sensitive data into metadata, OG images or JSON-LD. Preserve sitemap/robots tests and verify direct-load/refresh states. `noindex` is not access control, and a robots block can prevent a crawler from reading a `noindex` directive. Sources: [Google SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) and [blocking indexing](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

## Future agent access

Make the product understandable through semantic HTML today: named actions, explicit form labels, current state, recoverable errors and stable task links. Prefer native elements before custom ARIA widgets, following [W3C APG guidance](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/). These choices help people, assistive technology and browser agents.

Document existing typed action inputs, outputs, prerequisites and reason codes alongside their current authorisation rules. A future agent API should reuse those rules and immutable receipts, with least privilege, idempotency, an audit trail and user confirmation for consequential actions. Treat external content as untrusted. Keep machine interface/versioning work separate from this visual rollout; do not create an unauthorised scoring or money bypass or promise compatibility with an unimplemented agent protocol.

## Validation of adoption and conversion

Begin with six to eight participants across organisers, scorers, owners, players and spectators, including Hindi and mobile users. Compare current screens and prototypes using realistic data and the same task prompts. This is formative usability research, not a statistically powered conversion study. Record completion, time, errors, hesitation and confidence; maintain a prioritised problem list.

Proposed prototype gates: at least 90% unassisted completion across the agreed task attempts, no critical scoring/bidding/scope errors, and no slower routine scoring entry than the current baseline. For prefilled eligible match setup, test the existing under-60-second product goal. These are acceptance targets, not current measured results; refine sample and task definitions before recruitment.

| Hypothesis | Measure | Guardrail |
| --- | --- | --- |
| More direct start intent reduces drop-off | Landing CTA → successful sign-in → first organisation/season, with explicit denominators | Demo access, accurate availability and authentication recovery |
| Readiness tasks improve activation | Existing auction seasons starting their first accepted scored match | No skipped lineup, privacy or confirmation gates |
| Compact scoring improves speed | Time per correct event, error/correction rate and setup completion | Queue honesty, claim ownership and accidental-event rate |
| Clear public results improve the share loop | Share intent and attributable viewer visits → useful onward action | Do not equate a share-button click with a delivered WhatsApp message |
| Clear awards increase comprehension | User correctly explains winner, eligibility and sample limitations | No invented stats or hidden override reasons |

Define experiment events, privacy constraints, a primary metric, minimum detectable effect, sample size and stopping rule before a live CRO experiment. Use sufficient traffic and consistent assignment; retain only changes supported by results. Keep raw names, contacts, share tokens and scoring payloads out of analytics. UI polish alone cannot verify market fit or guarantee conversion uplift.

## Delivery order and approval gates

| Stage | Deliverable | Exit condition |
| --- | --- | --- |
| 1 Baseline and decisions | Complete route/state review, canonical design contract, capability inventory and repeatable performance captures | Every inventory entry has a baseline or an explicitly gated/not-applicable state; design conflicts resolved; all actions accounted for |
| 2 Representative designs | Annotated phone/laptop designs for home/readiness, cricket pad, timed pad, lobby entry, public match and owner auction room; shared component states in both themes; per-role journey maps and success/return transitions from FLOWS.md | Product review of actual designs; mapping from every old action to its proposed location; menus, previous/next screens, exits and safety/error/offline states shown |
| 3 Prototype validation | Interactive prototype of those journeys, research sessions and revised designs | Task targets met; critical findings resolved; no loss of function; implementation specification ready |
| 4 Foundation pilot | Approved token/component refinements and one complete scoring-to-public-view journey | Existing regression gates, visual checks, accessibility and unchanged budgets pass; small real pilot acceptable |
| 5 Critical operations | Remaining scoring families, setup/handover/corrections, auction/owner/cockpit and match-day workflows | Applicable family, manager and auction journeys pass in both themes/devices; no new conditional skips used to hide regressions |
| 6 Whole platform rollout | Profiles/awards, operations, finance, acquisition/content/tools and administration | Financial journeys pass when finance ships; every inventory row signed off against its route/state checklist; SEO/privacy and role checks pass |
| 7 Release and measurement | Controlled release, observed adoption/performance and documented outcomes | No critical regression; measured UX benefit; rollback remains available; follow-up issues have owners |

Keep complete journeys together instead of recolouring dozens of pages first. Stages are review units, not permission to remove functionality. Use the isolated validation database only, preserve active scoring work during transitions and run heavy validation serially. Do not use the default/development database for review fixtures. No PR, push, deployment or merge is included in this planning request.

Scheduling should be estimated after Stage 1 sizes the state inventory and Stage 2 establishes reusable patterns. There is no credible single-hour promise for a whole-platform redesign. The first review should be the six representative screen designs, not a prolonged unseen implementation.

## Definition of completion

Every page entry in the inventory must have an owner, approved treatment and recorded applicable states. Required coverage includes anonymous/authenticated and allowed/denied roles; fresh/stale/offline/reconnecting; loading/empty/error/saving/rejected/success; small/large datasets and long names; mobile/laptop/projector where relevant; both themes and reduced motion.

Completion requires approved visual references, role-specific journey and recovery checks from FLOWS.md, usable keyboard and screen-reader paths, meaningful regression tests for changed interactions, unchanged or improved route budgets, source-of-truth consistency, truthful SEO and metadata, and no missing action or information from the capability inventory. Release evidence must distinguish local tests, field performance and actual user outcomes. No audit can promise that a product has no possible loopholes; acceptance depends on concrete scope and demonstrated checks.

Proceed through E00–E14 under the authorised build/acceptance amendment in EXECUTION.md. Keep genuine user studies, real-device evidence and release decisions separately tracked; do not present the local build as fully user-validated.
