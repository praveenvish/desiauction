# Interface design contract

E01 specification · Local implementation authorised · Human acceptance pending

## Current baseline and ownership

Current application baseline is `55c97aef78873172793d8a22a6e69d00af93314d`. `BASELINE.json` preserves all 141 entry sources and their local TS/TSX import, lazy-load, re-export and ancestor-shell control/form closure with source hashes. The compiled baseline maps 137 production routes, all within their existing budgets. The primary implementer owns each inventory row; no visual or runtime acceptance is inferred from static extraction. Existing C56 source-matched screenshots and regression logs remain baseline evidence, not freshly executed checks.

The current token JSON and generated styles are the visual authority. RN1's delivered navigation and current `nav.ts` are the navigation baseline; older contradictory prose is historical. This contract refines appearance and presentation, not grants, match rules, event history or money decisions.

## Visual rules

Use existing Daylight/Floodlight semantic tokens. Gold fill with its on-accent ink marks the main action group; gold text uses accent-ink/text-accent, and selection lines use accent-line. Do not use bright fill gold as text on Daylight. Neutral secondary actions retain clear borders and labels. Danger indicates a consequential destructive/system action, not a rejected person's dignity.

Use current self-hosted display/text/mono fonts and existing type/spacing/radius scales. Operational body text uses the readable text face; match score and current bid use tabular display numerals; identifiers use mono only when meaningful. Labels persist outside inputs. Existing primary buttons keep their restrained material depth; improve hierarchy and layout instead of adding competing glows.

The layout patterns are task context, situation, work area and supporting evidence. Phone scoring prioritises the situation and routine action group without an obstructing nav bar. Laptop scoring uses a main workspace and supporting recent history, with no stretching of narrow forms. Console tables stay dense with readable rows; marketing retains its own narrative layout. Do not apply one global max-width or card treatment to all 141 entries.

Native controls and existing UI primitives remain authoritative. Touch actions target at least44px; 320px reflow, zoom and keyboard/safe areas are acceptance checks, not assumptions. Sticky actions may not cover focused content. Reduced motion preserves safety hold timing, readable status and all information. View changes acknowledge immediately; cosmetic motion must not delay scoring or bids.

## Shared pattern scope

| Pattern | Existing basis | Planned usages |
| --- | --- | --- |
| Task context header | PageTitle/PageHeader, labelled Back links and scoring header | Home/readiness, fixture/pad, case/detail |
| Honest state strip | Existing scoring queue, connection and claim state | Private pads, public fresh/delayed state, operational save/recovery |
| Action group | Button/ButtonLink and canonical legal actions | Runs/rally, timed/raid event actions, scoped next step |
| Compact participant row | Existing TeamShield/PlayerImage/Field | Timed roster, raid on-mat selection, lobby kill attribution |
| Responsive data row | Existing tables, Pager and filters | Lobby results, registrations, awards, finance |
| Accessible explanation | EmptyState/Notice, local errors and dialogs | No eligible facts, waiting approval, denied/expired or pending task |

New reusable components require actual multiple usages; local view adapters may remain local. No second UI library, new font request or WebGL bundle is required. No token is added unless an existing token cannot serve and the documented multi-use rule is met.

## Task and role integration

E05 introduces an authorised Home task projection and pure stable recommendation selector, keeping canonical family next-actions separate. Exact reader mapping uses `rolesOf`/all conducting and owned scopes, `scoringHomeForPerson`/scoped setup and claim readers, `myRegistrations`, organiser `homeDashboard`/readiness, and current lineup/`confirmationContext` readers. Finance reuses current `settlementOrgIds`, `finopsOrgIds`, `seasonStandings` and `myDocuments` access paths; platform projection uses held capabilities and permitted existing readers. Avoid repeating the current first-unfinished/currentTeam/latestEntry-null selection defects.

Scorer/manager/finance/operator Home sections are explicit presentation work; `roles.scores` alone does not distinguish their permissions. Sole-role and combination checks bind the CONTRACTS matrix. The person deliberately opening a task keeps it; generic Home recommendations select factual urgency using all eligible scopes, stable identities and actual due times where present. Simultaneous live work stays visible. No new grant or hidden role mode.

Menus, route headings and next actions use the same object identity and terms. Keep the current desktop rail and at-most-five phone model; utilities remain distinct. Exact team/fixture links select that object; ambiguous generic doors request a scope. Existing URL, payload, publication and return contracts remain. Navigation stays client-light and does not query broad private data merely to decorate a badge.

## Retention publication and translation

The CONTRACTS retention table is binding. Normal route exits retain supported actor-bound queue data; explicit logout and actor switch retain the actual `ls1:` purge. Protect against stale writers, misleading sign-out, duplicate submissions and cross-fixture data. Do not add a draft promise or overwrite accepted state.

Route publication uses the existing SEO allowlist and inherited/page metadata plus actual page/read-model gates. Every changed route records its precise public/token/session eligibility, index/canonical/OG/parent/share policy. Shared UI never broadens publication. Match-date minors, current privacy/trust/delay and revision/void rules survive every representation.

Use the existing English/Hindi availability for scoring. Record new shared labels and their Hindi translations, with explicit English fallback outside translated coverage; do not imply that all existing content is translated. Preserve Western numerals. Test label expansion, contrast and screen-reader naming before closing engineering coverage.

## Measurement and rollback specification

Keep current route and60,000-byte scoring-family overhead budgets unchanged. The current baseline budget check covers137 routes; interactive prototypes have their own lightweight assets and do not modify the product graph. Before a production layout is changed, compare relevant current and candidate journeys under the same build/device/network/data conditions, recording repeated samples rather than a single score.

For noncritical pilot metrics, use these conservative stop criteria to begin: any route/family budget breach; a reproduced >10% deterioration in p95 critical interaction latency across at least three matched runs; CLS above0.1 on a previously passing task view; or an increased repeated-update error/timeout rate above its baseline. Keep original required accepted-to-viewer limits and publication eligibility. Resolve variance or measurement failure before advancement; do not average a critical failure away. Field percentile goals remain separate pending real-user data.

E03 specifies a minimal server-controlled treatment selection only where needed, without domain/schema changes. A versioned build/asset manifest and cohort assignment are the rollback unit. Stable active presentation cannot freeze permission/privacy revocations. E04 demonstrates compatible old/new assets and retained queue/bootstrap during local rollback; E09 repeats during auction work. A mechanism that cannot preserve ownership, acknowledgements and pending work blocks the affected pilot.

## E02 design review tasks

Six interactive representative designs cover Home/readiness, delivery pad, timed pad, placement entry, public match and owner auction room. Each has phone/laptop and both themes; previous/next/return states; legal main action and secondary consequence; pending/rejected/empty or waiting states where applicable. Mark all data and outcomes as examples; prototypes never call real write APIs.

Agent browser walkthroughs, contrast/keyboard checks and design-contract review are engineering evidence only. Prepare six-to-eight-participant formative tasks, counterbalanced baseline/prototype order and per-role result templates. Genuine participant and physical-device results remain acceptance pending. No critical usability/safety finding may be hidden behind that pending status.

## Concrete matrices and reproducible observations

[TASK-MAP.md](TASK-MAP.md) binds exact readers, payloads, scopes, completion predicates and destinations. [PUBLICATION-MAP.md](PUBLICATION-MAP.md) binds every entry to its publication class, inherited rule and exceptions. These are source contracts; runtime proof remains required in the corresponding ordered package.

Before each performance comparison, write a measurement row: event (pointer activation to next painted authoritative/pending response, separately request acceptance to viewer paint); build IDs; route/data state; browser version; viewport; CPU/network settings; cold or warm cache; number of events and matched runs; observation window; failures/timeouts including denominator. Start with three matched runs of at least100 repeatable interactions per critical task, with the same20-minute update window for baseline/candidate. Report per-run p50/p95 and variation; do not pool unmatched conditions or claim field INP. Any materially altered sample/event definition requires a fresh matched baseline. Critical correctness/publication failures block regardless of percentile. Record external physical-device evidence separately.
