# VA1-RC1 — RESEARCH CANDIDATE 1 · FREEZE MANIFEST

> Release Engineering · 2026-07-12 · the build all X1 sessions run on.
> **Frozen.** No code, visual, or interaction changes permitted. Only a Critical defect (blocks a session or corrupts evidence) may break this freeze; Major/Minor findings are logged for RC2 and fixed only after ALL X1 sessions complete.

## 1 · Build identification

- **Build ID:** VA1-RC1
- **Git tag:** `va1-rc1` (predecessor build baf6278 + four approved patches; RC1 diff = 7 files, 16 insertions, 12 deletions — 2 CSS, 3 TS sources, 2 rebuilt bundles; `js/stage.js` unchanged because tree-shaking excludes the patched code from it)
- **Scope:** `prototypes/va1/` only. Serve: `python3 -m http.server 8477` in that directory.
- **Toolchain:** esbuild bundle (committed in `js/`), strict `tsc` clean (es2022/dom).
- **SHA-256 checksums** (verify with `shasum -a 256 …`; any mismatch = sessions are NOT on RC1):

```
02ddae58cf2e0a08…  index.html          820b3c37a97b1b27…  stage.html
7eb4c46659e3e517…  owner.html          a122e24b75742292…  cockpit.html
512b89eadfb891f8…  css/base.css        434381273e5934d4…  css/cockpit.css
9ea1e0b1f800efff…  css/owner.css       edcd2b8e0517f85c…  css/stage.css
84262b3c2daaa820…  css/tokens.css      dd4e8248107ac37a…  js/cockpit.js
f47ff18b1a35ebd0…  js/owner.js         d116d61edc546803…  js/stage.js
```

## 2 · Patch report (complete change set since baf6278 — nothing else changed)

| Finding | Root cause | Files | Fix |
|---|---|---|---|
| **F-HD-1** Owner-B name/ring collision | `.o-pname` fixed 34px with no clearance for the absolutely-positioned ring; serif glyphs overran | `css/owner.css` | `padding-right: 82px` + line-height 1.12 — long names wrap clear of the ring |
| **F-AX-1** Reduced motion bypassed the ≥₹5L hold | `!reduced()` short-circuits in `owner.ts` startPress and `shared.ts` holdButton treated a safety time-gate as motion | `src/owner.ts`, `src/shared.ts` | Bypasses removed; hold timing applies to all users; fill bar retained as essential progress feedback |
| **F-AX-2** Faint text below AA | `--text-faint` A #5A6578 (3.38:1), B #7E8F7F (4.28:1) | `css/tokens.css` | A → #76839B, B → #A6B4A4 |
| **F-CPO-1** Idle Cockpit showed "₹0" | `rollMoney(cur, …?? 0)` rendered zero with no player fact | `src/cockpit.ts` | No player → "—" |

## 3 · Verification report (every fix observed in a real browser; re-run after catching stale-cache serving)

| Fix | Verification | Observed |
|---|---|---|
| F-CPO-1 | Cockpit idle, DOM read | `idleMoney: "—"` ✓ (final figure still shown during the settling phase, when a player fact exists) |
| F-AX-2 (B) | In-page computed-style contrast calculation on rendered pixels | faint rgb(166,180,164): **6.77:1** bg, **5.64:1** panel ✓ |
| F-AX-2 (A) | Same, Stage-A "Base price" element | faint rgb(118,131,155): **5.20:1** on ink ✓ |
| F-HD-1 | Owner-B with "Rohit Deshmukh" (the colliding case), screenshot ss_1575q2vnv | Name wraps to two lines, fully clear of the ring ✓ (a bounding-box probe reports element-box overlap because the box includes the reserved padding; the rendered text is the evidence) |
| F-AX-1 | Reduced motion ON, live "Bid ₹12.25L · HOLD TO CONFIRM": 150ms press, then 3s hold | Short press: **no commit**; full hold: **committed** ("You lead at ₹12.25L") ✓ |

## 4 · Regression report (post-patch, same browser)

- Gavel (shares patched holdButton): `O` opened lot, 2.6s held Space closed it, settled count advanced ✓
- Small-bid tap (<₹5L): instant commit on tap, no HOLD label ✓
- Rapid interaction: two pointer-downs 60ms apart → exactly one bid (leader-guard) ✓
- Reconnect: stepped overlay progressed and dismissed with correct facts ("Purse ₹90L · you lead at ₹2.25L"); health dot recovered ✓
- Stage A + B live render post-patch ✓ · Reduced motion exercised ✓ · Keyboard: O / held Space / Tab focus-visible (2px outline) ✓
- Console: **zero errors/exceptions** across all post-patch pages ✓

## 5 · Accessibility report (measured, not estimated)

- Contrast: faint ≥4.5:1 on measured surfaces both directions (5.20 / 6.77 / 5.64); dim 7.06 (A) / 5.46 (B); accents 14–15:1 — **AA pass on all measured combinations**
- Focus visibility: PASS (rendered 2px `:focus-visible` outline) · Reduced motion: still-variant ceremony carries full meaning; hold gate uniform — PASS · Keyboard: fully operable, with the known focus-dependency (§6)
- Touch targets: bid button generous; ⚙ toggle 38px (facilitator-only) — RC2 log
- Screen reader: wiring present; **not verifiable on this channel** → field-kit prep item

## 6 · Known limitations & open risks (disclosed, unchanged by RC1)

1. Keyboard conduct requires page focus, no indicator (F-UX-1) — facilitator clicks the page once before handover; watch X1 cockpit block.
2. Early hold-release cancels silently (F-UX-2); commit is frame-delivered, lags wall-time under severe throttling (F-PE-1) — measure at device check.
3. No cross-device sync (BroadcastChannel, same browser only) — VA-2 relay ruling open (F-CTO-1).
4. Mobile viewport, touch-hold, real fps, screen reader → real-device checks at field-kit prep (§0).
5. Direction-B ambient-gold vs ceremony-gold (F-HD-2) — founder 2-second check at prep; a decision, not a defect.
6. Cosmetic watches: disabled-primary saturation (F-HD-3); amber-ring transient (1 frame, never reproduced); drawer sim-buttons no-op when driven.

## 7 · Research instructions

- All X1 sessions run **this build, unmodified**. Before P-F: `git status` clean in `prototypes/va1/`, spot-check one checksum.
- Sessions start in **fresh incognito** (field kit §1) — which also guarantees RC1 assets, not stale cache. If a non-incognito demo ran on this machine, hard-reload (⌘⇧R) once.
- Defects during X1: classify Critical / Major / Minor on the sheet. **Only Critical** (session-blocking or evidence-corrupting) breaks the freeze — fix → re-verify → tag `va1-rc2` → note the build split on every affected sheet. Major/Minor → RC2 backlog after all sessions.

## 8 · RC1 release notes

Four objective, board-approved defect corrections (Expert Review 1025b12): Direction-B name/ring collision (wrap zone); reduced-motion users regain the large-bid safety hold; faint-text tokens raised to AA both directions; idle Cockpit shows absence, not ₹0. No feature work, no redesign, no visual exploration. Process note: initial post-patch verification caught the browser serving **stale cached assets**; verification re-run after hard reload — the incognito session protocol makes this a non-issue for research.

## 9 · Final readiness

# **READY FOR HUMAN RESEARCH**

Objective justification: all four approved patches verified by direct observation on rendered pages; regression sweep green (conduct, bid, hold, tap, double-fire, recovery, both directions, reduced motion, keyboard, focus); measured accessibility passes on every combination this channel can measure; zero console errors; build checksummed and frozen. Remaining unknowns are delegated to the field-kit device check by design, or belong to humans. Nothing in this verdict speaks to delight, trust, or memory — those are X1's to discover.

*VA1-RC1 · frozen 2026-07-12 · Release Engineering*
