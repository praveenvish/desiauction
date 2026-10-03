# Post 03 — "Ek take." (the practice auction)

> 2026-10-03. Scheduled for **Sun 4 Oct 2026, 7:30 pm IST** on Instagram,
> Facebook, YouTube Shorts, Threads and X. Safety rules:
> [`SOCIAL_CONTENT_PLAN.md` §1a](../../operations/SOCIAL_CONTENT_PLAN.md).

**The idea:** auction night has one take. An owner who meets the bidding screen
for the first time in front of the whole hall freezes. So the organiser runs a
**practice auction** first, and opening the real auction moves every phone
across by itself. Organiser-facing (pillar A), the day after the family reel —
fun one day, useful the next.

**What is real:** every product frame is a real screen of a real practice
auction (fictional club "Sunday League", first-name-only players), captured by
`reels/capture-practice.spec.ts`. The words on screen are the product's own:
the practice card ("Same link, same screens — nothing counts", "100 points per
team") and the PRACTICE bar ("Nothing here counts"). The closing line is the
site's: "Your auction has one take. Rehearse it tonight — free."

**Gate:** this post shows the hand-over to the real auction. It goes out only
once [praveenvish/desiauction#201](https://github.com/praveenvish/desiauction/pull/201)
— the hand-over fix — is merged and deployed to production; before that fix,
phones kept the ended practice on screen.

## Files

| File | Use |
|---|---|
| `reels/reel-03-ek-take.mp4` | The Reel: 14.8 s, 1080×1920, H.264 + AAC, original score |
| `reels/reel-03-ek-take-cover.jpg` | Cover (the hand-over, before → after) |

**Recut 2026-10-03 (payoff first, §1b):** frame one is the hand-over — the same
phone in PRACTICE and then in the real auction ("The practice is over — the real
auction has started") — then how it works in five fast beats. The old "owner
freezes" opener is gone; 22.8 s → 14.8 s.

Rebuild: `reels/build-reel-03-ek-take.cjs` (captures: `reels/capture-practice.spec.ts`).

## Captions

**Instagram** (Facebook: same text, with the direct facebook link instead of "link in bio"):

> Auction night ka ek hi take hota hai. 🎬
> Owner pehli baar app khole aur poora hall dekh raha ho? 😬 Isliye pehle — PRACTICE auction.
>
> ✅ Same link, same screens
> ✅ 100 points — galti karo, kuch count nahi hota
> ✅ Asli auction shuru → har phone khud switch
>
> Organisers: rehearse it tonight — free → link in bio
> Demo auction · fictional players · points, not money
>
> #AuctionNight #CricketAuction #TournamentOrganiser #LocalCricket #DesiAuction

**YouTube Shorts**
- Title: `Auction night ka ek hi take 🎬 Pehle PRACTICE karo #Shorts`
- Description:
  > Owner pehli baar app khole aur poora hall dekh raha ho? Isliye pehle practice auction: same link, same screens, 100 points, kuch count nahi hota — aur asli auction shuru hote hi har phone khud switch.
  > Demo auction · fictional players · points, not money.
  > Rehearse it tonight — free: https://desiauction.in/?utm_source=youtube&utm_medium=social&utm_campaign=ek_take
  > #Shorts #CricketAuction #AuctionNight #DesiAuction

**Threads** (with the video):
> Auction night ka ek hi take hota hai. 🎬 Pehle practice auction: same link, same screens, 100 points, kuch count nahi hota — aur asli auction shuru hote hi har phone khud switch.
> Rehearse it tonight — free: desiauction.in/?utm_source=threads&utm_medium=social&utm_campaign=ek_take #DesiAuction

(Threads takes one topic per post: #DesiAuction is it. Attach the video before typing the link.)

**X `@thedesiauction`** (with the video):
> Auction night ka ek hi take hota hai. 🎬 Pehle practice auction: same link, same screens, kuch count nahi hota. Asli auction shuru → har phone khud switch.
> Rehearse it tonight — free: desiauction.in/?utm_source=x&utm_medium=social&utm_campaign=ek_take #AuctionNight #DesiAuction

## Links

`https://desiauction.in/?utm_source=<instagram|facebook|youtube|threads|x>&utm_medium=social&utm_campaign=ek_take`

## Safety check (2026-10-03)

- [x] Claims are the product's own screens and the site's line; no numbers that are not on screen.
- [x] Points only, labelled "points, not money"; no gambling words.
- [x] Fictional club and first-name-only players (no surnames); no real people.
- [x] No IPL/board/team marks, no other brands, original score, no AI imagery.
- [x] Gated on the hand-over fix being live in production.

## Replies for the first hour

| Comment | Reply |
|---|---|
| "Is it free?" | "Yes — the practice is free, and DesiAuction is free for up to 4 teams & 40 players. desiauction.in" |
| "Does practice change my real auction?" | "Nothing. Purses and players reset when it ends, and nothing reaches your season." |
| "How long does it take?" | "The practice card suggests about 10 minutes — enough for every owner to try a few bids." |
| Anything abusive | Hide. Never argue. |
