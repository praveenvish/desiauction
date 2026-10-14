# DesiAuction roles navigation and task flow

Final planning specification for review · 11 October 2026 · Implementation pending

Every screen must answer four questions: **Where am I? What is happening? What can I do next? How do I return?** Make those answers consistent from sign-in through the last receipt or result. A first-time user should learn the product by completing their own task, with relevant guidance in place rather than a tour of menus.

This specification completes the journey design in [PLAN.md](PLAN.md). It preserves current permissions and URLs, the RN1 union of roles, family-specific scoring rules and the separation between public, console, live and bare surfaces. Proposed routing or interaction changes require implementation validation; they are not claims about current behaviour.

[CONTRACTS.md](CONTRACTS.md) supplies the required source/selection mapping, missing Home responsibility adapters, state-retention rules, inherited safety and route-specific publication policies. Those contracts qualify every recommendation and recovery promise below.

## Current authorities and decisions

Use current source as the baseline: `navigationFor`, `phoneBar`, `seasonRoleFor`, `seasonTabs`, `chooseNextStep`, `homeSections`, `safeNext` and the scoring home/claim readers. Earlier prose contains superseded decisions: the current desktop rail is not capped at five, the phone bar is capped, and the public directory retains its public shell. Refine those real behaviours instead of implementing an obsolete menu diagram.

There is a concrete priority mismatch: `nav.ts` chooses a live conductor door before a live owner door, while `home/next-step.ts` checks the owner first. Its inputs also do not include scoring appointments. The proposed resolution is one shared task recommendation model, evaluated against authorised current state, used by Home and entry-point recommendations. Local scoring actions still come from the canonical family rules. Do not replace permission checks or introduce a hidden role mode.

## Menu structure by role

Use three distinct levels, each answering a different question. The primary rail or phone bar holds personal destinations. The season tabs locate work inside the selected season. The page action performs a task on that scope. Account, notifications, help and platform administration remain utility destinations. A page must not add another competing primary menu.

The desktop rail can show additional authorised destinations; the phone bar contains at most five labelled targets. Both derive from the same model and terminology, although their visible counts differ. Keep the current destination represented on the phone bar. Items displaced by the cap remain reachable through explicit Home sections. Verify access to Money, profile, scoring and every assigned team even for users who hold many roles.

| Person | Personal work destinations | First useful task | Season context |
| --- | --- | --- | --- |
| Newcomer | Home, Find tournaments | Two understandable paths: Run a tournament or Find a tournament to play | No invented season context |
| Player | Home, My profile, Find tournaments | Open their relevant entry, next match or published result | Own entry, published schedule/table and permitted auction information |
| Team owner or manager | Home, My team or My teams; live auction door when applicable | Prepare their plan, enter the room, see their squad or complete an actual manager task | Their own team clearly selected; no rival private purse or registration data |
| Scorer | Home and Score when appointed; retain other held roles | Resume the active authorised fixture, or open the next assigned match | Fixture/sport/teams and scoring ownership, not broad organiser controls |
| Auctioneer | Home, Auction nights and Cockpit during their live duty | Prepare or conduct the selected night | Auction and permitted pool/team information; no unrelated finance |
| Organiser or staff | Home, Tournaments and authorised operational destinations | Resolve the highest-priority readiness or match-day task | Overview, Players, Teams, Schedule, applicable Auction, authorised Money and Reviews |
| Finance holder | Home, authorised Money destination alongside other held roles | Open the due obligation or actionable exception | Exact organisation/case, officer/controller distinction |
| Platform operator | Their personal work plus the authorised admin utility door | Open the first permitted operational section or an actionable incident | Staff capabilities determine offered sections and served payload |
| Public viewer or read-only member | Public navigation, useful competition links and Home for a signed-in visitor | Watch the match, open a scorecard or register when allowed | Published context only; no implication of management rights |

Labels above describe the intended destination vocabulary; they do not grant capabilities. In particular, owning an auction team and managing a match team are not interchangeable permissions. A read-only membership never turns into an organiser menu. A finance or scorer appointment never implies control over the whole season.

### People with several roles or teams

Compose their Home sections; do not ask them to switch between hidden player, owner and organiser modes. Resolve the season workspace using its current scoped role rules. If the person also owns a team in a season they organise, keep organiser access and give a direct own-team shortcut; do not silently demote their season tabs.

For several teams or seasons, a labelled scope picker shows team, season and relevant status. A task link already carrying a team or fixture opens that exact object. A generic destination asks for a choice if several targets are plausible. Do not default silently to the first team before a bid, attributed scoring event, confirmation or payment. Switching scope changes the displayed identity before any consequential action becomes available.

Keep menu target positions stable during an interaction. New live work can appear as a clear notice; do not move a control underneath a pointer or replace the focused action while the user is entering data. Reconcile menu changes at a safe navigation boundary. Role additions use the existing concise explanation; loss of permission must produce an accurate recovery explanation when the user attempts affected work, without disclosing private scope information.

## Choosing the next action

Separate **what is recommended** from **what is possible**. The main recommendation states the task, object, reason and immediate outcome. Other authorised destinations remain available. Do not force the whole platform into one linear wizard or automatically send a user elsewhere because a recommendation changes.

Proposed global priority:

1. Honour the task the person deliberately opened, including a validated sign-in return link. An unrelated live auction must not hijack a direct scoring or receipt link.
2. Show an actionable recovery for that task when it is interrupted: rejected input, lost claim, expired session or unresolved pending work. A queued event is not a completed event and must not trigger the next lifecycle stage.
3. On generic Home, prefer an active live duty: conducting an auction, then an active match held by the scorer, then their live owner room. This retains conductor-before-owner precedence and adds explicit scoring coverage. If several simultaneous duties exist, name all of them and provide a compact choice rather than silently changing scope.
4. Next, surface time-sensitive authorised work due today: assigned fixture setup, required lineup/confirmation, or an actual finance exception. Sort by verified urgency/due time; show overdue status only when there is a real due-time rule.
5. Then show the first actionable lifecycle prerequisite or preparatory task. The person must have authority to complete it.
6. When another person must act, show a calm waiting state with the expected responsible role and a useful status destination. Do not create a fake urgent action.
7. When nothing is pending, show relevant results or a sensible create/find choice. Completion must not look like an empty broken dashboard.

These priorities are a proposed product policy to pin with role/state tests, not new backend deadlines or permission rules. A reminder is not proof that a task is overdue. Active user choice outranks automatic recommendation; the menu and Home agree when they are recommending the same live work.

Every recommendation has a scoped key, factual trigger, eligibility, action label, destination, short explanation and completion condition. Include a successor only when it is a valid next step. Avoid generic “Continue” when a concrete verb is available.

| State | Main wording | Outcome or successor |
| --- | --- | --- |
| Empty organiser workspace | “Create your tournament” within the actual required club context | Show the created object and the next applicable team-formation task |
| Registrations need review | “Review 8 registrations” with the real count | After review, show remaining work or the applicable next preparation stage |
| Match setup incomplete | “Complete setup for Panthers vs Royals” | Enter the pad only after the required setup is accepted |
| Scoring already started | “Resume Panthers vs Royals” | Show the accepted score, ownership and any local queue before new input |
| Registration submitted | “Registration awaiting approval” | “View my entry”; no false instruction to submit again |
| Awaiting required result confirmations | “Waiting for 2 squad confirmations” using the actual remaining count, or the appropriate two-side wording | View the recorded revision and current required confirmation status; placement requires every other participating squad |
| All available work complete | “You’re up to date” in the relevant scope | View results or prepare the next real fixture |

Example copy is illustrative; use actual teams, counts and accepted state. The organiser journey branches by existing team formation: auction, organiser selection or team entry. Do not make a non-auction season pass through an auction step.

## Journeys and success transitions

| Journey | Sequence | Success behaviour |
| --- | --- | --- |
| First organiser | Choose Run → sign in/name if needed → club context → tournament/season → applicable team formation → readiness → fixtures → match day | Each acknowledged creation opens or identifies the actual object; the next task names what remains |
| First player | Open tournament or entry link → eligibility/context → sign in if required → register → submission status → approval/team → match/result | Submitted means waiting; approved and selected are distinct states; preserve the original tournament through authentication |
| Owner | Accept invitation → named team → private plan when auction applies → live room → squad → applicable receipts/results | Invitation confirms the added responsibility; bid acknowledgement updates the room without unnecessary page navigation |
| Scorer | Assigned match or quick-match entry → legal setup → ownership → scoring → terminal result → applicable finalisation/confirmation → public result | After each event remain on the pad, ready for the next legal entry; finalisation never jumps past pending queue or required approvals |
| Auctioneer | Named season → preparation/readiness → cockpit → conduct → audited completion → ledger/replay | Conduct actions stay in place; close-out offers the relevant completed record |
| Manager or captain | Named squad/fixture → required roster/lineup or confirmation → acknowledged state → fixture/team summary | Confirmation and dispute remain distinct; show the actual recorded result rather than a success-only toast |
| Finance | Due item/exception → obligation/case → authorised action → acknowledgement/receipt → case or filtered list | Exact amounts and consequence confirmation survive; no automatic execution of a suggested next action |
| Spectator | Shared link → situation → scorecard/squads → public result → optional share/player page | Watch without a forced signup, retain match identity and distinguish live, delayed and final states |

The stage list is orientation, not an artificial progress bar. Derive done/current/waiting/blocking states from accepted data. Independent tasks can proceed in parallel; surface that honestly instead of inventing a single percentage. Completed stages remain inspectable. If reopening a completed stage is not legal, offer its record and the existing audited correction route.

After a local save, keep the user in context and update the relevant row or panel. After a completed setup task, show a short persistent completion summary and the next legal action. After consequential money/conduct actions, retain the receipt, sequence or audit evidence. Do not automatically advance through a result, receipt or irreversible confirmation before the user has a chance to understand it.

## Back close cancel and exit

Give each surface a deliberate exit. The browser Back button and the page's contextual return serve different purposes: browser Back follows history; “Back to schedule” opens the named parent regardless of entry source. Do not implement all returns using a blind `history.back()`.

| Situation | Expected return |
| --- | --- |
| Details opened from a filtered list | Return to that same authorised list, retaining filter, page and scroll anchor when safe |
| Detail opened directly from email or bookmark | Show a valid named parent; no assumption that browser history belongs to this app |
| Dialog or sheet opened inside a task | Close to the underlying task, restore focus to the opener and preserve allowed draft values |
| Help opened during setup | Clear “Return to match setup” affordance; keep task context and avoid discarding draft inputs |
| Scoring pad exit | Return to the relevant match list/fixture with accurate queue and ownership status; exit does not end the match or hand over automatically |
| Live auction exit | Existing authorised season/public destination with a labelled exit; leaving does not pause or close the auction |
| Sign-in interrupted task | Return to the validated original task after auth/name capture; recheck access and expiry |
| Newly created object | Back goes to its actual parent; it must not resubmit the creation mutation |
| Shared public result | Back to the competition when a public parent is available; private/share-only data does not gain a public parent link |
| Scope change or logout | Clear scope-bound private view state as appropriate; never show one tenant's rows under another tenant's heading |

Use URL state for shareable non-sensitive filters and tabs. Keep private drafts and sensitive scope identifiers out of public URLs and analytics; use the existing permitted storage boundaries. Restoring view state cannot bypass a fresh server permission check.

Protect unsaved edits only when there is actual work at risk. Offer “Stay” and an accurate leave option; provide “Save draft” only for tasks with a real durable draft facility. Accepted mutations cannot be cancelled by navigation. Ordinary navigation retains supported actor-bound pending scoring. Explicit logout and account switch retain the existing privacy purge: unsent `ls1:` events do not survive it. Explain that consequence before a destructive choice; do not promise preservation across sign-out. Follow the full retention and cleanup-failure table in CONTRACTS.md. Browser unload prompts are not guaranteed, particularly on mobile; resilience must come from state preservation rather than a warning dialog alone.

Do not intercept browser Back globally. If a sheet has a tested history entry, Back closes it before changing the parent route; otherwise Close provides the local exit and browser Back retains native navigation. Confirm both cases in prototype and real-browser tests.

## Smooth transitions and interruption handling

Smoothness means no surprise, no lost context and immediate acknowledgement of input. Use shared spacing and stable headers when moving within a workspace. Reserve status and primary-action geometry before hydration. Keep filters and active tabs consistent. Avoid full-screen loading indicators for a local mutation and avoid resetting an unchanged page to its top after an update.

Prefer restrained existing motion for sheets, panels and state confirmation. Any transition must be interruptible, preserve focus and provide a reduced-motion equivalent. Do not add animation delays to scoring or bidding. Do not animate the live score through fabricated intermediate values. Skeletons match the final layout; focus moves to a route's heading after navigation and returns to the opener after a dialog closes. Routine score updates do not steal focus or announce an entire screen repeatedly.

| Interruption | User-visible response | Continuation |
| --- | --- | --- |
| Slow action | Busy state on the same action with retained label/context | Accepted result or actionable error; duplicate submission remains prevented |
| Network lost | Keep last accepted state; identify pending local work and availability of new input | Reconnect and reconcile through the existing queue, without claiming success early |
| Validation rejected | Explain and focus the field or event that needs attention; retain other input | Retry only after correction, with the correct accepted/pending distinction |
| Session expired | Explain sign-in is needed, preserve what existing storage rules allow | Return to the same task after auth and revalidation |
| Scoring claim changed | Show who can act only where permitted; stop unauthorised entry | View state or explicit permitted handover/takeover; never silent ownership acquisition |
| Permissions changed | Accurate unavailable state without private payload | Named safe destination or legitimate request-help path |
| Another actor completed the task | Show the accepted current state and completion | Offer the next relevant action; do not repeat the mutation |
| Token expired or withdrawn | Explain that the link cannot be used without leaking private scope | Existing renewal/contact recovery only; no invented resend facility |
| Device or scope reopened | Restore permitted draft/view state and identify current server state | User reviews conflicts before continuing; local data never overrides authority |

## First use guidance

Make the first meaningful action visible without a tutorial. Pair unfamiliar terms with short task-oriented explanations: what this action does, who performs it and what happens after it. Show a compact contextual checklist only where a real multi-stage setup needs it. Keep help adjacent to complex rules, especially extras, roster eligibility, auction purse consequences and result confirmation.

Use one vocabulary across menu, heading, button, receipt and help. “Players” is the season destination; “Review registrations” is a task inside it. “Schedule” owns fixtures and lineup-related destinations; “Complete lineup” names the action. “My team” always names the selected team. Ambiguous “Table” terminology should be tested with users before a consistent label change; URL changes are unnecessary.

Show a first-use hint once when it explains a specific unfamiliar control. Hints cannot cover the primary action, prevent entry or become a mandatory carousel. Any demonstration uses clearly labelled example data and cannot be confused with a real match. Returning users get their task, not repeated onboarding.

## Acceptance and delivery changes

Add an annotated journey map and a state-transition table to Stage 2 for each role, including first use, return visit, direct link, role combination and interruption. Extend the six representative screen designs to include their menus, previous screen, success state, next screen and every exit; isolated beautiful screenshots are insufficient approval evidence.

| Check | Required evidence |
| --- | --- |
| First useful action | One-tap access from the intended landing surface after required authentication; scope selection is explicit when ambiguous |
| Comprehension | In formative tests, users can explain where they are, what to do next and what the action will change |
| Role coverage | Pure role × scope × state matrix; each permitted responsibility remains discoverable on phone and laptop |
| Consistent priority | Menu/Home recommendations agree for simultaneous conductor, owner and scorer cases; no direct-link hijack |
| Return journey | Browser Back, named parent, dialog Close and task Exit verified from both list entry and external direct entry |
| State retention | Filters/scroll and permissible drafts retained; cross-tenant and logout checks prevent inappropriate restoration |
| Success behaviour | No duplicate mutation, false saved state, unexpected auto-advance or skipped confirmation |
| Wait and interruption | Approval wait, expiry, rejection, offline queue, lost claim and revoked access tested with real applicable states |
| Accessibility | Focus, keyboard, screen reader, reduced motion, safe areas and browser zoom across complete journeys |
| Performance | Stable layout and unchanged budgets; transitions add no delay to critical actions |

For the first-user study, record wrong turns, unnecessary backtracking, help requests and successful recovery as well as task completion and time. Proposed acceptance: at least 90% unassisted completion across agreed attempts, every participant can recover their task, and zero critical money/scoring/privacy errors. A small study cannot prove every future user will be unconfused; unresolved confusion becomes a design issue to fix and retest.

There is no planning blocker requiring a new role system. The principal implementation risks are inconsistent recommendations across entry points and lost state at shell/auth transitions. Both have explicit proposed treatments and must be proved in the pilot before whole-platform rollout.
