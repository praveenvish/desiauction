# Astra review of the interface refinement plan

11 October 2026 · Review record · Amended planning contract approved by Astra

The user requested an independent Astra review before implementation. Astra reviewed PLAN.md, FLOWS.md and SCREEN-INVENTORY.md in full against current navigation, Home, authentication, storage, role source, RN1 and LS1 as-built/evidence. The review was read-only: no database access, test rerun or application edits.

Initial verdict: **conditional approval of the design direction and Stages 1–3**, with seven substantive amendments required before using the documents as an executable implementation contract. It was not implementation approval, a release gate or proof of user conversion/accessibility/performance outcomes.

## Findings and dispositions

| ID | Finding and evidence | Amendment | Status |
| --- | --- | --- | --- |
| A01 | Home lacks scorer/manager/finance/operator composition; `roles.scores` mixes different authority sources. See `home-router.ts`, Home page and `roles.ts` | CONTRACTS responsibility matrix; E01 adapter specification and E05 implementation; sole/combined-role tests including captain without manager authority | Rechecked and closed for planning |
| A02 | Global recommendation source/selection is underspecified. Home uses `currentTeam`, first unfinished conductor scope and `latestEntry: null`; menu independently picks live scopes | CONTRACTS source/completion mapping, all-scope selection, stable ranking, simultaneous obligations and pending-fixture-switch rules; E01/E05 gates | Rechecked and closed for planning |
| A03 | Preserve-work prose could falsely imply unsent scoring survives logout; cleanup deletes `ls1:` and actor changes clear storage | Explicit retention/purge table; amended FLOWS; cleanup failure, multi-tab/stale-writer and account-switch gates | Rechecked and closed for planning |
| A04 | Broad safety principles did not bind specific LS1 invariants | CONTRACTS inherited matrix: match-date minors, current trust/delay across representations, all-squad confirmation, revised/disputed/excluded/void states, loaded-terminal exception and original latency conditions | Rechecked and closed for planning |
| A05 | Token-shared match misclassified as acquisition; publication policy too generic | Inventory moves `/m/[shareToken]` to G07; route publication fields added; also corrects `/review/[token]`, `/players`, `/reports`; explicit token/noindex/redaction contracts | Rechecked and closed for planning |
| A06 | Rollback lacked PWA/queue/live-session mechanics; finance stage gate was misplaced | EXECUTION versioned artifact/cohort owner/kill switch/stable-session/security/PWA compatibility/rollback rehearsal and stop triggers; finance gate moved to its actual wave | Rechecked and closed for planning |
| A07 | Pooled research could hide failed roles; translation/real-device/critical-role acceptance lacked detail | CONTRACTS per-role/task reporting and order counterbalancing, manager/finance/operator reviews, translation/fallback and real-device conditions; E02/E11/E13 gates | Rechecked and closed for planning |

## Execution handover

[EXECUTION.md](EXECUTION.md) defines E00–E14, named responsibilities, package logging, relevant regression suites, full local milestones, isolated validation configuration, failure handling and release boundaries. Astra's follow-up reviewed this execution document and all seven dispositions. The reviewer found no remaining blocking contradiction and approved the amended executable planning contract.

Planning status is separate from execution status. All E00–E14 implementation packages remain pending. Existing C56 test/build results are historical baseline evidence and were not rerun for this document review. Approval of the amended plan cannot close future prototype, local regression, real-device, field-measurement or release gates.

## Final verification verdict

**APPROVE the amended executable planning contract.** Astra confirmed A01–A07 are addressed and rechecked them as closed for planning. Static inspection confirmed the named package scripts, `.next-e2e` budget path, precompiled harness, optional WebKit/Firefox projects and posture configuration. The isolated-database preflight remains a mandatory stop gate. Stable presentation does not freeze permission, trust or privacy revocation.

This approves suitability for execution after a subsequent instruction. It does not authorise implementation or release and does not close E00–E14, prototype, regression, real-device, usability or field-performance gates. No application files were edited, tests rerun or databases accessed during either Astra review.

## Implementation authorisation and gate amendment

On 11 October 2026 the user authorised full implementation. Astra subsequently approved the BUILD-PASS versus external acceptance amendment recorded in EXECUTION.md. No further implementation permission is needed. Engineering gates and critical-defect stops remain binding; real participants, physical devices and field results cannot be fabricated or waived. This supersedes earlier planning-only permission wording without rewriting the historical review verdict.

### E05 focused confirmation projection resolution

Astra approves a read-only Home projection that separates recipient-valid links from exact revision/team obligations. Preserve the existing canonical confirmation linkage (including placement-only active-manager validation), numeric trustOrder and effectiveTrustDecisions. Same-team eligible managers fulfil the team request; other-team responses do not. Accepted response plus unresolved dispute/hold/exclusion is waiting; authorised effective verification resolves; a subsequent dispute reopens. No token-validity/trustLevel/timestamp shortcut and no claim that the current recipient personally confirmed. Keep review links for completed/waiting/resolved cards. Lineup authority stays fixture.manage or current owner only; a captain/manager label adds no permission. Required evidence includes recipient isolation, expiry/revocation/new revision, same-team response, ordered review transitions, linkage/placement distinctions and lineup denial. Review authorisation is not test evidence.
