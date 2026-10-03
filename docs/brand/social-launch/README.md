# Social launch: Instagram and LinkedIn

> 2026-10-01. Paste-ready copy and the files to upload. This builds on
> [`docs/operations/SOCIAL_SETUP_SHEET.md`](../../operations/SOCIAL_SETUP_SHEET.md)
> (19 Aug) and corrects it where the product has moved since:
>
> - **12 sports, not cricket only.** The site's hero now says "in any of 12 sports"
>   (`apps/web/src/content/marketing.ts`), so the copy here does too. Cricket
>   stays the lead example because it's what people search for.
> - **The site and mail are live.** `desiauction.in` answers 200 and the domain
>   has Zoho MX records, so the bio links and `hello@` work.
> - **The hero line is the hook.** "SOLD, without the shouting." is the site's H1
>   and the first post.

Everything visual comes from the shipped brand kit (`docs/brand/kit/`) and the
post templates (`docs/brand/templates/`). No stock photos and no AI imagery:
the brand spec bans both.

Re-render after any copy edit: `mise exec -- node docs/brand/social-launch/render.cjs`

---

## Live status (2026-10-01, evening)

**Instagram `@desiauction`:** photo, name and bio are set. The first three
text-card posts were deleted (recoverable in Recently deleted until 2026-10-31)
and replaced by:

- **Reel 01** `reels/reel-01-pov-bidding-war.mp4`: real footage of the site's
  interactive demo, SOLD frame as the cover.
- **Carousel 01** `instagram/carousel-01/`: "Every local auction has these 5 people."

Bio now: "Your league. Your auction. Prime-time energy ⚡ / Owners bid live from
their phones 📱 / Cricket + 11 more sports · Free in beta / 👇 desiauction.in"

**LinkedIn "The DesiAuction":** headline, About and location (Jaipur) set; 20
connection requests sent to event and operations professionals. The company
page is still blocked ("not enough connections"). The profile photo was left
blank on purpose: LinkedIn requires a real photo of the member on personal
profiles, and a logo there risks the restriction that would block the page.

**Still to do by hand (phone app or a click the browser can't make):**
upload `linkedin/profile-banner-1584x396.png` as the LinkedIn cover; add the
bio links and switch Instagram to a Business account in the app; sign in to
Threads with "Continue with Instagram" and post the two Threads drafts below.

### Threads drafts

1. Every local league has an auction night. Most run it on a spreadsheet, a mic
   and fourteen WhatsApp groups. We built DesiAuction so owners bid from their
   phones and the whole hall watches the big screen. Free in beta → desiauction.in
2. If you've ever run a local auction: what's the wildest argument you've seen
   on auction night? 👇

---

## Search: making "DesiAuction" return our site and every profile (2026-10-02)

Goal: a search for **DesiAuction** shows desiauction.in first, then our
profiles, then a Google knowledge panel. Google builds that from one *entity*,
and it only trusts an entity whose name, logo, description and links agree
everywhere.

**Done**
- One name (`DesiAuction`), one logo, one core line and one link on all six networks.
- Every profile links to desiauction.in; the site footer links back to every
  profile with `rel="me"` (two-way proof of ownership).
- Homepage `Organization` JSON-LD lists the company's own profiles as `sameAs`
  (`ORGANIZATION_PROFILES` in `apps/web/src/content/social.ts`); the personal
  LinkedIn is linked but never claimed.
- YouTube: country India, channel keywords, description, links, trailer, playlist.

**After this branch deploys (week 1)**
1. Google Search Console: request indexing for `/`; check the Rich Results test
   shows the Organization with all five `sameAs`.
2. Bing Webmaster Tools: import from Search Console, submit the sitemap.
3. Search "DesiAuction" in a private window; note what ranks (baseline).

**Weeks 2–6 — give Google more agreeing sources**
4. LinkedIn company page as soon as the profile can create one; add it to
   `SOCIAL_ACCOUNTS` (organization: true).
5. Directory listings from `docs/seo/OUTREACH-KIT.md` (Crunchbase, Product Hunt,
   G2, Capterra): same name, logo, description, links to the site and profiles.
6. Post on a steady rhythm (3 a week): profiles rank for the brand name
   faster when they are active. YouTube titles carry the searched phrase
   ("cricket auction app", "player auction").
7. Google Business Profile only if there is a real address to show; we are an
   online service, so skip until then.

**Do not**: use "IPL" in names, keywords or tags (trademark — the site avoids it
on purpose), or buy followers (it poisons the entity signals above).

---

## Profile standard (2026-10-02) — every network follows this

| Element | Standard |
|---|---|
| Display name | `DesiAuction` (Instagram's searchable name field: `DesiAuction · Player Auctions`) |
| Photo | `docs/brand/kit/social/avatar-1080.png` — gold DA tile |
| Cover | `build-covers.cjs`: the lit pitch — full lockup in one floodlight, `desiauction.in` under it. Same scene cut to each platform's safe area |
| Core line | "Live player auctions for your league. Owners bid on their phones, the hall watches the big screen. 12 sports · Free in beta" |
| Location | Jaipur, India |
| Link | `desiauction.in` with `utm_source=<network>&utm_medium=bio&utm_campaign=always_on` |
| Hero content | The product film "Registration se SOLD tak" — pinned / featured / trailer on every network |

| Network | Handle | Cover | Bio = core line | Link | Hero pinned |
|---|---|---|---|---|---|
| Instagram | @desiauction (Business, category Sports) | n/a | yes | **app only** | **pin in app**; 4 evergreen stories live (START, AUCTION, PRICING, ASK — `instagram/stories/`) |
| Threads | @desiauction | n/a | yes | yes | latest post |
| YouTube | @DesiAuction | yes + DA watermark | description | site, IG, Threads, X | channel trailer; playlist "How DesiAuction Works" |
| X | @thedesiauction | yes | yes | yes | pinned |
| LinkedIn | The DesiAuction (personal) | yes | headline + About | Featured post | Featured |
| Facebook | thedesiauction (in portfolio "DesiAuction" with Instagram) | yes (logo kept clear of the centred profile photo) | yes | website + Sign up button | film as Reel; same 4 stories |

**Done from the phone (2026-10-02):** the 4 live stories saved as highlights
(START, AUCTION, PRICING, ASK, covers from `instagram/highlights/`).

**Still needs the founder:** Instagram bio link (use `desiauction.in/founding-25`
during the Founding 25 call, then the homepage) + pin the film Reel; YouTube
advanced verification (Shorts → related video).

---

## Product film rollout (2026-10-02)

Source: the founder's 100 s Hinglish film "Registration se SOLD tak" (1920x1080,
received via WhatsApp; not in git, no LFS here). `reels/build-film-vertical.cjs`
makes the 9:16 cut. Uploads go through a 10 MB browser bridge, so both cuts are
re-encoded HEVC 640 kbps two-pass (SSIM 0.994 against the source).

| Network | Version | Status |
|---|---|---|
| YouTube | 16:9, chapters, channel trailer | live — https://youtu.be/eCisXjuCnVU |
| YouTube | Reel 01 as a Short | live — https://youtube.com/shorts/FYR-Z2OH-Bs |
| Instagram | 9:16 Reel | live |
| LinkedIn | 16:9, custom thumbnail | live |
| Threads | 9:16 | live, with profile photo, bio, link and the two text threads |
| X `@thedesiauction` | 16:9, pinned | live, with header, logo, bio, Jaipur, link |
| Facebook | 16:9 as Reel (H.264 — Meta's web uploaders stall on HEVC/injected video; Business Suite's reel composer works) | live |

The 2.5 s logo strike (`docs/brand/kit/motion/da-strike-lockup-1920x1080.mp4`)
is the intro for future YouTube videos, not a post.

### Film v2 — re-cut for the no-controversy checklist (2026-10-03, awaiting founder approval)

v1 breaks [`SOCIAL_CONTENT_PLAN.md` §1a](../../operations/SOCIAL_CONTENT_PLAN.md):
"Ab IPL jaisa." on the logo card (rule 2) and "2 minute mein season ready." as the
organiser headline (rule 1), plus "2 minute" / "100 seconds" in the captions.
`reels/build-film-recut.cjs` replaces the two lines in the film's own type; nothing
else changes (same 100 s, audio untouched — music and effects, no voice-over):

| Time | v1 | v2 |
|---|---|---|
| 10.3–12.0 s | Tournament ka auction. **Ab IPL jaisa.** | Tournament ka auction. **Ab phone pe.** |
| 12.4–24.0 s | **2 minute mein season ready.** | **Season ready, bina kaagaz.** |

Files (not in git): `film/film-01-registration-se-sold-tak-16x9-v2.mp4`,
`reels/film-01-registration-se-sold-tak-9x16-v2.mp4` (`build-film-vertical.cjs` on v2;
its organiser label now reads "Season ready, bina kaagaz").

**v2 captions** (the v1 captions minus the time claims, plus #DesiAuction):

- Instagram / Facebook: v1 caption with the first bullet "✅ Season ready, bina kaagaz";
  ends `#cricketauction #playerauction #localcricket #cricketindia #DesiAuction`.
- X (pin it): "Sunday ka tournament. 200 players. Aur auction… kaagaz pe? 😅
  Registration se SOLD tak, ek hi jagah 👇 desiauction.in #DesiAuction"
- LinkedIn: v1 text with "a 100-second film" → "a short film" and "the organiser sets
  up the season in two minutes" → "the organiser sets up the season"; hashtags
  `#SportsTech #Cricket #StartupIndia #DesiAuction`. Video via the YouTube link card.
- YouTube: title and description unchanged (no time claim), chapters still match.

**Swap plan** (no platform lets a published video file be replaced):

| Network | v1 | v2 |
|---|---|---|
| YouTube | set v1 to Private (reversible) | upload v2; make it the channel trailer |
| Instagram | Archive (reversible) | post the 9:16 v2 |
| Facebook | delete the v1 reel | post v2 from `facebook.com/reels/create` |
| X | delete, unpin | post 16:9 v2, pin |
| LinkedIn | delete | post the v2 YouTube link card |

---

## Instagram — `@desiauction`

| Field | Value |
|---|---|
| Profile photo | `docs/brand/kit/social/avatar-1080.png` |
| Name (searchable, 30 max; 2 changes per 14 days) | `DesiAuction · Player Auctions` |
| Category | Sports & Recreation |
| Account type | **Business** (not Creator, so it can join a Meta Business Portfolio later) |
| Contact | `hello@desiauction.in` |

**Bio** (127 / 150):
```
Live player auctions for your league, in 12 sports.
Owners bid on their phones. The hall watches the big screen.
Free in beta ↓
```

**Links** (website links are editable only in the mobile app):
1. `https://desiauction.in/?utm_source=instagram&utm_medium=bio&utm_campaign=always_on`
2. `https://desiauction.in/help/auction-night?utm_source=instagram&utm_medium=bio&utm_campaign=always_on`
3. `https://desiauction.in/pricing?utm_source=instagram&utm_medium=bio&utm_campaign=always_on`

### First launch row (retired 2026-10-01, kept for the record)

Instagram shows the newest post first, so the profile's top row reads
**03 · 02 · 01** from left to right: the promise, the proof, the problem. Pin all
three after publishing.

**01 — `instagram/posts/01-somewhere-tonight.png`**
```
Every local season has one night everybody remembers. It's usually the auction, and it's usually remembered for the argument.

A bid called across the room. A number on a whiteboard. A purse someone swears had ₹20,000 left.

We built DesiAuction so that night is remembered for the players instead.

#playerauction #cricketauction #localcricket #tournament
```

**02 — `instagram/posts/02-ledger.png`**
```
This is what an auction looks like from the inside.

Every bid is checked by the server before it counts, recorded in order, and shown on every screen in the room at the same moment: the projector, every owner's phone, every spectator's link.

Once a bid is recorded, nobody can edit or delete it. Not the organiser, not an owner, not us.

#playerauction #cricketauction #sportstech
```

**03 — `instagram/posts/03-sold-without-the-shouting.png`**
```
SOLD, without the shouting.

DesiAuction runs your league's player auction live. Owners bid from their phones, the hall watches the big screen, and every sale lands on the record. Squads, spend and receipts are done before the lights go off.

Cricket, football, kabaddi and nine more sports. Free during beta, and always free for up to 4 teams and 40 players.

Link in bio.

#playerauction #cricketauction #tournament #desiauction
```

### Story highlights

Covers are in `instagram/highlights/` (1080×1920; Instagram crops to the
centre circle). Highlights need at least one story each, and stories can only be
posted from the phone app, so these are created on mobile:

| Highlight | Cover | First story to put in it |
|---|---|---|
| START | `01-start.png` | `docs/brand/kit/motion/da-strike-story-1080x1920.mp4` |
| AUCTION | `02-auction.png` | Post 03, shared to story |
| PROOF | `03-proof.png` | Post 02, shared to story |
| PRICING | `04-pricing.png` | A screenshot of desiauction.in/pricing |
| NIGHTS | `05-nights.png` | The first real auction night (wait for one) |
| PLAYERS | `06-players.png` | A screenshot of the player registration page |
| ASK | `07-ask.png` | A question sticker: "Ask us anything about running an auction" |

---

## LinkedIn — company page

| Field | Value |
|---|---|
| Page name | `DesiAuction` |
| URL | `linkedin.com/company/desiauction` |
| Logo | `docs/brand/kit/png/da-mark-512.png` |
| Cover | `docs/brand/kit/social/linkedin-cover-1128x191.png` |
| Website | `https://desiauction.in` |
| Industry | Software Development |
| Company size | 0–1 employees |
| Type | Privately held |
| Location | **REQUIRES INPUT**: the LinkedIn profile says Kolkata; the outreach kit says the company is registered in Jaipur |
| Specialties | Sports Technology, Sports Management Software, Auction Software, Cricket, Community Sports, Event Technology, SaaS, India |

**Tagline** (120 / 120):
```
Live player auctions for your league, in any of 12 sports. Owners bid from their phones, every sale lands on the record.
```

**About:**
```
DesiAuction runs player auctions for community sports leagues in India.

Most local leagues still run their auction night on a spreadsheet, a WhatsApp group and whoever has the loudest voice. When lakhs of rupees of purse move in one evening, arguments are normal, and the organiser spends the next week defending the arithmetic.

We think that's the wrong way to spend the best night of a local season.

On DesiAuction:
• Owners bid from their phones while the hall watches the big screen.
• Every bid is checked by the server before it counts, and once recorded it can't be edited or deleted, by anyone, including us.
• Every screen in the room shows the same number at the same moment.
• When the last player is sold, squads, spend and receipts are already done.

Built in India, for how Indian leagues actually run: UPI-first collections, rupee notation, Hindi-ready names and mobile-number sign-in. Cricket, football, kabaddi and nine more sports.

Free during beta, and always free for up to 4 teams and 40 players.
```

**First page post** (with `docs/brand/kit/motion/da-strike-lockup-1920x1080.mp4`):
```
DesiAuction is live.

We build player auctions for community sports leagues: owners bid from their phones, the hall watches the big screen, and every sale lands on a record nobody can edit.

If you run a league, a corporate tournament or a society cup, we'd like to hear how your last auction night went. The good parts and the arguments.

desiauction.in
```
