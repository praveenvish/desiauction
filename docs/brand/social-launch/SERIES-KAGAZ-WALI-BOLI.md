# Series: "Kagaz wali boli" — 6 posts

> 2026-10-05 · status: **PLAN — needs founder approval before production.**
> Source: one full paper-and-placard player auction (a real local league, live on
> YouTube, 2h17m transcribed + its live chat). **The league, studio, village,
> players and viewers are never named, shown, quoted by name or clipped.** We use
> the *problems*, not their footage — every visual is ours (real DesiAuction
> screens + text), every line passes `docs/operations/SOCIAL_CONTENT_PLAN.md` §1a.

## What we actually saw (the evidence behind each post)

| # | Problem in the paper auction | When (stream) |
|---|---|---|
| A | Players drawn by **parchi**; owners raise a **takhti** (placard); auctioneer counts every bid aloud, one point at a time — 1, 2, 3 … 50 for a single player | from 00:30, all night |
| B | **"Bolna kisi ne?"** asked over and over — long dead air; "ek baar… ek baar… ek baar…" dragged out | 01:29, 54:00, many |
| C | **Count goes backwards** — "…49, 50, 45, 45, 46…" — then "ek saath? … yahan check kar rahe ho" — two takhtis at once, nobody sure who was first | 01:55:20–01:56:09 |
| D | **"Kitne point bache?"** — the stage asks teams their points out loud; points left read by hand ("12 point baaki, 13 point baaki") | 01:28, 01:49, 01:52, 02:13 |
| E | **Rules shouted, not enforced** — "aap do se zyada nahi bol sakte bhai" | 01:59:59 |
| F | **Home viewers lost** — chat: "awaaz samajh nahi aa rahi", "naam aur team likh do", "team-wise chalao", "uski team mein kaun aaya?" | chat 10:27–11:30 PM |
| G | **Suspicion** — chat: "sab fix khiladi hain", "mamla sabka set hai" | chat 10:39–10:40 PM |

Every one of these maps to something DesiAuction does today (checked in code, 2026-10-05):
server bid gauntlet incl. purse / reserve / squad-full / role limit
(`packages/core/src/auction.ts`), purse board (`auction/board`), public watch link
(`auction/spectate`), stream overlay (`auction/overlay`), append-only ledger + replay.

## The series

**Name on screen:** *"Kagaz wali boli"* — episode tag `1/6`…`6/6` top-right on every cover
(series tags make people follow for the next one).
**Format rules (§1b):** payoff in the first second, 7–15 s, words readable on mute,
one idea each, Hinglish, logo only at the end, one ask per post.
**Look:** the paper beat = off-white, crumpled-paper texture, handwritten marker
type; the DesiAuction beat = the real ink-and-gold screen. The cut from paper to
screen *is* the story. Real screens only (`reels/capture-demo.cjs`, fictional demo
names, labelled "Simulated demo · fictional players").
**Never:** the league's name/footage/audio, any real player or viewer name, the word
"fix"/"setting" as an accusation of anyone, IPL/BCCI, betting words, numbers we
didn't measure (no "saves 2 hours").

---

### 1/6 · "50… 45… ruko, kaun bola pehle?"  (Reel · pillar C) — **strongest hook, goes first**

- **0.0 s (frame 1):** marker text slams in: **"50… 45… 46…??"** + under it **"Ruko. Kaun bola pehle?"**
- **1–5 s:** two hands raise two paper takhtis at the same instant (prop shot, hands only — no faces), the numbers scribble and cross out.
- **5–11 s:** hard cut to two phones tapping Bid together → the big screen shows **one** leader, the other phone reads *"Someone has already bid that much or more."* (real copy).
- **11–14 s:** line: **"The server checks every bid, not the loudest voice."** → DA mark, #DesiAuction.
- **Caption:** `Do takhti ek saath uthi. Ab kaun pehle? 😅 Aapke auction mein yeh jhagda kitni baar hua? 👇 #DesiAuction #CricketAuction #GullyCricket #LocalCricket`
- **Ask:** comment — "Aapke yahan kitni baar hua?"

### 2/6 · "Bhai, kitne point bache?"  (Reel · pillar D)

- **0.0 s:** text **"Auction ke 2 ghante baad…"** → **"Bhai, kitne point bache?" 🤯**
- **1–6 s:** a notebook page full of crossed-out totals, a calculator, a pen tapping.
- **6–12 s:** cut to the real big-screen board — every team's purse and squad on one screen, updating after a SOLD.
- **12–14 s:** line: **"Every squad and what it paid, from the auction's record."** → DA mark.
- **Caption:** `Hisaab copy mein, ya screen pe? Har team ka purse sabke saamne — live. Woh dost tag karo jo har saal hisaab rakhta hai 📒 #DesiAuction #CricketAuction #TournamentOrganiser`
- **Ask:** tag the friend who keeps the hisaab. *(The tag-a-person ask is our best share driver.)*

### 3/6 · "Bolna kisi ne? … Bolna kisi ne?"  (Reel · pillar E — the culture one)

- **0.0 s:** text **"Bolna kisi ne?"** · 1 s · **"Bolna kisi ne?"** · 1 s · **"BOLNA KISI NE??"** (growing, with a clock ticking sound).
- **3–8 s:** text **"Ek baar… ek baar… ek baar… ek baar…"** stacking down the screen.
- **8–12 s:** cut to the real lot clock running down → SOLD on the big screen.
- **12–14 s:** line: **"SOLD, without the shouting."** → DA mark.
- **Caption:** `Har auction mein ek ghanta sirf "ek baar… ek baar…" mein jaata hai 😂 Sahi kaha? #DesiAuction #CricketAuction #GullyCricket`
- **Ask:** "Sahi kaha?" (agree/disagree comments). Light, relatable — no one mocked; the joke is the situation.

### 4/6 · "Ghar pe dekhne walon ka haal"  (Reel · pillar A)

- **0.0 s:** a phone showing a stream with chat bubbles popping (our own mock, generic text, no usernames): **"awaaz nahi aa rahi"**, **"naam likh do"**, **"meri team mein kaun aaya??"**
- **4–10 s:** cut to the same phone opening one watch link → current player, live bid, every team's squad.
- **10–14 s:** line: **"Spectators need nothing at all."** (FAQ copy: no app, no account) → DA mark.
- **Caption:** `Ghar se auction dekhna = sirf shor 🔊 Ek link bhejo — poore gaon ko dikhega kaun kis team mein gaya. #DesiAuction #CricketAuction #LiveAuction`
- **Ask:** "Apne WhatsApp group mein bhejo."

### 5/6 · "Do se zyada nahi le sakte bhai!"  (Reel · pillar C)

- **0.0 s:** text **"Do se zyada nahi le sakte bhai!!"** in big shouting marker.
- **2–9 s:** cut to an owner's phone: tap Bid → *"Your squad is full."* / *"That would take you past your remaining purse."* (real copy) — the bid never counts.
- **9–13 s:** line: **"Every bid is checked on the server before it counts."** → DA mark.
- **Caption:** `Rule yaad dilane ke liye mic nahi chahiye. Purse khatam? Squad full? Bid lagegi hi nahi. #DesiAuction #CricketAuction #TournamentOrganiser`
- **Ask:** "Aapke auction ka sabse zyada tootne wala rule kaunsa hai?"

### 6/6 · "Kagaz wali boli vs DesiAuction"  (Carousel · recap + CTA)

Slides (paper left, screen right on each):
1. **Cover:** "Kagaz wali boli ki 5 problems. Aapke auction mein kitni hain?"
2. Kaun bola pehle? → *The server checks every bid, not the loudest voice.*
3. Kitne point bache? → *Every squad and what it paid, from the auction's record.*
4. Bolna kisi ne? → *SOLD, without the shouting.*
5. Ghar pe kuch samajh nahi aaya → *Spectators need nothing at all.*
6. Rule kisne toda? → *Every bid is checked on the server before it counts.*
7. **Trust slide:** *"Receipts on a ledger nobody can edit — including us."* (answers "sab set hai" without accusing anyone)
8. **CTA:** *"Your auction has one take. Rehearse it tonight — free."* · desiauction.in (`?utm_source=<network>`) · *Free during beta · always free for up to 4 teams and 40 players*
- **Caption:** `Save karo — auction se pehle organiser ko bhejna 📌 Kitni problems aapke yahan hoti hain? 1–5 likho 👇 #DesiAuction #CricketAuction #TournamentOrganiser #GullyCricket`
- **Ask:** save + "1–5 likho".

---

## Schedule (proposal — founder decides)

Mon 5 (post-06) and Tue 6 (post-07) are already scheduled; Wed 7 is the Founding 25 call.

| Day | Post | Time (IST) |
|---|---|---|
| Thu 8 Oct | 1/6 Kaun bola pehle? | 19:30 |
| Fri 9 Oct | 2/6 Kitne point bache? | 19:30 |
| Sat 10 Oct | 3/6 Bolna kisi ne? | 19:30 |
| Sun 11 Oct | 4/6 Ghar pe dekhne walon ka haal | 19:00 |
| Mon 12 Oct | 5/6 Do se zyada nahi | 19:30 |
| Tue 13 Oct | 6/6 Carousel recap + CTA | 19:30 |

If a big cricket moment lands that day, the newsjack goes first and the series slides a day (§1b rule 1).
Reels go to IG / FB / YT Shorts; Threads/X get the hook line as text + the reel.
Measure each next day (3-s hold, shares, comments) and keep the strongest hook style for 4–6.

## Production checklist (after approval)

- [ ] Capture real screens: two-phone simultaneous bid, purse board, lot clock → SOLD, spectate link on a phone, squad-full / purse rejection.
- [ ] Prop shoot: two takhtis, a notebook of crossed-out totals — hands only, no faces, no location.
- [ ] Mock stream-chat overlay with generic text, no usernames.
- [ ] Label: "Simulated demo · fictional players" on every screen shot.
- [ ] Music from Instagram's commercial library only.
- [ ] #DesiAuction in every caption (Threads: self-reply if the topic slot is used).
