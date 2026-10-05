# Post 11 — "Ghar pe dekhne walon ka haal" · series *Kagaz wali boli* 4/6 · Sun 11 Oct 2026

> Series plan approved by the founder 2026-10-05; Reel built, awaiting final approval.
> Plan: [`SERIES-KAGAZ-WALI-BOLI.md`](SERIES-KAGAZ-WALI-BOLI.md).
> Rules: [`SOCIAL_CONTENT_PLAN.md`](../../operations/SOCIAL_CONTENT_PLAN.md) §1a, §1b.

**Why this:** the live chat of the paper auction we studied was full of viewers who could
not follow the night. Their complaints, paraphrased:
- the sound was unclear;
- "write the player's name and team";
- "show it team-wise";
- "who joined that team?".

The source league, studio, place, people and chat users are never named, shown, quoted
by name or clipped. The bubbles on our page are our own generic lines.

The product facts behind it:
- **Spectators need no account.** When a season is published, the watch link opens
  for anyone.
- **The squads are on the same page.**
- **The end-card lines are product words, word for word.** *"Spectators need nothing
  at all."* comes from the site FAQ. *"Anyone can watch — no account needed."* is the
  watch page's own line.

## The Reel — 9:16, 14.4 s, payoff first

| Time | On screen | Caption on frame |
|---|---|---|
| 0.0–4.4 | **Animated paper** (drawn frame by frame, no footage): the hook "Ghar pe live dekh rahe ho… **kuch samajh aaya?** 😵", a noisy live stream in a doodled phone and a pile of chat bubbles. Details below. | (handwritten, on the page) |
| 4.4–6.1 | A phone with **no account** on the watch link: the player on the block, current bid 30 pts, every bid listed | "Ek link — **koi account nahi.**" |
| 6.1–7.6 | The same phone: SOLD · 30 pts · Sunday Strikers | "Har bid, har **SOLD** — live." |
| 7.6–9.4 | The same page's Squads: each team, what it spent, who it bought | "Kaun kis team mein? **Sab dikhta hai.**" |
| 9.4–11.4 | DA strike (kit) | — |
| 11.4–14.4 | End card: "Spectators need nothing at all." · "Anyone can watch — no account needed." · Free for up to 4 teams & 40 players. Points or rupees. · desiauction.in | — |

The paper act, in order:
1. The hook is on the page from frame one, with a highlighter sweep.
2. A doodled phone shows a "● LIVE" stream where a jittering red "SHOR!!" fills the screen, with "🔊🔊🔊 ??" under it.
3. The chat piles up beside it, one bubble at a time: "awaaz nahi aa rahi 🔇", "naam likh do bhai 🙏", "meri team mein kaun aaya??", "kaun kis team mein gaya?? 😵".
4. The page tears away.

- **Captures:** every product frame is a real screen, captured by `capture-ghar-pe.spec.ts` on the local stack from a published points season. Two owners bid; the viewer's phone context never signs in.
- **Labelling:** every frame is labelled *Demo auction · fictional players · points, not money*.
- **Score:** our own (`score-ghar-ka.cjs`): a bell per chat bubble, then a "wah" at "meri team mein kaun aaya??".
- **Built files:**
  - `reels/reel-11-ghar-pe.mp4` (14.4 s, 1080×1920, H.264 + AAC)
  - `reels/reel-11-ghar-pe-cover.jpg`
- **Build script:** `reels/build-reel-11-ghar-pe.cjs` (`PREVIEW=1` renders paper stills only).

## Captions

**Instagram** (Facebook: same, plus the link line):
> Ghar se auction dekhna = sirf shor 🔊😵 "Naam likh do", "meri team mein kaun aaya?"…
> DesiAuction mein ek link bhejo — koi account nahi, har bid, har SOLD, har team ki squad live.
>
> Apne cricket WhatsApp group mein bhejo 👇
> Demo auction · fictional players · points, not money
>
> #CricketAuction #LiveAuction #GullyCricket #TournamentOrganiser #DesiAuction

**YouTube Shorts:** `Ghar se auction dekhna = sirf shor 🔊 Ek link, sab live #Shorts #DesiAuction`

**Threads** (video, topic DesiAuction):
> Ghar se auction dekhna = sirf shor 🔊 Ek link bhejo — koi account nahi, har bid live. desiauction.in #DesiAuction

**X:** same as Threads + `#CricketAuction`.

**Comment prompt** (pinned first comment):
> Aapke yahan auction live dekhte hain ya bas WhatsApp pe "kaun kahan gaya" puchte hain? 👇

## When

Sun 11 Oct, **7:00 pm IST** (Sunday-evening slot, §1b rule 7) on Instagram, Facebook,
YouTube Shorts, Threads and X.

If a big cricket moment lands that day, the newsjack goes first and this post slides a
day (§1b rule 1).

## §1a check

**Claims**
- "Koi account nahi" is true for a published season: the capture's viewer never signed in.
- The end card is product copy.
- There are no setup times and no counts.

**People**
- No real person, face, place, league or chat username appears.
- The bubbles are generic lines written by us, not quotes.
- Nobody is mocked: the joke is the noise.

**Brands**
- The watch page has our own "Share on WhatsApp" button text, but it isn't featured.
- No WhatsApp logo or UI is shown.

**Rest of the list**
- No IPL, BCCI, betting words or competitor names.
- Real screens and no AI imagery. The score is our own.
- #DesiAuction is on every network.
