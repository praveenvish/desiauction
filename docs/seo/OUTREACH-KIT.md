# SEO-1 Phase 7: outreach kit (founder half)

The engineering half of Phase 7 is live: `/embed/[slug]` with its copy-paste
snippet, plus "Powered by DesiAuction" on public season pages and the wordmark
on `/board`, `/overlay` and share cards (see SEO-PLAN §17). This file is the
founder half. It holds the copy, the order of work and the log, so each listing
says the same true things and each backlink is recorded once.

**Rules for every word below:**

- **Only claim what the product does today.** If a directory's form asks for a
  feature we don't have, leave it blank.
- **Never pay for placement.** "Free listing" is the goal everywhere. Paid
  upgrades (sponsored slots, PPC, lead plans) are declined unless decided
  separately.
- **No fake reviews,** and no asking friends to review. Directories delist for
  it. Only real organizers who ran a real night are asked, and only after that
  night.

---

## 0. Before the first listing (blockers)

| # | Item | Why | Who |
|---|---|---|---|
| 0.1 | **Create the real social profiles** (at least Instagram, YouTube, LinkedIn page, X), then send me the URLs | Every directory asks for them. Today the footer icons link to the networks' home pages (`apps/web/src/content/social.ts`, placeholders since 2026-09-30). The Organization structured data already filters those placeholders out, so it publishes no `sameAs` until real ones exist. Real profiles there are one of the strongest brand-entity signals Google uses. | Founder creates; engineering swaps the URLs (one file) |
| 0.2 | **A 60–90 second product video** on the YouTube channel: owners bidding on phones, the board on the big screen, SOLD | Product Hunt, G2 and Capterra all take a video, and it's the best asset a stream kit can link to. `scripts/capture-marketing-screens.ts` already drives a scripted practice auction to shoot from. | Founder (engineering can run the capture) |
| 0.3 | **Pick one listing email,** e.g. `hello@desiauction.in` | Directory vendor accounts use a work address on our domain (G2 and Capterra verify it). Use one alias for all of them so the accounts outlive any one person. `support@` is for customers, so keep it out of this. | Founder (Zoho alias) |
| 0.4 | **Confirm the company facts** in §1 | Directories show the legal entity. The registry fields in `content/company.ts` are still marked "confirm against the certificate". | Founder |

---

## 1. Master facts: copy from here, never retype

**Name:** DesiAuction
**Website:** https://desiauction.in
**Company:** Eventztree Private Limited, Jaipur, Rajasthan, India
**Category (pick the closest each site offers):** Sports League Management · Event Management · Auction Software
**Pricing:** Free during beta, no card. Tournaments started during beta stay free forever. Paid plans later will be a pass per tournament, with no subscriptions or seats. (Source: `/pricing`.)
**Sports:** 12, including cricket, box cricket, football, kabaddi, volleyball, badminton, basketball, hockey, table tennis, pickleball and esports
**Platforms:** Web. Works in any phone browser; there's no app to install.
**Languages:** English
**Logo:** `apps/web/public/brand/lockup.png` (wordmark), `brand/icon-512.png` (square)
**Screenshots:** `apps/web/public/marketing/product/` (`auction-board-v2.webp`, `owner-phone-bidding-v2.webp`, `owner-phone-sold-v2.webp`). These are real screens from a scripted practice auction with fictional players. Export to PNG when a site rejects WebP.

### Taglines

- **≤ 40 chars:** `Live player auctions for your league`
- **≤ 60 chars (Product Hunt tagline):** `Run your league's player auction live, from every phone`

### Descriptions

**≤ 160 chars (meta-style, short directory field):**

> Run your sports league's player auction live. Team owners bid from their phones, the hall watches the big screen, and every sale is recorded. Free in beta.

**≤ 260 chars (Product Hunt description):**

> DesiAuction runs the player auction for local sports leagues. Owners bid from their own phones, the auctioneer runs the room, the big screen shows every bid and SOLD, and purses, squads and receipts settle themselves. 12 sports. Free during beta.

**Long (G2, Capterra, SaaSworthy "About"):**

> DesiAuction is a live player-auction platform for community and club sports leagues in India: the box-cricket league at a turf, the corporate tournament, the college fest, the society cup.
>
> Before auction night, the organizer imports registrations, often straight from a Google Form, then sets the purse, base prices and squad sizes. Team owners join on their own phones.
>
> On the night, the auctioneer runs each lot from one screen. Owners bid from their phones, and the rules are enforced as they go: no team can bid more than it can afford while still filling its minimum squad. The hall watches a big-screen board, with a stream overlay for YouTube.
>
> Every bid and sale is written to a permanent record. Squads, purses and receipts are settled from it, and the replay shows the whole night lot by lot.
>
> It works for 12 sports, in rupees or in points. There's nothing to install: it runs in the browser. Free during beta, and tournaments started in beta stay free.

### Key features (bullet fields; pick as many as the site allows)

- Live bidding from each team owner's phone
- Auctioneer console: open a lot, call it SOLD, or mark it unsold
- Big-screen auction board and YouTube or OBS overlay
- Purse and squad rules enforced as bids arrive
- Registration import from Google Forms or CSV
- Rupee or points auctions
- Settlement: squads, purses, numbered receipts
- Permanent auction record and lot-by-lot replay
- Public season page, plus an embed for the league's own site
- 12 sports

### Comparison targets ("alternative to")

Name only what the site already lists, and keep it to what our own comparison
pages argue (`/compare/spreadsheet-and-whatsapp`, `/compare/manual-auction`):
**"Spreadsheet and WhatsApp"** and **"running the auction by hand"**. Don't name
competitor products in our copy.

### Links: tag every backlink with its source

Use `https://desiauction.in/?utm_source=<site>&utm_medium=listing`, with
`<site>` one of `producthunt`, `g2`, `capterra`, `saasworthy`, `techjockey`,
`alternativeto`. The canonical tag already folds these into `/` for search.
The tags only exist so analytics can say which listing sent people.

---

## 2. Directories, in this order

Do them one per sitting, and log each one in §7 when it goes live.

| # | Site | What it's worth | What it needs | Notes |
|---|---|---|---|---|
| 1 | **AlternativeTo** (alternativeto.net) | Fast, free, and indexed quickly | Account, then "Add app": name, description (long), tags, screenshots | Tags: `sports`, `auction`, `league-management`, `cricket`. Set "alternative to" only where a real listed product matches; don't stretch. |
| 2 | **SaaSworthy** (saasworthy.com) | Free listing, a decent dofollow-style profile | Vendor sign-up with the work email | Category: Sports League Management. Use the long description and the feature bullets. |
| 3 | **G2** (g2.com → "Get listed", my.g2.com) | High authority; reviews later | Work email on our domain; domain verification | Free profile only; decline the paid plans. Category: Sports League Management. Reviews come from §6 organizers, after their night. |
| 4 | **Capterra / GetApp / Software Advice** (one vendor portal, vendors.capterra.com) | Three listings from one form; India traffic | Work email, company details, screenshots | Free basic listing; **decline PPC.** Pricing field: "Free" with the beta note. |
| 5 | **Techjockey** (techjockey.com, seller/vendor sign-up) | Indian buyers, India-specific category pages | Company details | They sell leads and promotions, so the free listing is the ask. Their sales calls follow; say no to paid plans. |
| 6 | **Product Hunt** | One big day of traffic and a lasting high-authority link | Maker account, gallery, first comment, a launch day | **Do this last:** after the video (0.2), the real socials (0.1), and ideally one case study (§6), so the page has proof. See §2.1. |

### 2.1 Product Hunt launch plan

- **Day:** Tuesday to Thursday. The day starts at 00:01 Pacific (12:31 or 13:31 IST, depending on US daylight saving), so post then.
- **Gallery** (1270×760 recommended): (1) the board mid-auction, (2) an owner's phone bidding, (3) SOLD on the phone, (4) the replay, (5) the video.
- **Topics:** Sports, Events, Productivity.
- **First comment** (founder, posted at launch):

  > Hi Product Hunt! I built DesiAuction because local leagues in India run their player auction on a whiteboard, a spreadsheet and a lot of shouting. Someone always disputes a bid, and the purse maths happens on a phone calculator at midnight.
  >
  > With DesiAuction, every owner bids from their own phone. The rules (purse, squad size, base price) are enforced as bids come in, the hall watches a big screen, and every sale is written to a permanent record. Squads and receipts are done when the gavel falls.
  >
  > It's free during beta, and anything you start in beta stays free. I'd love to hear from anyone who's run (or been the auctioneer at) one of these nights.

- **On the day:** reply to every comment within the hour, and post the link on our own socials and WhatsApp groups. **Never ask anyone to upvote.** Product Hunt penalises vote requests; ask people to "take a look" instead.

---

## 3. Stream kit: give this to every organizer who streams their auction

Organizers stream to YouTube using `/overlay`. A description that links to
their public season page is a real backlink from a real channel, and it sends
viewers to the page where they can follow the league.

**YouTube title:** `{League name} {Season} Player Auction LIVE | {City}`

**YouTube description:**

```
{League name} {Season}: the player auction, live.

{Number} teams. {Number} players. Every bid, every SOLD, as it happens.

Teams, squads and results: https://desiauction.in/c/{season-slug}

Auction run on DesiAuction: https://desiauction.in
```

**Pinned comment:**

```
Final squads and every sale are on the season page: https://desiauction.in/c/{season-slug}
```

**WhatsApp message to the league's groups (before the night):**

```
{League name} auction is LIVE tonight at {time}.
Watch here: {YouTube link}
Teams and squads: https://desiauction.in/c/{season-slug}
```

The season page only exists for **published** seasons. Ask the organizer to
publish before they stream. Engineering follow-up: a "Copy stream description"
button on the season's live screen that fills these templates in (see §8).

---

## 4. Press: local sports desks

**The angle:** a city league's auction night is a local story ("the ₹-crore
moment of the turf league", "how a society cricket cup ran an IPL-style
auction"). We pitch **the league's night**, with DesiAuction as the tool behind
it, never DesiAuction alone. A product launch isn't news to a city desk; a
local league with a 40-player auction is.

**Who:** the city sports desk of the local English and Hindi dailies in the
league's city; city news and sports pages on Instagram and YouTube; local
cricket YouTube channels. Start with Jaipur, where the company is registered,
and every city a real season runs in.

**When:** 3–5 days before a real auction night, and only with the organizer's
yes. The organizer is the story and should be the quoted voice.

**Pitch email:**

```
Subject: {League name}: {N} teams bid for {M} players live on {date} in {City}

Hi {Name},

On {date} at {venue}, {League name} holds its player auction: {N} team owners
bidding for {M} local players, live on a big screen and streamed on YouTube.

{One human detail: the league's age, a notable local player, a cause, a
record from last year.}

{Organizer name} ({phone}) runs the league and is happy to talk, and you're
welcome to attend or watch the stream: {YouTube link}.

Teams and squads: https://desiauction.in/c/{season-slug}

{Your name}
DesiAuction (the auction platform the league uses)
```

**Hard rules:** no player phone numbers or other personal details in a pitch;
the organizer approves every word; nothing about minors without their
guardians' consent, and when in doubt leave players out.

---

## 5. Communities

| Who | Why they matter | The offer | First message |
|---|---|---|---|
| Turf and box-cricket ground owners | They host the leagues; one owner reaches many organizers | Free tool for leagues at their ground; their venue named on the season page | Template A |
| Cricket and sports academies | They run internal leagues and know the local organizers | Free auctions for their academy league | Template A |
| College sports committees and fests | An annual auction, a young audience, and links from college sites | Free auction for the fest; their fest page can embed the season (`/embed`) | Template B |
| Corporate sports clubs and HR teams | They run company leagues every year | Free in beta; a clean record for the company | Template A |

**Template A (WhatsApp or email):**

```
Hi {Name}, I'm {your name} from DesiAuction. We run live player auctions for local leagues: owners bid from their phones, the auction shows on a big screen, and squads and purses settle automatically.

It's free during beta (and stays free for anything started now). If any league at {place} has an auction coming up, I'd be glad to set it up with them and stand by on the night.

Here's what it looks like: https://desiauction.in
```

**Template B (college fest):**

```
Hi {Name}, for {Fest}'s {sport} league: DesiAuction can run the player auction live, with team owners bidding from their phones and the auction on the big screen. Free for the fest.

You can also embed the live season card on the fest website. Want me to set it up for your auction date?
```

---

## 6. Case studies: one per real season that agrees

A case study is the strongest backlink and the strongest proof we can have.
`/case-studies` is a placeholder today: noindex, kept out of the sitemap and
search. It becomes real with the first agreed story.

**When to ask:** the day after a real auction night that went well. Never
before it, and never as a condition of using the product.

**Consent (written, by WhatsApp or email is fine):**

- The organizer agrees to the league name, city and their own name and quote appearing.
- Players appear only by **adult** name, and only if the organizer confirms those players agreed. Default: no player names at all, only numbers.
- **No minors, by name or by photo, ever.** The same rule as the squad-indexing switch.
- Photos: only ones the organizer sends and confirms we may use.

**Questions for the organizer** (a 15-minute call, or answers on WhatsApp):

1. How did you run the auction before? What went wrong on the night?
2. How many teams, players and owners? Rupees or points?
3. What was different this time: one moment you remember?
4. How long did the auction take, and what was settled when it ended?
5. Would you run the next one the same way? What would you change?
6. One sentence we can quote.

Figures come **from the record**, not from memory: teams, players sold, the top
price and the total spent are read from the season's auction every time the
page renders. The season must stay **published** for them to show.

**Built:** `/case-studies/{slug}` reads from the registry in
`apps/web/src/content/case-studies.ts`. Adding a story is one entry there:
league, season slug, city, sport, title, summary, the organizer's name, role
and approved quote, the story text, and the **consent record** (who agreed,
when, how, and whether named players or photos were agreed). A test refuses an
entry with no consent, no season, or a publish date before the consent date.
While the registry is empty, `/case-studies` stays the "coming soon" page:
noindex, out of the sitemap and search, with the quiet footer. The first entry
switches all four on.

---

## 7. Log: every listing and backlink, once

| Date | Where | URL of our listing or mention | Link to us (page) | Status |
|---|---|---|---|---|
| | | | | |

Check monthly: Search Console → Links → "Top linking sites" should grow as
this table grows. Bing Webmaster Tools → Backlinks shows the same.

**KPIs** (from SEO-PLAN §4): referring domains, non-brand impressions, and
organic sign-ups. Review monthly.

---

## 8. Engineering follow-ups this kit creates

| Item | Trigger | Size |
|---|---|---|
| Swap `content/social.ts` placeholders for real profiles (feeds the footer and Organization `sameAs`) | Founder sends URLs (0.1) | Small |
| "Copy stream description" button on the live screen, filling the §3 templates from the season | Any time | Small |
| ~~`/case-studies/{slug}` registry and pages; un-noindex `/case-studies`; sitemap entry~~ | **Built:** switches on with the first registry entry | Done |
