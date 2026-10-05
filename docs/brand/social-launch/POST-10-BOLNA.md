# Post 10 — "Bolna kisi ne?" · series *Kagaz wali boli* 3/6 · Sat 10 Oct 2026

> Series plan approved by the founder 2026-10-05; Reel built, awaiting final approval.
> Plan: [`SERIES-KAGAZ-WALI-BOLI.md`](SERIES-KAGAZ-WALI-BOLI.md).
> Rules: [`SOCIAL_CONTENT_PLAN.md`](../../operations/SOCIAL_CONTENT_PLAN.md) §1a, §1b.

**Why this:** the paper auction we studied had long stretches of dead air. "Bolna kisi
ne?" was asked again and again, and "ek baar… ek baar…" dragged on. The source league,
studio, place and people are never named, shown or clipped. This post is the light,
relatable one (pillar E): the joke is the situation, never a person.

The product fact behind it, checked in code: the engine owns the lot clock. When it
reaches zero, the engine closes the lot itself, sold to the highest bid
(`apps/engine/src/engine-core.ts`, `tick` → `_TimerClose`). In the capture, nobody
pressed the gavel. The end card is site copy, word for word: *"SOLD, without the shouting."*

## The Reel — 9:16, 14.0 s, payoff first

| Time | On screen | Caption on frame |
|---|---|---|
| 0.0–4.4 | **Animated paper** (drawn frame by frame, no footage), described below | (handwritten, on the page) |
| 4.4–5.6 | The real board: the player on the block at 20 pts, and the clock at **12** seconds | "Koi nahi poochta. **Ghadi chalti hai.** ⏱️" |
| 5.6–7.1 | The same board at **3**, **2**, **1** seconds, with the clock in red (real frames) | (same) |
| 7.1–9.0 | The stage at zero: SOLD · 20 pts · Sunday Strikers. Nobody pressed anything. | "Zero pe — **SOLD.** Apne aap." |
| 9.0–11.0 | DA strike (kit) | — |
| 11.0–14.0 | End card: "SOLD, without the shouting." · Free for up to 4 teams & 40 players. Points or rupees. · desiauction.in | — |

The animated paper (0.0–4.4 s), in order:
- "Bolna kisi ne?" (highlighted, on the page from frame one), then "Bolna kisi ne??", then a red "BOLNA KISI NE???".
- The band drops out, leaving a heartbeat and a riser.
- "Ek baar…" is written down the page, slower and fainter each time, while a doodled clock spins.
- "(10 minute baad…)", then the page tears away.

- **Real screens:** every product frame is a real screen from a points season on the local stack, captured by `capture-bolna.spec.ts`. Two owners bid, then nobody did, and the engine closed the lot at zero. Board and stage crops are cut with ffmpeg, never redrawn.
- **Labelling:** every frame is labelled *Demo auction · fictional players · points, not money*.
- **Score:** original (`score-ghar-ka.cjs`): the band goes silent for the dead air and comes back with a hit as the page tears.
- **Built files:** `reels/reel-10-bolna.mp4` (14.0 s, 1080×1920, H.264 + AAC) and `reels/reel-10-bolna-cover.jpg`.
- **Build:** `reels/build-reel-10-bolna.cjs` (`PREVIEW=1` renders paper stills only).

## Captions

**Instagram** (Facebook: same, plus the link line):
> Har auction mein aadha ghanta sirf "bolna kisi ne?… ek baar… ek baar…" mein jaata hai 😴
> DesiAuction mein ghadi chalti hai — zero pe SOLD, apne aap.
>
> Sahi kaha? 👇
> Demo auction · fictional players · points, not money
>
> #KagazWaliBoli #CricketAuction #GullyCricket #CricketLovers #DesiAuction

**YouTube Shorts:** `"Bolna kisi ne?… ek baar… ek baar…" 😴 #Shorts #KagazWaliBoli #DesiAuction`
**Threads** (video, topic DesiAuction): "\"Bolna kisi ne?… ek baar… ek baar…\" 😴 DesiAuction mein ghadi chalti hai — zero pe SOLD. desiauction.in #DesiAuction"
**X:** same as Threads + `#KagazWaliBoli` (two tags on X; more cuts reach).

Comment prompt (pinned first comment): "Aapke auction mein sabse lamba 'ek baar… ek baar…' kitni der chala tha? 😂 👇"

## When

Sat 10 Oct, **7:30 pm IST**: Instagram, Facebook, YouTube Shorts, Threads, X.
If a big cricket moment lands that day, the newsjack goes first and this slides a day (§1b rule 1).

## §1a check

- **Claims:**
  - The end-card line is site copy.
  - "Zero pe SOLD, apne aap" is what the engine does (verified in code and in the capture).
  - "Aadha ghanta" in the caption is a joke about paper auctions, not a product claim.
  - No setup times and no counts about the product.
- **Words:** no IPL, BCCI, betting words or competitor names.
- **People and places:** no real person, face, place or league. No one is mocked: the joke is the dead air.
- **Imagery and music:** real screens, no AI imagery. The music is our own score.
- **Hashtag:** #DesiAuction on every network.
