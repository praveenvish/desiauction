# Email v2 — the approved look (PR0)

Every customer email is a core touchpoint: for most players the sign-in code
and the registration mails are the first thing DesiAuction ever sends them.
This folder is the design spec the implementation PRs build to. Nothing in the
product sends these files.

```
node docs/design/email-v2/build-mockups.mjs     # writes mockups/*.html + mockups/gallery.html
```

Open `mockups/gallery.html` to see every mail as the inbox lists it (subject +
preview line), then at phone (390 px) and desktop (680 px) width, in light and
dark, in English and Hindi.

## The five mails

| Mail | Status | What changes |
|---|---|---|
| Sign-in code | redesign | Code leads the subject line ("482913 is your DesiAuction sign-in code"). Big code that copies without spaces, expiry time, the device and time it was requested from, and a "Didn't ask for this?" callout. Still no links. |
| Registration received | **new** | The first mail a player gets: club band, progress tracker, what they submitted, and how to fix a mistake. |
| Registration approved | redesign | Tracker moves a step. Date tile for auction night. |
| Sold | redesign | The Floodlight stage in both themes: gold price, three bidding facts, share-card button, the squad so far. |
| Auction tomorrow (owner) | **new** | T-24h reminder (canon C-19): date tile, team, purse, squad size, the owner-room button. |

## Rules the layout follows

- **One layout, a few building blocks:** club band, code, progress tracker, stage, date tile, facts table, callout. The code owns the facts; admins edit only the wording, as today (`email-templates.ts`).
- **Tables and inline styles.** A mail must read fully with no `<style>` block and with images blocked. The `<style>` block only adds phone spacing and dark mode.
- **Phone first:** 22 px card padding and a full-width button at 520 px and below. Buttons are at least 48 px tall.
- **Dark mode:** `color-scheme: light dark`, with Floodlight tokens under `prefers-color-scheme: dark` (Apple Mail, iOS Mail, Outlook for Mac). Gmail recolours on its own. The palette is chosen to survive that: gold fills with ink text never become white on yellow.
- **Brand colours from the tokens:** gold `#F0B43C` fill with a `#B57F14` rim and ink `#070A0F` text. Gold *text* is `#865D12` on light and `#F3D078` on dark, never the fill colour.
- **Never red for a person's outcome** (C-23). Unsold and declined mails use neutrals.
- **Hindi:** `lang="hi"` on the document (today it is hard-coded `en`), a Devanagari-first font list, and no letter-spacing on Devanagari.
- **Size budget:** each mail is under 60 KB (Gmail clips at 102 KB). The build script fails on a mail over budget.
- **Footer:** why you got this, plus "Manage emails" on every mail except code and security mails, which cannot be switched off.

## The plan after this

1. **PR1 – layout v2** in `apps/web/src/server/messaging/email-layout.ts`, plus `pnpm mail:gallery` over the real template registry, with size, `lang` and plain-text parity tests.
2. **PR2 – sign-in code:** code in the subject, request context.
3. **PR3 – registration journey:** `registration.received` and the tracker on every decision mail.
4. **PR4 – moments:** sold, appointed, lineup, squad sheet, unsold.
5. **PR5 – auction reminders:** owners and pool players, T-24h and T-30m.
6. **PR6 – security, demo, review and receipts.**
7. **PR7 – deliverability pass.** Sending already works; this PR covers SPF, DKIM and DMARC alignment, a mail-tester score of at least 9, and checks on real clients.
