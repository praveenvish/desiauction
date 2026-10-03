# Post 02 — "Remote kiska?" (Ghar Ka Auction)

> 2026-10-03. Ready to post. Founder approves this file before anything goes out.
> Safety rules: [`SOCIAL_CONTENT_PLAN.md` §1a](../../operations/SOCIAL_CONTENT_PLAN.md).

**The idea:** match day, one TV remote, four people. Instead of fighting, the
family runs an auction: Papa, Mummy and Beta raise each other, Papa and Beta
tap **20 at the same moment** (the server takes the first; Beta's phone says
*"Someone has already bid that much or more."*), and quiet Dadi jumps straight
to **45**. SOLD — Dadi.

**Why it travels:** every Indian home has had the remote fight; nobody needs to
know cricket; it is forwarded to family WhatsApp groups ("yeh toh apne ghar ka
hai"); the comment prompt asks people to name and tag their own family member;
Dadi winning is the twist people rewatch. The tie beat is the product's real
promise — *"The server checks every bid, not the loudest voice."*

**What is real:** every product frame is a real screen of a real points auction
(fictional owners, local stack) — the phones, the TV big screen, the tie refusal
and Dadi's "You won TV Remote". Nothing redrawn, no AI imagery. Labelled on
every frame: *Scripted for fun · demo auction · points, not money*.

---

## Posted (2026-10-03, founder-approved)

| Network | Link | Settings |
|---|---|---|
| Instagram Reel | https://www.instagram.com/desiauction/reel/DeBdxUtCIvO/ | Original 9:16, SOLD cover, caption as below, AI label off, comments on, no cross-post |
| YouTube Short | https://youtu.be/SGphrc61ryU | Public; not made for kids; no paid promotion; AI use: no |
| Facebook Reel (Page) | https://www.facebook.com/reel/2105400960075251 | Posted from facebook.com/reels/create as the Page; copyright check "safe to publish"; caption with the direct facebook UTM link; AI label off |
| Threads | https://www.threads.com/@desiauction/post/DeBfn4wDHWc | Video + short text + threads UTM link |
| X `@thedesiauction` | https://x.com/thedesiauction/status/2106281873240641973 | Video + short text + x UTM link, #GharKaAuction |

Not posted (not requested yet): the two Stories.

**Upload notes for next time:** Business Suite's reel composer builds its file
input on click (not automatable) — use `facebook.com/reels/create` as the Page.
On Threads, attach the video *before* typing a link, or the link card replaces it.

## Files

| File | Use |
|---|---|
| `reels/reel-02-ghar-ka-auction.mp4` | The Reel: 26 s, 1080×1920, H.264 + AAC, −14 LUFS. Instagram, Facebook, YouTube Shorts, Threads, X |
| `reels/reel-02-ghar-ka-auction-cover.jpg` | Cover / thumbnail (the SOLD beat) |
| `instagram/stories/05-ghar-ka-poll.png` | Story 1 (Sun night): add the **poll sticker** in the empty space |
| `instagram/stories/06-ghar-ka-result.png` | Story 2 (Mon morning): add the **link sticker** |

Rebuild: `reels/build-reel-02-ghar-ka-auction.cjs`, `reels/build-ghar-ka-stories.cjs`
(captures: `reels/capture-ghar-ka-auction.spec.ts`, see its header).

**Sound:** an original score made for this reel (`reels/score-ghar-ka.cjs`) —
we own every sample, so it can't be muted or claimed. Dhol-style bhangra groove
from the first frame; a bell on each bid, rising with the price; a comic
"wah-wah" when Beta loses the tie; the band stops and a heartbeat builds while
Dadi waits; a big hit when she bids; gavel knocks and the DesiAuction sting on
SOLD. Mixed to −14 LUFS (Instagram's loudness), no silent gaps. Post it with
the Reel's own sound — don't add a library track over it.

**Brand:** the DesiAuction logo sits on every frame; the caption names it in
the story ("Ladai band. DesiAuction pe auction!"); the end card holds the full
logo for 4 s with what DesiAuction is, in the site's own words: "Live player
auctions for your league, in any of 12 sports. Owners bid from their phones,
the hall watches the big screen." Both Stories carry the logo too.

## Schedule (IST)

| When | Where | What |
|---|---|---|
| Sat 3 Oct, 7:30 pm | Threads + X | Teaser question (text only) |
| **Sun 4 Oct, 7:30 pm** | **Instagram Reel** | The Reel + caption. Share to Facebook from the composer |
| Sun 4 Oct, 7:45 pm | YouTube Shorts | Same file, Shorts title below |
| Sun 4 Oct, 8:00 pm | IG + FB Story | `05-ghar-ka-poll.png` + poll sticker |
| Sun 4 Oct, 8:15 pm | Threads + X | The Reel as a reply to the teaser |
| Mon 5 Oct, 10:00 am | IG + FB Story | `06-ghar-ka-result.png` + link sticker |

Sunday 7:30 pm: families are home together — the moment the post is about.
The first hour after posting: reply to every comment (replies below).

## Links (UTM — count sign-ups, not views)

| Network | Link |
|---|---|
| Instagram (bio + Story link) | `https://desiauction.in/?utm_source=instagram&utm_medium=social&utm_campaign=ghar_ka_auction` |
| Facebook | `https://desiauction.in/?utm_source=facebook&utm_medium=social&utm_campaign=ghar_ka_auction` |
| YouTube | `https://desiauction.in/?utm_source=youtube&utm_medium=social&utm_campaign=ghar_ka_auction` |
| Threads | `https://desiauction.in/?utm_source=threads&utm_medium=social&utm_campaign=ghar_ka_auction` |
| X | `https://desiauction.in/?utm_source=x&utm_medium=social&utm_campaign=ghar_ka_auction` |

## Captions

**Instagram Reel** (also Facebook):

> Match day. Ek remote. Chaar log. Solution? AUCTION. 📺🔨
> Papa aur Beta ne ek saath bid kiya — jo pehle pahuncha, wahi aage. Aur phir… Dadi. 🏆
>
> Aapke ghar mein remote kiske paas rehta hai? 👇 Tag karo!
>
> SOLD, without the shouting. Free for up to 4 teams & 40 players → link in bio
> Scripted for fun · demo auction · points, not money
>
> #GharKaAuction #AuctionNight #CricketAuction #LocalCricket #DesiAuction

Cover: `reel-02-ghar-ka-auction-cover.jpg`. Audio: the Reel's own score (no film
songs — business accounts get muted; if a track is added, only from Instagram's
commercial-use library). Location tag: none.

**YouTube Shorts**
- Title: `Family ne TV remote ka AUCTION kar diya 😂 #Shorts`
- Description:
  > Match day, ek remote, chaar log — toh auction! Papa aur Beta ne ek saath bid kiya, server ne pehle wala liya. Aur jeeti… Dadi.
  > Scripted for fun · demo auction · points, not money.
  > Run your own auction free: https://desiauction.in/?utm_source=youtube&utm_medium=social&utm_campaign=ghar_ka_auction
  > #Shorts #CricketAuction #GharKaAuction

**Threads — teaser (Sat 7:30 pm)**
> Aapke ghar mein TV remote kiske paas rehta hai? 📺
> Papa · Mummy · Bhai/Behen · Dadi/Nani — sach batana 😄

**Threads — Sunday reply (with the Reel)**
> Humne ghar mein remote ka auction kar diya. Spoiler: Dadi. 🏆
> desiauction.in/?utm_source=threads&utm_medium=social&utm_campaign=ghar_ka_auction
> #CricketAuction

**X `@thedesiauction`** — same as Threads, one hashtag: `#GharKaAuction`.

**Story 1 poll sticker:** question "Remote kiske paas?" — options **Papa /
Mummy / Beta / Dadi** (tap "Add option" for the third and fourth; if the app
offers only two, use **Papa / Mummy** and a second sticker for **Beta / Dadi**).

**Story 2 link sticker:** text "Apna auction chalao" → the Instagram link above.

## Hashtags

- **#GharKaAuction** — ours. Checked 2026-10-03: no brand or campaign uses it;
  the phrase otherwise only means a property auction (harmless). Open the tag
  in the Instagram app once before posting to confirm it is empty or clean.
- The rest reach cricket people: #AuctionNight #CricketAuction #LocalCricket.
- **Never:** IPL or any team/board name, #fantasy, #betting, #satta, #desi alone.

## Replies for the first hour

| Comment | Reply |
|---|---|
| "Hamare ghar mein Mummy 😂" | "Mummy ka purse sabse strong hota hai 💪 Tag karo unko!" |
| "Is this real?" / "Fake hai" | "Scripted for fun 😄 — but the auction is real: every screen in the video is DesiAuction running a live demo." |
| "How do I use this?" | "desiauction.in — free for up to 4 teams & 40 players. Players for your tournament, or the remote at home 😄" |
| "Is it money / betting?" | "No money at all here — points only. DesiAuction is for running player auctions for your league." |
| Anything abusive or political | Hide. Never argue. |
| A real complaint | Reply once, politely, and move to DM within the hour. |

## Safety check (done 2026-10-03)

- [x] Every claim is on the site: "SOLD, without the shouting", "Free for up to
      4 teams and 40 players", the refusal text is the product's own string.
- [x] No money: points only, labelled "points, not money". No bet/odds/jackpot/all-in words.
- [x] No religion, caste (no surnames), region, politics or gender roles — Papa,
      Mummy and Beta each want *a match*; Dadi wins and is celebrated, not mocked.
- [x] No real people, no minors, no phone numbers or addresses on screen.
- [x] No IPL/BCCI/team marks, no broadcast footage, no other brand in frame.
- [x] No contest or prize (so no T&Cs, no state exclusions).
- [x] Labelled "Scripted for fun · demo auction · points, not money" on every frame.
- [x] No AI imagery; no copyrighted music.

---

## Optional: the live-action version (later)

If you want a version with real people, shoot it with family or friends — adults
only — reusing the same auction (or a fresh one: run the capture script with
your own season). The screens in this Reel stay the product frames.

**Shot list (35–40 s, vertical, eye level):**
1. Close-up: Dadi taps her phone; the TV behind shows SOLD (open on the end).
2. Wide: four people on the sofa reaching for one remote.
3. Beta stands: "Theek hai. Auction karte hain."
4. Insert: each phone shows its paddle (screen recordings, not filmed screens).
5. Fast cuts: Papa, Mummy, Beta bid; the TV updates.
6. Papa and Beta tap together; Beta reads the refusal and groans.
7. Slow: Dadi taps once. Everyone freezes. TV: SOLD — Dadi.
8. Dadi puts on old film songs; everyone laughs together.
9. End card (from the Reel).

**Consent line** (each person signs before filming; keep the signed copies):

> I agree that DesiAuction may record and publish video of me taking part in a
> scripted family scene, on its website and social media accounts. I can ask for
> it to be taken down at any time by writing to privacy@desiauction.in.
> Name · Signature · Date
