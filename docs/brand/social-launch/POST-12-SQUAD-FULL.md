# Post 12 — "Do se zyada nahi le sakte bhai!" · series *Kagaz wali boli* 5/6 · Mon 12 Oct 2026

> Series plan approved by the founder 2026-10-05. On the same day the founder asked for the session to keep going "till post 6" is scheduled, so this reel was scheduled without a separate per-post approval. **The founder can review it and disable the task (Scheduled sidebar) before it fires.**
> Plan: [`SERIES-KAGAZ-WALI-BOLI.md`](SERIES-KAGAZ-WALI-BOLI.md). Rules: [`SOCIAL_CONTENT_PLAN.md`](../../operations/SOCIAL_CONTENT_PLAN.md) §1a, §1b.

**Why this:** in the paper auction we studied, a rule was enforced by shouting from the
stage ("aap do se zyada nahi bol sakte bhai", 1:59:59). The source league, studio, place
and people are never named, shown or clipped.

**The product facts behind it, checked in code:**
- The owner's bid button locks with the reason "Your squad is full" (`paddle-control.tsx`).
- The server refuses a bid from a full squad: `SQUAD_FULL` in `packages/core/src/auction.ts`.
- The end card is site copy, word for word: *"Every bid is checked on the server before it counts."*

## The Reel — 9:16, 14.3 s, payoff first

| Time | On screen | Caption on frame |
|---|---|---|
| 0.0–4.4 | **Animated paper.** Details below. | (handwritten, on the page) |
| 4.4–6.3 | Owner A's phone on the 3rd player: the locked button **"Your squad is full"**. A large callout shows the phone's own two lines: "Your squad is full / You can't buy any more players tonight." | "Squad full? **Button khud bolta hai.**" |
| 6.3–7.8 | A's team card: Squad **2/2** · "Your squad is complete." | "Rule app mein. **Mic ki zaroorat nahi.**" |
| 7.8–9.3 | Owner B's phone on the same player: "You're winning at 10 pts" | "Baaki teams? **Boli chalti rehti hai.**" |
| 9.3–11.3 | DA strike (kit) | — |
| 11.3–14.3 | End card: "Every bid is checked on the server before it counts." · Free for up to 4 teams & 40 players. Points or rupees. · desiauction.in | — |

**The paper act (0.0–4.4 s).** It is drawn frame by frame; there is no footage.
- From frame one, a red shaking "Do se zyada nahi le sakte bhai!! 📢".
- A list headed "TEAM A — max 2" fills in: two players ticked ✔, then a third written in anyway.
- The third player is struck out and a red **"NAHI!"** stamp lands.
- The argument starts: "Kisne kaha?? 😤", "Rule kahan likha hai?", "Pichli baar to liya tha!".
- The page tears away.

**Production notes**
- Every product frame is a real screen.
- Capture script: `capture-squad-full.spec.ts`.
- Capture setup: a points season on the local stack whose rules say squad min 1, max 2. Owner A bought two players and the third went up.
- Every frame is labelled *Demo auction · fictional players · points, not money*.
- The score is our own, from `score-ghar-ka.cjs`.

**Files**
- Reel: `reels/reel-12-squad-full.mp4` (14.3 s, 1080×1920, H.264 + AAC).
- Cover: `reels/reel-12-squad-full-cover.jpg`.
- Build script: `reels/build-reel-12-squad-full.cjs`. `PREVIEW=1` renders paper stills only.

## Captions

**Instagram** (Facebook: same, plus the link line):
> "Do se zyada nahi le sakte bhai!!" — aur phir aadha ghanta bahas 😤📢
> DesiAuction mein rule app mein hai: squad full ya purse khatam, toh bid lagegi hi nahi.
>
> Aapke auction ka sabse zyada tootne wala rule kaunsa hai? 👇
> Demo auction · fictional players · points, not money
>
> #CricketAuction #TournamentOrganiser #GullyCricket #LocalCricket #DesiAuction

**YouTube Shorts:** `"Do se zyada nahi le sakte bhai!!" 📢 Rule app mein #Shorts #DesiAuction`

**Threads** (video, topic DesiAuction):
> "Do se zyada nahi le sakte bhai!!" 📢 DesiAuction mein squad full ho toh bid lagegi hi nahi. desiauction.in #DesiAuction

**X:** same as Threads + `#CricketAuction`.

**Comment prompt** (pinned first comment):
> Aapke auction ka sabse zyada tootne wala rule kaunsa hai — squad size, purse, ya "ek player ek team"? 👇

## When

Mon 12 Oct, **7:30 pm IST** on Instagram, Facebook, YouTube Shorts, Threads and X.

## §1a check

**Claims**
- "Squad full ya purse khatam, toh bid lagegi hi nahi" is the product's behaviour. Both squad full and purse (`BUDGET_EXCEEDED`, "Past your budget") are enforced; checked in code.
- The end card is site copy.
- "Aadha ghanta bahas" is a joke about paper auctions, not a product claim.

**People and places**
- No real person, face, place or league; the list says "TEAM A".
- No one is mocked: the joke is the argument.

**Brands and words**
- No IPL, BCCI, betting words or competitor names.

**Visuals and sound**
- Real screens, no AI imagery.
- Our own score.

**Hashtag**
- #DesiAuction appears on every network.
