# VA-1 — Experience Prototype
## Evidence instrument for Phase 0B (see `docs/phase-0b/EVIDENCE_PLAN.md` · judged against `docs/EXPERIENCE_DIRECTION.md` §12)

> **Throwaway by constitution.** Nothing in `prototypes/` may ever be imported by production code. This exists to produce evidence, not to become the product.

## 1 · What this is

Three experiences, one simulated auction, two visual directions:

| Page | Experience | Notes |
|---|---|---|
| `stage.html` | **Auction Stage** — hall/projector view | Auto-runs a demo auction if no Cockpit is driving |
| `owner.html` | **Owner Room** — mobile bidding | Open on a phone, or judge the framed phone on desktop; you are *Sitapur Strikers* |
| `cockpit.html` | **Cockpit** — the operator's seat | If open, it becomes the driver: Stage/Owner tabs in the same browser follow it live (BroadcastChannel) |

**Run:** `python3 -m http.server 8477` in this directory → `http://localhost:8477/`. No build needed to view (bundles committed in `js/`). Rebuild after editing `src/`: `npx esbuild src/*.ts --bundle --format=iife --outdir=js`. Typecheck: `npx -p typescript tsc --noEmit --strict --target es2022 --lib es2022,dom --moduleResolution bundler --module esnext src/*.ts`.

**Every page has a ⚙ drawer**: Direction A/B, reduced motion, failure simulations (disconnect / feed stall / force-unsold), projector scale (Stage), and an fps meter (evidence for motion-budget checks).

## 2 · The two directions (do not assume A wins — evidence decides)

- **Direction A · FLOODLIGHT** — the documented language (05/08/09): broadcast night. Ink surfaces, volt accent, gold reserved for SOLD. Display face: **Anek Devanagari** — *a deliberate substitution for the spec'd Clash Display*, chosen because it carries Latin and Devanagari at equal display weight (this directly tests the Phase 0A Devanagari-parity blocker; if A wins, doc 09 must be amended).
- **Direction B · MAIDAN** — a fundamentally different interpretation: the ground itself rather than the broadcast of it. Evening-field green, warm chalk text, heritage gold as the accent, **Fraunces** serif display (with Tiro Devanagari fallback — *knowingly weaker Devanagari parity*, which is itself a measured comparison point, not an oversight).

Both directions obey the experience constitution (one lit thing, gold is earned, stillness at verdicts). What varies is the visual *interpretation* — exactly the variable VA-1 exists to test.

## 3 · Hypothesis register (pre-registered; criteria may not be edited after sessions begin)

| ID | Hypothesis | Rationale | Observable | Success | Failure |
|---|---|---|---|---|---|
| H1 | Viewers immediately know where attention belongs (EP-4) | One-subject Stage is the core legibility bet | 5-second "what's happening right now?" probe | ≥4/5 answer player + price + leader unaided | Hunting, wrong answers |
| H2 | SOLD feels significant without becoming theatrical (XC-5/6) | The peak must be earned, not manufactured | Reaction at ceremony; asked "too much / right / too little" | Majority "right"; spontaneous positive reaction ≥50% of ceremonies | "Cheesy," "like an ad," or silence |
| H3 | Owners trust phone bidding with money (A-P2/U1) | The rebuild's largest untested product assumption | Timed bids in VA-2; hesitation; error rate | ≥90% first-try bids, median tap-to-bid <3s, zero accidental holds | Handing the phone back; fear reports; mis-bids |
| H4 | The Cockpit feels calm under a live duel (EP-1, A-U2) | Operator calm is the product's first deliverable | Naïve operator runs 5+ lots | Zero missed decisions; self-report "in control" | Overwhelm, hunting for controls, builder rescue |
| H5 | The interface reads premium in 5 seconds (A-V1) | The strategy is the first impression (01/02) | Blind first-reaction protocol (VA-1 §12) | ≥3/5 use premium-class words unprompted | "Scoreboard app," "Excel," silence |
| H6 | One direction clearly out-performs the other (A-V2) | Volt-vs-heritage is a taste bet needing data | A/B first impressions + premium-price anchors per direction | A clear winner on both premium wording and price anchor | Split verdict → iterate, re-test |
| H7 | Devanagari names carry equal ceremony weight (A-V3) | Dignity + brand integrity at the emotional core | Side-by-side SOLD: Latin vs Devanagari name | Viewers judge them equal; no "the Hindi one looks off" | Visible inferiority in either direction |
| H8 | The anti-snipe extension is *felt as fairness*, not glitch (EP-2) | Excitement and rule-visibility in one gesture | "+12s" pop moment; ask "what just happened?" | Viewers explain "late bid added time" unaided | "It's broken/stuck/cheating" |
| H9 | Narrated reconnection *builds* trust rather than alarming (EP-10) | The owner-reconnection beat is won or lost here | Disconnect sim during a live lot (⚙ drawer) | Users report increased confidence; can state purse/leader after resync | Panic, "did my bid go through?", distrust |
| H10 | The motion system holds ≥50fps on a mid-range Android (A-V4/PF1) | The majority device class must get the same night | fps meter + 6× CPU throttle during ceremony | ≥50fps sustained, or reduced variant indistinguishable in meaning | Jank at the peak |

## 4 · Known compromises (honest ledger)

1. **No backend, no network truth** — the "server" is an in-page simulation; cross-*device* sync doesn't exist (cross-*tab* does, via BroadcastChannel). VA-2's multi-phone session needs either same-machine tabs or a 50-line relay — decided at VA-2 prep.
2. **Office temperature untested** — all three surfaces are stadium-temperature; the light Console register of C-4 gets zero evidence from VA-1 (deliberate scope: the strategy risk is the stadium).
3. **Icons, empty states, edge layouts unpolished** — per the VA-1 charter: do not polish; invalidate quickly.
4. **No sound** — awaiting the VA-8 ruling (VA-0 named gap #1); both silence and sound remain testable later.
5. **English-only copy** — Hindi *names* are first-class; Hindi *copy* awaits the VA-8 voice ruling (VA-0 gap #2).
6. **Fonts via Google CDN** — self-hosting and licence verification deferred to production; Anek/Fraunces/Tiro are all OFL.
7. **AI bidders are theatre** — tuned for believable duels (escalating slab increments ≈8% of price), not for economic realism.
8. **Timer trust is local** — endsAt is a local timestamp; clients interpolate. Real engine truth is Phase 2's job (C-16).
9. **Transient cosmetic**: one observed frame where the countdown arc showed the closing color early after a lot transition (not reproduced; ring verified correct in continuous running). Logged for judging sessions to watch for.

## 5 · Evidence this instrument is expected to produce

- X1 (Evidence Plan): recorded five-second reactions, per direction → clears/blocks **B1**.
- H7 comparison frames → resolves the **Devanagari display decision** (amend 09 if Anek wins).
- H6 verdict → confirms or replaces **Volt (C-5)** with data, not taste.
- H2/H8/H9 observations → validate the motion constitution (§9) or send it back for amendment.
- Throttled fps traces → first real numbers against the 57 motion budgets.
- Build-discovered facts (already logged): escalating increments are *necessary* for auction pacing — flat ₹25k increments made a marquee duel run ~10 minutes; doc 41's slab default gains its first evidence. Purse math held consistent across surfaces throughout a full 8-lot pool run including two UNSOLD outcomes.

## 6 · Questions this prototype cannot answer (do not over-claim)

- Whether organizers will **pay** (VA-3/VA-4's job), or whether real owners bid under real social pressure (VA-2's job — this instrument only enables it).
- Real hall optics (projector contrast, viewing distance) — projector-scale mode approximates geometry, not luminance.
- Real network truth (packet loss, 200-person hall Wi-Fi) — the disconnect sim tests the *experience* of recovery, not the recovery.
- Whether the full product (Console, forms, tables — the office temperature) sustains the same identity.
- Anything about cost, funnel, or retention.

## 7 · Recommended changes to VA-0

**None yet — and none are permitted from the builder's chair.** VA-0 changes only if judging data says so (XC-11: evidence before opinion). Two *tensions noticed while building*, logged for judges to probe, explicitly not proposed as amendments:

1. **EP-14 vs the room's energy between lots:** the interstitial rest state ("Next on the block…") is constitutionally silent, but a real hall may need the *operator* to control inter-lot tempo (banter time, chai break). Probe in VA-2: does the resting Stage feel composed, or dead air?
2. **EP-6 hold-to-confirm vs duel tempo:** ≥₹5L bids require a 600ms hold in the Owner Room. In a hot duel this is friction exactly where excitement peaks — VA-0 says that friction *is respect*; VA-2's H3 timing data will say whether owners agree.

*Built 2026-07-11 · browser-verified during build: full 8-lot pool auto-ran on the Stage — live duel to ₹8.25L, "+12s" anti-snipe pop, mid-roll money frame captured, two dignified "passes," order book + purse reconciliation exact, Devanagari display parity in Direction A · zero console errors.*
