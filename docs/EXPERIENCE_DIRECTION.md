# EXPERIENCE DIRECTION
## The Experiential Constitution of DesiAuction Next

> Executive Product Design Council · v1.0 · 2026-07-11
> **Authority:** This document sits directly beneath the Canon (00) and above every design and UX document (05, 11, 15, 19–35). Where they conflict, this document wins and they are amended. Every future screen must be traceable to this document; a screen that cannot justify itself here is wrong — however well it is built.
> **Relation to Phase 0B:** §12's tests refine the protocols of VA-1, VA-2 and VA-4 in `docs/phase-0b/EVIDENCE_PLAN.md`. This document is itself a hypothesis until those activities pass; it is written so it can *fail a test*, which is what makes it worth writing.

---

# 1 · PRODUCT SOUL

In a hundred small towns, on one night a year, a community carries plastic chairs into a hall, points a projector at a wall, and holds an IPL of its own. Two hundred people watch eight of their neighbours spend real money on their sons, brothers, colleagues and friends. A boy who bowls off-spin after his shift hears his name called out in front of everyone he knows. This night matters more to the people in that room than most software has ever mattered to anyone.

Today that night runs on Excel, WhatsApp forwards, shouting, and memory. The money is real but the record is not. The theatre is real but the machinery undermines it — a laptop screen squinted at, a formula error, an argument between neighbours about who bid what. The most important night in a community's sporting year is administered like a grocery list.

**DesiAuction exists to take that night as seriously as the people in the room take it.**

That is the soul, and every persona receives it as the same gift in a different form:

- The **organizer** — a volunteer with a day job — is taken seriously: their event runs like a broadcast, and at the end of the night they exhale instead of apologizing.
- The **player** is taken seriously: their name, in lights, in front of everyone, with a record that proves it happened.
- The **owner** is taken seriously: their money moves with the gravity of real money — exact, receipted, beyond dispute.
- The **community** is taken seriously: their tournament *looks real*, and therefore is real.

**What feeling should remain after using it?** One word: *legitimacy.* "That was real. It was handled. I was part of something run properly." The organizer's version is pride; the player's version is dignity; the owner's version is certainty.

**If DesiAuction disappeared tomorrow, what would people miss?** Not features. They would miss the exhale. They would miss the screenshot of the moment a name went up in gold. They would miss bidding without fear of a spreadsheet error. And within one season, the arguments would come back — that is the proof the product mattered.

The soul in one sentence, for citation: **⟪SOUL⟫ — DesiAuction is the experience of being taken seriously.**

---

# 2 · EXPERIENCE PRINCIPLES

Fourteen immutable principles. Cite them as **EP-1 … EP-14**. Each carries meaning, reason, example, anti-pattern.

**EP-1 · Calm is the operator's birthright.**
*Meaning:* Every administrative and conduct surface is engineered to lower the heart rate of the person responsible. *Reason:* The organizer is a volunteer under social pressure; their calm is the product's first deliverable (the Exhale beat, 04). *Example:* The Cockpit shows one decision at a time with its consequences stated; the registration queue says "41 approved · 12 pending" — never a wall of red. *Anti-pattern:* badge counts, blinking alerts, competing panels shouting for attention.

**EP-2 · Electricity is earned by the moment, never manufactured by the interface.**
*Meaning:* Excitement comes from real stakes rendered honestly — a real countdown, a real duel, a real name. *Reason:* Manufactured urgency is a lie, and this product's entire moat is that it does not lie (invariant 31). *Example:* The countdown compresses because the rules say so (anti-snipe), not because a designer wanted tension. *Anti-pattern:* fake scarcity, pulsing CTAs, "3 people are viewing this."

**EP-3 · The screen is the referee.**
*Meaning:* Trust is visible, not promised: every number can explain itself, and provenance is one gesture away. *Reason:* The product replaces arguments between neighbours; it can only do that if truth is inspectable at the moment of doubt. *Example:* Tap a team's purse → the exact purchases that compose it. Every receipt carries an ID a human can read aloud. *Anti-pattern:* aggregate numbers with no path to their parts; "contact support to verify."

**EP-4 · One thing matters at a time.**
*Meaning:* Every view has exactly one subject; the interface always answers "what matters right now." *Reason:* The auction is a sequence of single moments; the admin's life is a queue of single decisions. Splitting attention manufactures anxiety. *Example:* The Stage shows one lot. The Console home leads with one next action. *Anti-pattern:* the twelve-widget dashboard; two simultaneous focal points.

**EP-5 · Motion is speech.**
*Meaning:* Every animation states a fact — origin, causality, consequence, permanence. If it states nothing, it does not exist. *Reason:* In a live money environment, decoration is noise and noise is doubt. *Example:* A raised bid *rolls* the number upward — the price travelled, it didn't teleport. *Anti-pattern:* bounces on cards, confetti on trivia, hover dances.

**EP-6 · Money moves like stone.**
*Meaning:* Anything touching money feels heavier than everything else: more deliberate entry, weightier confirmation, stiller aftermath. *Reason:* Weight communicates irreversibility better than warning text ever has. *Example:* A crore-scale bid asks for a held press, not a tap; a completed sale settles into stillness. *Anti-pattern:* one-tap irreversibles; playful microcopy on payment screens.

**EP-7 · Dignity is non-negotiable.**
*Meaning:* Every human is rendered with respect in every state — unsold, rejected, disconnected, erroneous. *Reason:* The product handles people's public standing in their own community; the unsold player's father is in the hall (C-23, invariants 6–7). *Example:* UNSOLD renders as a neutral fact and the moment moves on; rejection reasons are private forever. *Anti-pattern:* red X on a person; "unsold players" lists; comic error mascots at serious moments.

**EP-8 · Nothing important happens silently; nothing unimportant makes noise.**
*Meaning:* Commitments are announced; chrome is mute. *Reason:* Users calibrate trust by the interface's honesty about significance — a product that celebrates everything can vouch for nothing. *Example:* A sale is announced on every surface simultaneously; a draft autosave says nothing at all (it just never loses data). *Anti-pattern:* toast storms; silent failures (the constitutional opposite: 56).

**EP-9 · Waiting is honest.**
*Meaning:* Every wait states what is happening, and the form of the wait matches the truth of the work. *Reason:* Users forgive latency; they never forgive deception about it. *Example:* "Confirming with the bank…" during payment; a skeleton only where content truly loads. *Anti-pattern:* infinite spinners; fake progress bars; optimistic UI on money (forbidden — mutation classes, 15).

**EP-10 · The product recovers louder than it fails.**
*Meaning:* Failure is rendered composed and specific; recovery is a visible ceremony of order restored. *Reason:* The owner-reconnection beat (04): the moment after a dropped connection is where trust is won or lost forever. *Example:* On reconnect, the Owner Room *narrates* its resync — "Rejoined · your purse ₹42L · you lead Lot 23" — before accepting input. *Anti-pattern:* silent state repair; a generic "something went wrong" during a live auction.

**EP-11 · Ceremony belongs to people, not the product.**
*Meaning:* At every peak, the brand recedes and a human's name takes the light. *Reason:* The memory we are building is "my name in lights," not "what a cool app." Products that celebrate themselves are forgotten; products that celebrate their users are remembered. *Example:* The SOLD ceremony is the player's name, the team, the amount — no logo animation, no "powered by." *Anti-pattern:* brand splash at emotional peaks; app-centric celebration copy ("We did it!").

**EP-12 · Every ending is a beginning.**
*Meaning:* Completion states always point forward — receipt → share → squad → season → next season. *Reason:* The business grows by second tournaments (02); the emotional arc must land, not stop. *Example:* Auction completion produces the reconciliation receipt *and* the shareable squads *and* "fixtures await." *Anti-pattern:* dead-end success screens; "Done." with nowhere to go.

**EP-13 · Familiar hands, extraordinary night.**
*Meaning:* Everyday administration uses patterns people already know, executed perfectly; novelty is a budget spent only on the moments that deserve it (§10). *Reason:* Novelty everywhere is noise and training cost; novelty at the peak is memory. A volunteer must never need a manual. *Example:* Forms behave like the best forms anywhere (29); the ceremony behaves like nothing else in the category. *Anti-pattern:* reinvented date pickers; a "creative" settings page; equal drama for all events.

**EP-14 · Silence is designed.**
*Meaning:* What the interface refuses to show is a decision, recorded like any other. Negative space, quiet periods, and the absence of notifications are deliberate artifacts. *Reason:* Calm (EP-1) is produced by subtraction; density is the default failure mode of enterprise software. *Example:* Between auction events the Stage rests — dark, composed, patient. The product sends nothing between tournaments. *Anti-pattern:* filling space because it exists; re-engagement email; "we miss you" notifications.

---

# 3 · EMOTIONAL MAP

For each surface: the emotion we design *for*, the emotion we design *against*, the confidence the user must hold ("what they must never doubt"), the cognitive-load ceiling, and the energy the surface projects (still / level / rising / peak).

| Surface | Desired emotion | Undesired emotion | Must never doubt | Load ceiling | Energy |
|---|---|---|---|---|---|
| Landing / first contact | Intrigued respect — "this is serious" | Suspicion of vaporware | That real tournaments run here | Low | Level |
| Login (OTP) | Frictionless recognition | Bureaucratic annoyance | That they'll get in | Minimal | Still |
| Console Home | Oriented command — "I know my next move" | Overwhelm, guilt backlog | What needs them today | Low | Level |
| Tournament creation | Momentum — "it's taking shape" | Form fatigue | That nothing entered is lost | Medium | Rising gently |
| Registration (player) | Welcome + hope — "I'm entering something real" | Feeling processed | That their entry was received | Minimal | Level |
| Registration triage (organizer) | Flow-state efficiency | Drudgery | That approvals are fair and recorded | Medium | Level |
| Owner Room · pre-auction | Prepared anticipation — studying the pool | Anxiety about the tool | Their purse and the rules | Medium | Rising |
| Owner Room · live bidding | Agency under pressure — "my thumb is enough" | Fear of mis-tap, FOMO panic | That their bid was received and their purse is exact | Low (by force) | Peak |
| Cockpit | Held control — a pilot, not a firefighter | Racing, juggling | What state the auction is in | Low (by force) | Level under peak |
| Stage (hall / public) | Collective spectacle — "our IPL" | Squinting at a spreadsheet | Who's up, what's bid, what just happened | Minimal | Rising → peak |
| SOLD ceremony | Shared elation, pride | Embarrassment, anticlimax | That it's final and recorded | Zero | **Peak** |
| Team management | Stewardship — tending a squad | Data-entry tedium | Squad legality and budget truth | Medium | Level |
| Match day / results entry | Matter-of-fact reliability | Ceremony fatigue (not every day is auction night) | That the score entered is the score kept | Medium | Level |
| Standings | Settled authority — the table *is* the truth | Suspicion of manipulation | That standings derive from results, untouched | Low | Level |
| Reports / exports / receipts | Documentary certainty | "Will this hold up?" | Provenance | Low | Still |
| Settings / billing | Unremarkable competence | Dread | What they're paying and what they own | Low | Still |
| Audit / history | Sober transparency — the ledger room | Forensic intimidation | Completeness | Medium | Still |

Two structural truths from this map: the product runs at **two temperatures** — the office (still/level: console, settings, reports) and the stadium (rising/peak: Owner Room, Stage, ceremony) — synchronized by one truth (invariant 12). And the *lowest* cognitive-load ceilings sit exactly where stakes are *highest* (bidding, ceremony): pressure pays for simplicity, never for density.

---

# 4 · EXPERIENCE ARC

The product's tempo tracks the tournament's own emotional calendar. Administration is the long level valley; auction night is the crescendo; completion is the warm-down; return is recognition.

**Landing → first login.** Curiosity, answered with seriousness. The first five seconds carry the North Star ("unlike any tournament platform"); the next thirty prove it's operable by a volunteer. Emotion: *intrigue resolving into respect.* Nothing is asked of the visitor before something is shown.

**First tournament.** The organizer's private leap — they have told their community something will exist. The product's job is *competence transfer*: each setup step visibly assembles the event (teams take shape, the pool fills, readiness lights up), so the organizer's confidence grows with the object they're building. Emotion: *anxiety converting to momentum.* The gate checklist (44) is experienced not as bureaucracy but as a pre-flight — evidence they will not be embarrassed.

**First registration.** The event becomes real because *strangers now touch it.* The organizer watches entries arrive — each one a small social proof. The player, meanwhile, gets the product's first gift to a non-payer: a dignified entry ("You're in the pool for Sitapur Premier League") and a status page that respects them. Emotion: *organizer pride, player hope.*

**The approach.** The week before auction night, energy is allowed to rise: the countdown exists, owners assemble, the pool locks with a satisfying finality. The product mirrors anticipation without amplifying anxiety — the organizer's surfaces stay level even as the public surfaces warm up. This divergence — *calm inside, electric outside* — is the arc's signature manoeuvre.

**First auction.** The crescendo, in movements: the room assembles (presence fills) → first lot (the hall hushes) → duels (energy oscillates, safely, because every peak resolves into a recorded fact) → the held breath (countdown) → **SOLD** (release, gold, a name) → and again, sixty times, each cycle building the room's trust that the machine holds. The organizer's inner experience must remain *held control*; the room's must be *rising spectacle.*

**Player sold.** The single most important emotional event in the product (04, beat 1). One human's public peak. Everything else on every surface yields.

**Tournament completion.** The exhale. Totals reconcile publicly; receipts issue; squads stand assembled. Emotion: *closure with pride* — the product performs the reconciliation visibly so the organizer's competence is witnessed, not assumed. Then the arc points forward (EP-12): fixtures, the season, the record.

**Awards & the album.** The season closes into an artifact — standings final, moments kept, the archive as a community's yearbook. Emotion: *belonging, permanence.* "We were here, and it's written down."

**Return, next season.** Recognition, not onboarding. The product remembers — the organizer's past events, returning players, last year's champions — and says so. Emotion: *homecoming.* The second tournament must feel like *continuing*, not starting over; this single feeling carries the business model (02).

---

# 5 · BRAND MEMORY

**After five minutes**, three memories: (1) *"It feels like broadcast, not software"* — the first-light impression; (2) *"I always knew what was happening"* — state is never in doubt; (3) *the gold moment* — they saw, or imagined, a name go up.

**After one week:** the receipt that ended an argument before it started; the recovery moment ("the Wi-Fi dropped and nothing was lost — it *told me* what I'd missed"); the memory of their own name or their team's night. Note what is absent: nobody remembers a form, a table, or a settings page — by design, those were *unremarkable* (EP-13).

**After one year:** DesiAuction is *the way a real tournament is run* — a standard, not a tool. The memory anchors are all human moments the product framed: the name in lights, the exhale, the season album. The brand is remembered as the *venue* of those memories, the way a stadium is remembered — present in all of them, the subject of none (EP-11).

---

# 6 · EXPERIENCE DIFFERENTIATORS

Compared as experiences, not features:

| Product | Learn from it | Deliberately avoid |
|---|---|---|
| Linear | Conviction: opinionated defaults, speed as respect, keyboard as first-class citizenship | Its uniform emotional flatness — Linear is cool everywhere; our peaks must be *hot* |
| Stripe | Money rendered exact: receipts as artifacts, documentation as trust | Its developer-first austerity toward non-technical users — our organizer is a volunteer |
| Notion | Approachability without childishness; empty states that teach | Infinite flexibility — we are opinionated; a tournament is not a blank canvas |
| Raycast | Latency as a feeling; the product seems to *want* to help | Power-user opacity; hidden capability our volunteer would never find |
| Arc | Personality and warmth in chrome | Whimsy near money; personality that upstages the user's own event |
| Framer | Motion literacy — animation that explains | Motion as showroom; movement that exists to impress designers |
| Figma | Multiplayer presence as social warmth (the room assembling) | Interface density that assumes a professional operator |
| Vercel | The confidence of restraint; dark surfaces that feel engineered, not styled | Aesthetic minimalism so complete it reads cold to a non-technical audience |

**Unmistakably its own — three things no reference product has:**
1. **Two temperatures, one truth.** A calm office and an electric stadium in one product, never disagreeing on a number (invariant 12). No SaaS reference runs both; broadcast does — our true benchmark at the peak is *sports television*, not software.
2. **The ceremony of names.** A product whose signature moment renders *a person*, in their own community, at their peak — with typographic and motion investment no enterprise product spends on a human being.
3. **Visible trust.** The referee-screen (EP-3): provenance one gesture away, receipts people quote, recovery that narrates itself. Competitors show data; DesiAuction shows *why the data is beyond argument.*

---

# 7 · VISUAL PHILOSOPHY

No colors, no typefaces — those are FLOODLIGHT's to propose (05/08/09) and VA-1's to prove. This section governs how any visual language must *behave*:

- **Density.** Two densities, by temperature. Office surfaces are information-dense but *rhythm-regular* — rows breathe at a constant cadence, and density never exceeds the emotional-map ceiling. Stadium surfaces are radically sparse: one subject, held by darkness. There is no medium-density surface; ambiguity of temperature is a design failure.
- **Rhythm.** Spatial cadence is constant within a surface — equal intervals, aligned edges — so that any break in rhythm *is information* (EP-5 in space instead of time).
- **Contrast.** Extreme contrast is a currency reserved for meaning: money, verdicts, the live thing. Everything else lives in the middle range. If everything is bold, the gavel is whispering.
- **Hierarchy.** One primary per view (EP-4), rendered so decisively that a viewer three metres from a projector knows what matters. Hierarchy is established by size, light and position — never by decoration.
- **Silence & negative space.** Darkness and emptiness are the stadium around the floodlit pitch: they are not unused space, they are *the frame that creates the spectacle.* On office surfaces, white space is the exhale between decisions.
- **Focus.** Light follows meaning. Where the user must look is where the interface is brightest/highest-contrast; focus moves only when meaning moves.
- **Tempo & momentum.** The office runs at a steady walking pace — nothing lunges. The stadium is allowed acceleration: rising energy through the lot cycle, a held beat at the countdown's end, release at SOLD, then a full stop — stillness — before the next lot. The interface *breathes*: office = slow and even; stadium = inhale (bidding), hold (countdown), exhale (ceremony), rest (interstitial).

---

# 8 · INTERACTION PHILOSOPHY

- **How interactions begin:** from stated intent, with consequences declared before commitment. Every affordance answers "what will happen if I do this" *at rest* — the bid button shows the amount it will bid; the approve button names the person it approves. Nothing significant begins from an icon whose meaning must be guessed.
- **How they progress:** with continuous, proportional feedback; interruptible up to the commitment point, which is always explicit and always *feels* like a threshold (EP-6). The user can always tell which side of commitment they are on.
- **How they conclude:** with an artifact. Every consequential interaction ends in a thing that exists — a receipt, a recorded state, a visible new fact — not merely a message that something happened (EP-3, EP-8).
- **How errors behave:** composed, specific, next-step-bearing, and dignified (EP-7): what happened, what it means for *you*, what to do, and a reference a human can read aloud to another human. Errors never blame, never joke at serious moments, and never move (stillness = seriousness, §9).
- **How confirmations behave:** on a ladder proportional to consequence (25/28): trivial acts confirm silently by working; significant acts confirm visibly; irreversible money acts demand weight — deliberate gestures, stated consequences, a beat of friction that reads as *respect for the stakes*, not obstruction.
- **How loading behaves:** honestly, in three kinds — *instant* (imperceptible, the default ambition), *shaped* (skeletons only where real content will land), *narrated* (long waits explain themselves and keep the user's place). Loading never lies (EP-9), and money never renders optimistically.
- **How success feels:** for routine work — quiet competence, barely a ripple (the work itself proceeding is the feedback). For milestones — earned ceremony, scaled to the §10 register. The product's praise is rare enough to mean something.
- **How failure feels:** contained. The failure of a part is visibly not the failure of the whole (invariant 19): the interface shows what still stands — "bidding continues; photos will catch up." The user should feel the system *absorbing* the blow, not sharing their panic.
- **How waiting feels:** informed and held. What, why, roughly how long, and what remains safe meanwhile. A user who waits knowing is calm; a user who waits guessing is already composing their complaint.
- **How confidence is reinforced:** by determinism (same act, same result, every time), by visible state (never wondering "did that work?"), by reversibility wherever truth permits (and honest weight where it doesn't), and by receipts. Confidence is compound interest: every kept promise raises the credibility of the next screen.

---

# 9 · MOTION PHILOSOPHY

Motion is speech (EP-5). Duration is proportional to **meaning, not size** — acknowledgements are instant, transitions are brief, ceremonies alone may take time. Numbers live in 11; this section governs intent. Reduced-motion is an equal citizen: every meaning expressed by motion must have a non-motion channel.

| Motion | Purpose | Emotion | Duration philosophy | When it must NOT exist |
|---|---|---|---|---|
| Entrance | Declare origin — where did this come from | Orientation | Brief; content never waits on it | Dense lists; anything mid-decision |
| Exit | Declare destination — where did it go | Closure | Briefer than entrance | Errors (they don't leave; they resolve) |
| State transition | Show causality — this *became* that | Comprehension | Just long enough to read the causality | When state changes faster than motion could honestly track |
| Number change (money) | The value travelled, it didn't teleport | Exactness | A roll, not a spin | Never absent for money — a money value never blinks into place |
| Countdown | Make compressed time *felt* | Held breath | Continuous, honest to the second | Never theatricalized beyond the true clock (EP-2) |
| SOLD ceremony | Release + permanence: the record is written | Elation → settled pride | The one licensed spectacle; ends in complete stillness = finality | Never during dispute/freeze states; never diluted by adjacent motion |
| Selection | Acknowledge the hand | Being heard | Perceptibly instant | — |
| Hover | Whisper an invitation | Curiosity | Sub-perceptual | Touch contexts; live money surfaces (no flirting near the gavel) |
| Drag | Physical honesty — the thing is in your hand | Control | Tracks the finger exactly | When drop targets can't be honest about validity |
| Loading | Calm persistence | Patience | Steady; never frantic | Never faster than truth (fake progress) |
| Completion | Settle, don't bounce | Restedness | Short settle into stillness | After failures (nothing "completes") |
| Recovery / resync | Order restored, visibly and narratively | Relief → renewed trust | Deliberately *unhurried* — composure is the message | Never silent (EP-10) |

The stillness rule: **the most serious states — errors, freezes, verdicts — do not move.** In a product where motion means life, stillness means gravity.

---

# 10 · SIGNATURE MOMENTS

The ten moments that make people remember DesiAuction, and the psychology of each. The **novelty budget** (EP-13) is spent here and almost nowhere else.

1. **First Light** — the first five seconds of the first screen. *Why:* primacy effect; the "unlike anything" verdict forms before a single click and colors every later judgment.
2. **The Gates Open** — the tournament goes public; the organizer holds a real, shareable thing. *Why:* the moment private intention becomes public commitment — the product must make the organizer feel *backed*, not exposed.
3. **"You're In"** — a player's registration lands; their status page exists. *Why:* the product's first gift to its largest audience; belonging begins here, and it costs the player nothing.
4. **The Room Assembles** — owners accept, presence fills in, the auction becomes peopled. *Why:* social proof turns a scheduled event into an *occasion*; anticipation is communal.
5. **First Lot on the Block** — the hall hushes; the machine everyone doubted holds. *Why:* first proof under load; the room's trust in the night is won in this minute.
6. **The Duel** — two owners trade bids; the leader flips; the room reacts. *Why:* this is the sport inside the product — safe conflict, resolving into recorded fact (EP-2).
7. **The Held Breath** — the countdown's final seconds; the anti-snipe extends; time itself is honest. *Why:* peak arousal, and simultaneously peak rule-visibility: excitement and fairness in the same gesture — the whole thesis in five seconds.
8. **SOLD** — gold, a name, a team, an amount; then stillness. *Why:* the peak-end rule says the night is remembered by its peaks and its ending; this is the peak, engineered to be photographed. It belongs to the player (EP-11).
9. **The Exhale** — completion: totals reconcile in public, receipts issue, squads stand. *Why:* the ending the peak-end rule pairs with the peak; the organizer's competence is *witnessed*; closure without dispute is the product's promise kept in one screen.
10. **The Album & The Return** — the season archived as a community's yearbook; next season greeted by name. *Why:* memory made durable, and the loop closed — recognition converts a user into a returning citizen, and a second Pass into the natural next act (02).

---

# 11 · EXPERIENCE ANTI-PATTERNS

What the product must never become — each with the reason it's fatal here specifically:

1. **A corporate dashboard.** Twelve widgets of equal weight = zero answers to "what matters now" (EP-4). Our user is a volunteer, not an analyst.
2. **A Bootstrap admin / template product.** The five-second verdict (North Star) dies instantly; the strategy *is* that first impression (01/02).
3. **A spreadsheet UI.** The product exists because the spreadsheet failed this community — resembling it surrenders the founding argument.
4. **A CRUD application.** Entities-first thinking produces forms-first screens; our screens are moments-first (this document, §3).
5. **A form-first experience.** Forms are how data enters, never what a surface *is about*; the wizard serves the tournament taking shape, not the schema.
6. **Notification spam.** Every unnecessary message spends the trust that OTPs and receipts require (EP-8, EP-14); attention is the community's, not ours.
7. **Animation as decoration.** Motion that says nothing teaches users to ignore motion — and then the motion that *matters* (state, recovery, ceremony) goes unread (EP-5).
8. **Visual noise.** Contrast spent on chrome is contrast unavailable for the gavel (§7).
9. **Dark mode because it looks cool.** Our darkness is the stadium's — contextual, purposeful (C-4); fashion-darkness would make the office surfaces strain volunteers' eyes over long triage sessions.
10. **Gamification.** Points, streaks, badges — the sport is the game; the app is the referee and the stage. Gamifying the referee destroys its authority (EP-3).
11. **Manufactured urgency.** Constitutionally banned (invariant 31); a single fake countdown would poison every real one.
12. **Engagement traps.** The product must be *closable* (EP-14): success is the night going perfectly and the app being shut until match day. Retention comes from memory and legitimacy, not from hooks.
13. **Enterprise theater.** Empty "governance" screens, decorative org charts, settings nobody needs — seriousness is demonstrated by receipts, not by furniture.
14. **AI as spectacle.** AI is edges, never spine (D-005); an AI flourish near the money path would spend the exact trust the ledger earns (invariant 32).
15. **Whimsy at stakes.** Playful copy near money, mascots at errors, jokes during someone's unsold moment — tone-deafness is a dignity violation here, not a style choice (EP-7).

---

# 12 · EXPERIENCE TEST

Measurable validation, wired into Phase 0B (these refine — not duplicate — VA-1/VA-2/VA-4 protocols; evidence lands in the 0B Evidence Ledger):

| Test | Objective | Participants | Success | Failure | Evidence |
|---|---|---|---|---|---|
| **Five-Second Test** (VA-1) | First Light verdict | Founder + ≥5 neutral (≥2 organizers/owners) | ≥3/5 use premium-class words unprompted ≤10s ("TV," "IPL," "professional," "premium") | "scoreboard app," "Excel," silence | Recorded first reactions, captured before any pitch |
| **Trust Test** (VA-1/VA-2) | Is the screen the referee? (EP-3) | 5 participants | Stranger settles "who bought X, for how much, is it final?" in <30s using only the product; calls the receipt "proof" | Needs a human to vouch; distrusts the number | Timed task recordings |
| **Recognition Test** (VA-1) | Distinctiveness | 5 participants | Shown desaturated screens beside 2 competitor tools: DesiAuction identified as "the different one" ≥4/5 | Indistinguishable from category | Sorting-task results |
| **Premium Perception Test** (VA-4) | Willingness-to-pay coupling | Organizer panel | Post-demo price anchors land ≥2× pre-demo anchors | No movement — looks don't move value | Van-Westendorp deltas pre/post demo |
| **Navigation Confidence** (VA-2) | "I know my next move" (EP-1/4) | Naïve operator + bidders | ≥80% first-try success on "where would you go to…" probes; zero mid-auction disorientation events | Hunting, backtracking, asking the builder | Task metrics + recording |
| **Auction Excitement** (VA-2) | Electricity is real (EP-2) | Mock-auction room | Spontaneous audible reactions at ≥50% of SOLD moments; post-session "electric, not stressful" majority; zero anxiety complaints from the *operator* | Silence at SOLD; operator overwhelm; bidder fear | Room audio/video + exit questions |
| **Memory Recall** (VA-2, +48h) | What sticks (§5) | Same participants, 2 days later | Unprompted recall includes the ceremony AND ≥1 trust artifact (receipt/purse exactness) | Recall is generic ("it was an app") | Structured 48h follow-up |
| **Dignity Test** (VA-1/VA-2) | EP-7 under observation | All sessions | Zero moments where a participant is embarrassed *by the interface* (unsold rendering, error states) | Laughter at a person's expense; visible discomfort at UNSOLD | Observer log |

---

# 13 · EXPERIENCE CONSTITUTION

The immutable rules. Constitutional: breaking any requires founder-level approval, recorded in the decision log. Cite as **XC-1 … XC-12.**

1. **XC-1 · Emotion is specified before interface.** Every new screen names its §3 emotion, load ceiling and energy *before* wireframing. A screen with no stated feeling is unbuildable.
2. **XC-2 · Trust before beauty.** Where aesthetics and legibility-of-truth conflict, truth wins — every time, on every surface.
3. **XC-3 · Calm before density.** No surface exceeds its emotional-map load ceiling to fit more information; information queues, it does not crowd.
4. **XC-4 · Dignity before data.** No rendering of a person ships without passing the dignity rules (C-23); this outranks completeness, analytics and speed.
5. **XC-5 · Truth before theatre.** No celebration before commitment (invariant 13); no drama the rules didn't produce (EP-2). The ceremony is downstream of the ledger, forever.
6. **XC-6 · The peak is protected.** Nothing shares the SOLD moment — no brand, no sponsor, no chrome, no adjacent motion. Sponsors may frame the night; they never interrupt a name. (Commercial pressure will test this rule; it is written *because* it will be tested.)
7. **XC-7 · Two temperatures, one truth.** Every surface declares itself office or stadium and obeys that temperature's laws; and no two surfaces may disagree on a number at the same event-sequence point (invariant 12).
8. **XC-8 · Motion speaks or is silent.** Every animation states a fact; reduced-motion preserves the fact. Decorative motion is a defect, not a style.
9. **XC-9 · The product must be closable.** No engagement mechanics, ever (invariant 31 + EP-14). We measure Trusted Auctions Completed, not minutes-in-app.
10. **XC-10 · Accessibility before aesthetics.** A signature moment that cannot be experienced through assistive channels is unfinished, not shipped-with-caveats (13).
11. **XC-11 · Evidence before opinion.** Experience claims are validated by §12 tests; taste disputes are settled by testing, and the pre-registered criteria cannot be edited after the fact.
12. **XC-12 · Novelty is budgeted.** Invention is spent at §10 moments only; everywhere else, the most familiar excellent pattern wins (EP-13). A clever settings page is a bug.

---

# FINAL QUESTION

**"If every engineer, designer and product manager followed this document faithfully for the next five years — would DesiAuction become a product people genuinely remember?"**

**Yes** — because memory is not made by features, and this document deliberately allocates everything memory *is* made of: a peak (the ceremony), an ending (the exhale), an identity (being taken seriously), a distinctive shape (two temperatures, one truth), and the discipline to keep everything else quiet so those can be loud. Products are forgotten when they spread their energy evenly; this document forbids exactly that.

**What is still missing before visual exploration (VA-1) begins — three named gaps:**

1. **Sound.** This document choreographs a spectacle and says nothing about hearing it. A hall with a projector has speakers; the gavel, the countdown's final seconds and the SOLD moment have obvious sonic dimensions — and equally obvious failure modes (kitsch, spam, a hall with no speakers). A one-page ruling is required: is DesiAuction silent by design (a legitimate, defensible choice under EP-14) or does the ceremony carry sound? VA-1 should prototype whichever is ruled — or both, as a variant test.
2. **Language and voice in Hindi.** The UX writing corpus (20/21) is English-first; the experience this document describes happens in rooms where the emotional language is often Hindi or Hinglish. "Being taken seriously" in the wrong language is being taken half-seriously. Before VA-1: decide the ceremony's language behaviour (names already have Devanagari parity via B1; does *copy* — "SOLD," team names, amounts in words — localize?), and give the voice principles a Hindi register, not just a translation note.
3. **The rendered proof itself.** By design, this document cannot answer whether FLOODLIGHT's specific palette and type carry this direction — that is VA-1's entire purpose, now with a sharper rubric (§12). This gap is not a defect; it is the phase boundary working as intended.

Gaps 1 and 2 are half-day rulings (add to the VA-8 workshop agenda). With them ruled, visual exploration may begin — and it will be judged against this constitution.

*Executive Product Design Council · Experience Direction v1.0 · 2026-07-11*
