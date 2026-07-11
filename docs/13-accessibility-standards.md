# 13 — Accessibility Standards

> Canon: C-15, C-23, C-24 · v1.0 · 2026-07-11

## Floor

**WCAG 2.2 AA** on every surface — including live surfaces, which is where most auction products quietly give up. Accessibility failures are release-blocking defects (69), and axe scans gate CI (59).

## Non-negotiables

- **Keyboard-complete:** every flow, including conducting a full auction from the Cockpit, works keyboard-only. Focus order is documented per surface; focus is always visible (2px volt ring on dark, volt-600 on light, offset 2px); focus is restored after dialogs/peeks close.
- **Targets:** ≥ 24×24px (2.2 AA), ≥ 44×44px on Owner Room bid controls (money + stress + phones = bigger targets).
- **Contrast:** per 08; verified pairs only.
- **No color-only meaning:** every status pairs color with icon or text (badges say "LIVE", not just glow).
- **Zoom:** 200% text scaling and 400% page zoom without loss of function on Console (14).
- **Motion:** full reduced-motion parity (11); no flashing above 3Hz anywhere, ever (also a projector-safety rule).

## The live auction a11y strategy

The hard problem: a screen-reader user (owner or spectator) following an event stream that can move fast.

- **One polite live region per surface** for event narration; announcements are coalesced — rapid bids collapse to the latest ("Bid ₹90,000, Titans leading"), never queue-spam.
- **Assertive interruptions** for exactly three events: lot SOLD, lot UNSOLD, auction paused/resumed. Everything else is polite.
- Canonical announcement grammar lives in 21-microcopy and is implemented once in `@da/ui` (`<Announcer>`), not per-screen.
- Timer: announced at 30s/10s/extension only (not every second); anti-snipe extension announced as "Time extended."
- The Cockpit's keyboard conduct model (space = hold-to-close-lot, documented per key in 15) is announced on first entry and available via `?`.

## Forms, errors, structure

- Every input has a visible label (no placeholder-as-label, 29); errors are associated via `aria-describedby` and announced; error summaries link to fields.
- Landmarks: one `main` per page, labeled `nav`/`aside`; heading levels never skip.
- Tables: real `<table>` semantics with `scope`; sortable headers announce state (30).
- Dialogs: focus-trapped, `Esc` closes (except mid-money confirmations, which require explicit choice — 28), labelled by their title.

## Language & culture (C-24)

- `lang` attributes correct per string when Hindi ships; screen readers must not read Hindi in an English voice.
- Indian number notation is spelled out for screen readers: "₹1.2 L" announces "1 lakh 20 thousand rupees" (formatter provides `aria-label`).

## Verification

- CI: axe-core on every Storybook story + key pages (59).
- Per release: manual screen-reader pass (VoiceOver + TalkBack) on the six Golden Journeys' critical screens (70).
- Per component: a11y acceptance section in its spec before build (19, 69).
