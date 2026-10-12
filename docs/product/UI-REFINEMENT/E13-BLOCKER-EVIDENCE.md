# E13 focused blocker repairs and E14 outstanding gates

User authorized checking and addressing concrete E13/E14 blockers after the E12 frozen checkpoint. This is a focused follow-up, not full E13 or E14 BUILD-PASS.

## Addressed

The live administrator board formerly took an unordered 200-row slice before sorting, silently hiding qualifying rooms. It now orders the complete qualifying relation by pulse, latest event and unique ID before selecting a bounded 50-room page plus one continuation sentinel. Native Previous/Next navigation exposes further pages, and polling retains the selected page. Invalid/duplicate/unsafe page input normalizes to page one. Page counts, overview hints, empty states and sampled engine status are explicitly scoped; live changes can reorder pages, so traversal is not a frozen cross-request snapshot.

An engine warning formerly inferred that nobody could bid anywhere when only sampled rooms were unreachable. It now reports unconfirmed status for the checked rooms without asserting a platform-wide bidding outage. Existing staff/current-grant gates, ten-room engine probe bound, read-only room projection, money units and canonical writers remain unchanged.

## Observed engineering evidence

- Actual isolated Postgres: 205 new qualifying rooms all traversed across bounded pages, no duplicates/omissions, deterministic recency ordering; existing room state, monetary/count and event-clock tests preserved. 14 tests pass in `/tmp/ui-e13-live-regressions-isolated.log`. Exact spec-owned organization/people cleanup follows the existing teardown. Initial sandbox connection EPERM occurred before setup; failed log retained.
- Source type, strict affected lint, full formatting, motion and dependency checks pass. Static tenant posture: 86 by-design, zero debt/defect. No new dependency or permission broadening.
- Final `.next-ui-e13-final` BUILD_ID `QLMclVcmVr8WDaYp6dU-W`, source SHA `5cfdc4756cec24c0ac429f1fdca539bb4ef688c313d641f7ec220240276595bd`, 2249 files, exact before/after source and recursive manifests/static assets 920 bound in `/tmp/ui-e13-final-source-binding.json`. Production 137 route budgets pass; compiler include-set/other settings verified and restored. Build-time optional mail-template DB fallback warnings from sandbox restrictions are retained in the build log; they are not canonical database acceptance evidence.
- Fresh production Chromium phone390/laptop1440 and actual Daylight/Floodlight: keyboard Next, native Previous, polling still on page two, 44px control, no page errors, no document overflow, axe zero. Screenshots reviewed. `/tmp/ui-e13-final-native` contains receipts/raw/captures/result; managed server/browser stopped before exact new operator/person/session/grant cleanup. Access audit rows retained.
- Current operator grant revocation gives404; anonymous admin access, production `/dev/inbox`, `/gallery`, `/gallery/emails`, invalid review token and nonexistent public embed each give404 with noindex headers. These assertions ran against the final compiled build. They do not establish every possible token/board/embed state.

Earlier compiled candidate and native evidence are preserved separately; final navigation controls/copy were refreshed after visual review. No Astra or other agent calls, push, merge or deployment.

## Still outstanding

E13's broader broadcast geometry/contrast, valid/expired/revoked review-token interactions, capability matrix, remaining system/error recovery and inventory coverage are not fully refreshed. Matched affected admin-loading comparisons and supported-engine coverage remain pending. The known unordered200 omission is repaired with focused evidence, but these remaining gates prevent full E13 BUILD-PASS.

E14 consolidated full integration, grants/RLS/posture, cross-engine critical journeys, final performance/rollback and screen/state reconciliation are pending. Existing unaffected E00–E11 evidence is retained, not relabeled fresh. E12's warm-load failure remains the user-authorized frozen exception in CHECKPOINT-EXCEPTIONS; it is not a pass. Product/operator/participant/device/physical zoom/manual assistive technology/field/CRO acceptance remains pending. No production release certification is inferred from this local follow-up.
