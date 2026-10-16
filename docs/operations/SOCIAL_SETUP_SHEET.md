# DesiAuction — social account setup sheet

> Paste-ready. Every field, every platform, character-counted. Written 19 Aug 2026.
> **Status updated 1 Oct 2026** by checking each public profile URL from outside (logged out).
> Facebook and X hide profiles behind a login wall, so their state could not be confirmed that way — tick them by hand.

## Status at a glance (1 Oct 2026)

| Platform | Handle | Profile URL | Account | Profile filled in | On the website |
|---|---|---|---|---|---|
| Instagram | `desiauction` | `https://www.instagram.com/desiauction/` | ✅ live — name `DesiAuction`, 0 posts | ⬜ bio, links, Business switch unconfirmed | ✅ linked |
| Threads | `desiauction` | `https://www.threads.net/@desiauction` | ✅ live | ⬜ unconfirmed | — no footer icon |
| YouTube | `@DesiAuction` | `https://www.youtube.com/@DesiAuction` | ✅ **live since 19 Aug** (channel `UCMp4rwKkqQlKaBtTSbO7kuw`) | ❌ description empty | ✅ linked |
| LinkedIn | `desiauction` | `https://www.linkedin.com/company/desiauction` | ❌ **not created** (404, 1 Oct) | — | — removed until live |
| Facebook | `desiauctionofficial` | `https://www.facebook.com/desiauctionofficial` | ❓ login wall — confirm by hand | ❓ | — removed until live |
| X | `desiauctionofficial` | `https://x.com/desiauctionofficial` | ❓ login wall — confirm by hand | ❓ | — removed until live |
| WhatsApp | Business number / Channel | — | ❓ not recorded | ❓ | — removed until live |

`desiauction` is taken on Facebook and X by dormant, unrelated accounts (evidence at the bottom of this sheet), hence `desiauctionofficial` there.

Display name is **`DesiAuction`** everywhere. One word, capital D, capital A. Never "Desi Auction" as two words — that form carries the adult-content search adjacency, and note that both squatted accounts use exactly that form.

---

## The website's social links

The footer's social icons and the homepage's search-engine data (`sameAs` in the Organization JSON-LD) use the same links. **Both come from one file: `apps/web/src/content/social.ts`.**

**1 Oct:** the placeholders are gone. The footer now shows only **Instagram** and **YouTube** — the two profiles confirmed live. Rule: an icon goes back in only when its account exists *and* has a filled-in profile.

- [ ] X / Facebook — once confirmed, add the URL back to `social.ts`
- [ ] LinkedIn — create the Page, fill it, then add it back
- [ ] WhatsApp — add the Channel invite or `https://wa.me/<number>` once one exists
- [ ] Optional: add Threads (`social.ts` + a glyph in `apps/web/src/components/shell/social-links.tsx`)

---

## Order of operations

1. ~~Google Workspace~~ → **Done differently:** mail is **Zoho Mail (free, India DC)**, live since 30 Aug. One mailbox `praveen@desiauction.in`; `social@`, `hello@`, `support@`, `privacy@` and the rest are **aliases** delivering into it.
2. ~~YouTube~~ → **channel exists.** Confirm it is a **Brand Account**, then paste the description below (it is empty).
3. **LinkedIn** Page — needs your personal profile as admin. **Still to do.**
4. **Facebook** Page → then claim the username — confirm status.
5. **X** — `desiauctionofficial` — confirm status.
6. **Migrate Instagram's login email to `social@desiauction.in`** — now possible, the alias exists.
7. Meta Business Portfolio: Page → Portfolio → claim Page → connect Instagram → 2FA → verify domain. (The same portfolio owns the WhatsApp Cloud API number used for product messages — see `docs/messaging/WHATSAPP_SETUP.md`.)
8. **Update `social.ts`** with the real URLs (section above).

Every account should be registered to `social@desiauction.in`, never a personal Gmail.

---

# YOUTUBE

> **1 Oct:** channel `@DesiAuction` exists; its description is empty. Check it is a Brand Account (YouTube Studio → Settings → Permissions shows "Brand Account"), then paste the fields below.

**Must be a Brand Account, not a personal channel.** Personal channels cannot be transferred cleanly, and one day you will want to hand this over.

**Channel name:** `DesiAuction`
**Handle:** `@desiauction`

**Description** (paste whole):
```
DesiAuction is the trusted operating system for community sports auctions in India.

Local cricket tournaments run player auctions on spreadsheets, WhatsApp messages and a loud voice — and the organizer spends the next week defending arithmetic. We think the most exciting night of a local season deserves better than a projected Excel sheet.

On this channel:
· How to run a player auction for your tournament — step by step
· Real auction nights, filmed start to finish
· Auction strategy for team owners: purse management, reserve rules, bidding ladders
· How the platform works — setup, live conduct, settlement

Every bid on DesiAuction is server-verified and immutably recorded. Every rupee is accounted for. Receipts are issued when the gavel falls.

Free during beta. India.
→ desiauction.in
```

**Links:** `desiauction.in` · **Contact:** `hello@desiauction.in` · **Country:** India

**Banner copy:** `THE NIGHT GOES RIGHT` / `Live cricket player auctions for community tournaments`
Upload 2560×1440. Keep all text inside the centre **1235×338** safe area.

**Playlists — create all seven now, even empty:**
`Run Your First Auction` · `Auction Nights` · `Auction Strategy for Owners` · `How DesiAuction Works` · `Organizer Stories` · `Shorts` · `The Build`

---

# LINKEDIN

**Page name:** `DesiAuction` · **URL:** `linkedin.com/company/desiauction`

**Tagline** (120 max):
```
The trusted operating system for community sports auctions. Live cricket player auctions, beyond dispute.
```

**About** (paste whole):
```
DesiAuction is the trusted operating system for community sports auctions.

The problem, stated honestly: tens of thousands of local cricket tournaments across India run player auctions every year, and they run on spreadsheets, WhatsApp messages, and trust in whoever holds the pen. When ₹2 lakh of purse moves across an evening, disputes are normal, the occasion is squandered, and the person doing the most work has the worst night.

Existing tools treat this as a data-entry problem. It is a trust and theatre problem.

We build for three outcomes:

Money is physics, not opinion. Every bid is server-validated, immutably recorded, and identical on every screen in the room. Bids cannot be edited or deleted by anyone, including us. Squads and spend are derived from purchases — there is no edit path that could fake them.

The night is an occasion. The moment a player is sold is a synchronized ceremony across the projector, every owner's phone, and every spectator's screen.

The organizer exhales. Setup is guided, live conduct makes one person calmly powerful, and when the last lot closes, receipts and squads are already done.

Built in India, for how India actually runs cricket: UPI-first collections, rupee notation, Devanagari-ready names, mobile-number sign-in.

Currently in controlled beta.
```

**Industry:** Software Development · **Company size:** 1 employee · **Type:** Privately Held
**Website:** `https://desiauction.in` · **Location:** [your city] **[REQUIRES INPUT]**
**Specialties:** `Sports Technology, Sports Management Software, Cricket, Event Technology, Auction Software, SaaS, Community Sports, India`

**Your personal headline:**
```
Building DesiAuction — cricket player auctions where the money is beyond dispute | Founder
```

---

# FACEBOOK

Create the **Page** first, then claim the username in Page Settings.

**Page name:** `DesiAuction` · **Username:** `desiauctionofficial`
**Category:** Sports & Recreation (secondary: Software Company)
**CTA button:** `Learn More` → `https://desiauction.in`
**Email:** `hello@desiauction.in`

**Short description** (255 max):
```
Live player auctions for community cricket tournaments in India. Every bid server-verified, every rupee accounted for, receipts issued when the gavel falls. Free during beta.
```

**About** (paste whole):
```
DesiAuction is the trusted operating system for community sports auctions.

Tens of thousands of local cricket tournaments in India run player auctions every year — gully leagues, corporate leagues, society tournaments, district associations. Almost all of them run on WhatsApp messages, an Excel sheet, a loud voice, and trust in whoever holds the pen. When ₹2 lakh of purse moves in an evening, disputes are normal and the organizer spends the following week defending arithmetic.

We think that's the wrong way to spend the best night of a local season.

On DesiAuction, every bid is validated by a server before it's recorded, and once recorded it cannot be edited or deleted by anyone — including us. Every screen in the room shows the same number at the same instant: the projector, every team owner's phone, every spectator's link. There is nothing to dispute because there is only one truth.

And the night looks like it should. Players hear their names called into a moment that renders like television, not read off a spreadsheet cell. When the last lot closes, squads are final, receipts are issued, and the organizer's last act of the night is nothing at all.

Free during beta, with full features.

desiauction.in
```

---

# X / TWITTER

**Handle:** `desiauctionofficial` · **Name:** `DesiAuction`

**Bio** (160 max):
```
Live player auctions for community cricket tournaments. Every bid server-verified, every rupee accounted for. The night goes right. 🏏 India
```

**Location:** India · **Website:** `desiauction.in`
**Header:** 1500×500, Ink field, beam, wordmark

---

# INSTAGRAM (live, 0 posts on 1 Oct — finish the setup)

**Username:** `desiauction` ✅

**Name field** (30 max — this field is searchable, it is SEO not decoration):
```
DesiAuction · Cricket Auction
```

**Bio** (150 max):
```
Run your tournament's player auction on screens everyone trusts.
Every bid verified. Every rupee accounted for.
🏏 India · Free in beta ↓
```

**Links** (up to 5):
1. `https://desiauction.in/?utm_source=instagram&utm_medium=bio&utm_campaign=always_on`
2. `https://desiauction.in/pricing?utm_source=instagram&utm_medium=bio&utm_campaign=always_on` *(once priced)*
3. `https://desiauction.in/help/auction-night?utm_source=instagram&utm_medium=bio&utm_campaign=always_on`
4. WhatsApp Channel invite
5. rotating campaign link

**Category:** Sports & Recreation · **Contact:** `hello@desiauction.in` + WhatsApp button

**Settings to change now:**
- [ ] Switch to **Business** (not Creator — Creator can't be claimed cleanly into a Business Portfolio)
- [ ] **2FA via authenticator app**, not SMS
- [ ] Change the account email to `social@desiauction.in` (the Zoho alias is live)

**Highlights — create all 7 with covers:**
`START` · `AUCTION` · `PROOF` · `PRICING` · `NIGHTS` · `PLAYERS` · `ASK`

---

# THREADS (live)

Bio mirrors Instagram, shortened to 150:
```
Live cricket player auctions for community tournaments. Every bid verified, every rupee accounted for. India · Free in beta
```

---

# WHATSAPP BUSINESS

**Business name:** `DesiAuction` · **Category:** Software / Sports
**Email:** `hello@desiauction.in` · **Website:** `desiauction.in`

**Description** (256 max):
```
Live player auctions for community cricket tournaments. Server-verified bids, one truth on every screen, receipts when the gavel falls. Free during beta. desiauction.in
```

**Greeting message:**
```
Welcome to DesiAuction 🏏

We run player auctions for community cricket tournaments — every bid verified, every rupee accounted for.

Tell us what you need:
1 · I want to run an auction for my tournament
2 · I'm a player and I've been sent a link
3 · Pricing
4 · Something else

Reply with a number and we'll take it from there.
```

**Away message:**
```
Thanks for writing. We're away right now and will reply by 10am IST.

If it's auction night and something is wrong, write AUCTION NIGHT and it jumps the queue.

Meanwhile: desiauction.in
```

**Quick replies** — the eight from the launch plan Part 1 §5.4: `/price` `/start` `/how` `/player` `/demo` `/sponsor` `/night` `/free`

**Channel name:** `DesiAuction` · **Channel description:**
```
The night goes right.
Auction nights, organizer tips, and what we're building. Cricket auctions for community tournaments across India.
```

---

# THE DORMANT HANDLES — evidence on file

Captured 19 Aug 2026, kept for a possible future trademark claim.

**X `@DESIAUCTION`** — joined April 2016 · **0 posts** · **0 followers** · 12 following · no avatar, no bio.
**Facebook "Desi Auction | New York NY"** — **1 follower** · 0 following · no avatar · a New York buy-and-sell page, unrelated to cricket.

Neither is a competitor, neither is active, and neither operates in your category or your country. That combination is the strongest position you could be in: no brand confusion in India today, and a clean argument later if you register the mark.

Recovering either needs a **registered trademark**, which needs an incorporated entity. Park it — it is not a launch blocker. But keep the screenshots.
