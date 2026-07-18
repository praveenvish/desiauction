# PX-1 · 05 — Content Guide

> Production-ready copy. Voice rules bind from docs/20–21 (plain, warm, specific,
> honest states, no exclamation marks in errors, Indian-English, ₹ always via Money).
> Everything below ships as written unless legal review amends §9.

## 1. Voice in one line

**Calm authority with a smile** — we handle other people's money and their most exciting night of the season; sound like the person in the room everyone trusts.

## 2. Homepage (`/`)

**Hero h1**: The auction night your tournament deserves.
**Sub**: Run your player auction on screens everyone trusts — every bid server-verified, every rupee accounted for, every SOLD moment an occasion.
**CTA primary**: Run your auction → `/login` · **CTA secondary**: Watch how it works → `/help/auction-night`

**Section: The problem** (h2: *Spreadsheets ruin auction night*)
"That bid was mine." "Your sheet says ₹80,000, mine says ₹85,000." Every organizer knows the week after the auction — defending arithmetic on WhatsApp. It doesn't have to be like this.

**Section: Three promises** (cards)
1. *One truth on every screen* — Bids are validated on the server and land on the projector, every owner's phone, and every spectator's screen at the same instant. There is nothing to dispute.
2. *The night feels like television* — The SOLD moment is a synchronized ceremony. Players hear their names called into an occasion, not read off a cell.
3. *The books close themselves* — Purses, dues, receipts, and an immutable ledger — done when the gavel falls, exportable to your accountant.

**Section: How it works** (4 steps): Create your competition → Players register with one link → Run the live auction → Collect and receipt every rupee.
**Section: Built for Indian tournaments** — UPI-first collections, ₹ everywhere, Devanagari-ready names, phone-number sign-in. No email required.
**Footer beta note**: DesiAuction is in beta. Every tournament gets full features, free, while we earn your trust.

## 3. Pricing (`/pricing`)

**h1**: Simple, public pricing. **Sub**: You buy a Pass per tournament — no subscriptions, no seats, no "contact sales".
**Beta banner**: During beta, everything is free. Paid Passes arrive with GA at these published prices — tournaments started during beta stay free forever.
Tier cards per docs/45 (Free: 4 teams / 40 players, full trust features; Pro Pass: 16 teams / 400 players + branding & overlays; Association: bundles) — each card states "Trust is never premium: the immutable ledger, receipts, and audit are in every tier, including Free."
**FAQ on page**: Why passes, not subscriptions? · What happens when my pass expires? (Your data is never held hostage — everything stays readable and exportable, forever.) · Refunds? (Full refund until your auction goes live.)

## 4. UI microcopy standards (bound)

- Buttons: verb-first, specific ("Record payment", never "Submit"/"OK"). Destructive confirms name the object ("Waive ₹4,000 for Malad Mavericks").
- Tooltips only for icon-only buttons and truncated data — never for essential instructions.
- Dates: "16 Jul 2026, 7:30 pm" (IST implied, never shown). Money: always via `Money` primitive.
- Statuses render in sentence case via the existing underscore→space transform; ledger verbs (SOLD, UNDO) stay uppercase — they are events, not statuses.

## 5. Validation & error messages (canonical set)

| Context | Copy |
|---|---|
| Phone invalid | Enter a 10-digit Indian mobile number. |
| OTP cooldown | We just sent a code. You can request another in a minute. |
| OTP hourly limit | Too many codes requested. Try again in an hour, or sign in with a passkey. |
| OTP wrong/expired | That code didn't match. Check the latest SMS or request a new code. |
| Name required | Tell us your name — it appears on team sheets and the auction stage. |
| Name length | Names are 2–60 characters. |
| Generic form | Something's not right — check the highlighted fields. |
| Server action failure (toast) | That didn't save. Your data is safe — try again, and contact support if it repeats. |
| Money command rejected | Render the writer's reason **verbatim** (they are written for humans), prefixed "Not recorded: ". |
| Forbidden page | You don't have access to this yet. Ask your organizer for the {grant name} grant. |
| 404 | This page doesn't exist. It may have moved, or the link was mistyped. → Go home |
| error.tsx | Something broke on our side — you didn't lose anything. → Try again · Go home · Contact support |

## 6. Live room & ceremony copy

- Connecting: "Connecting to the room…" · Reconnected: "Back live — nothing missed." (snapshot model guarantees this; say it.)
- SOLD announcement (Announcer, assertive): "{Player name}. SOLD to {Team} for {₹amount}."
- Unsold (dignity rule C-23): "{Player name} — passes for now." Never "unsold" on public surfaces; the word appears only in Console/ledger.
- Pause: "The auctioneer has paused the auction. Stay put — resuming shortly."
- Recovery: "Reconciling the room… every bid is safe." 

## 7. Notification templates (in-app now; SMS/WhatsApp mirror at PX-3)

| Event (existing dispatch source) | Title | Body |
|---|---|---|
| Registration approved | You're in! | You're registered for {competition}. We'll tell you when the auction is scheduled. |
| Registration waitlisted | You're on the waitlist | {competition} is full for now. If a spot opens, you're next in line. |
| Registration rejected | About your registration | Your registration for {competition} wasn't approved this time. Reason: {reason category}. Questions? Reply to your organizer. |
| Owner invite (mirror of link) | You've been invited | {Organizer} invited you to own {team} in {competition}. Accept: {link} |
| Auction scheduled | Save the date | {competition}'s auction goes live {date}. Watch or bid: {link} |
| Receipt issued | Receipt {number} | We've issued your receipt for {₹amount} — {competition}. View: {link} |
| Invoice issued | Invoice {number} | Dues for {team}, {competition}: {₹amount}. Your organizer will collect via cash/UPI/bank. |
| OTP (SMS, PX-3) | — | {code} is your DesiAuction sign-in code. Valid 5 minutes. Never share it. |

## 8. Help center — the ten launch articles

1. Running your first auction night (end-to-end walkthrough)
2. Setting up a competition and opening registration
3. The registration desk: approving, waitlisting, importing from CSV
4. Fixtures: generating, resolving conflicts, publishing
5. Auction setup: teams, owners, purses, paddles, lots
6. Conducting the auction: cockpit, undo, freeze, recovery
7. For team owners: joining, bidding, your purse, what you owe
8. Money after the gavel: recording collections, waivers, closing the case
9. Receipts, invoices and exports (including Tally)
10. Sign-in, passkeys and keeping your account safe
Each article: task-titled, ≤900 words, one screenshot per major step, "Still stuck? Contact us" footer.

## 9. Legal skeletons (founder/legal to ratify; structure ships as-is)

- **Terms**: service description; account = verified phone; organizer responsibilities (they run the money; we record it); acceptable use; beta clause (free during beta; data portable); liability cap; Indian law, Mumbai jurisdiction.
- **Privacy**: what we store (phone, name, registration data, auction records); why (running your tournaments); no sale of data; processors (hosting, SMS provider, error tracking — name them at deploy); retention (immutable ledgers retained; account deletion on request with ledger anonymization); contact.
- **Refunds** (docs/45 verbatim policy): full refund until your auction goes LIVE; after that the pass is consumed. Platform-fault abandonment → refund, always.

## 10. Emails

**None in beta.** The platform's channels are in-app (built) and SMS (PX-3). Email templates are deliberately out of scope until an email provider lands post-beta (finops dispatch already models the channel; templates will reuse §7 copy).

## 11. Success confirmations (toasts)

"Organization created" · "Invite link copied" · "Competition created" · "{n} registrations approved" · "Fixtures published" · "Payment of {₹amount} recorded" · "Case closed — ceremony ready" · "Receipt {number} issued" · "Export ready — download below". Toast = past-tense fact, ≤6 words + optional object.

## 12. Empty states (canonical set)

| Screen | Title | Body + CTA |
|---|---|---|
| /home (new) | Welcome to DesiAuction | Your auction night starts with an organization. → Create your organization |
| /orgs | No organizations yet | Create one to run tournaments, or ask an organizer for an invite link. (as built — keep) |
| /competitions | No competitions yet | Create one inside an organization to add teams and open registration. (as built — keep) |
| /inbox | Nothing yet | Approvals, receipts and auction updates will land here. |
| /money | Nothing owed, nothing due | When you own a team in an auction, your purse and receipts appear here. |
| Settlement (no auction) | The money desk opens after your auction | Complete the auction and the case opens here with every obligation computed. |
| Documents | No documents yet | Receipts and invoices are issued from closed cases and land here automatically. |
| Results (pre-close) | The story isn't finished | Results publish when the auction completes. |

## 13. Content debt register (explicitly NOT written here)

Landing screenshots/product film (needs the built shell first — PX-2 blocks on PX-1 visuals); help-article screenshots (same); provider names in privacy policy (deploy-time); About page beyond the landing section (post-beta).
