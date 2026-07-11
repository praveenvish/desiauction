# 20 — UX Writing Guidelines

> Canon: C-19, C-23, C-24 · v1.0 · 2026-07-11

## The voice: a great scorer

Precise, calm, present-tense, never theatrical (except ceremony, 06). The scorer states facts and next steps; the scorer never blames, never gushes, never hedges.

## Rules

1. **Lead with the fact, follow with the action.** "Pool locked. 64 players in 4 rounds." → not "Success! Your pool has been successfully locked."
2. **Numbers are copy.** Prefer "3 registrations waiting" over "You have pending registrations." Exact numbers build the trust the product sells.
3. **Present tense, active voice.** "Titans lead at ₹90,000" not "The bid has been placed by Titans."
4. **No blame grammar.** Errors describe the system and the path forward, never the user's failure ("That amount is below the current bid — next valid bid is ₹95,000").
5. **No filler ceremony.** Banned: "Oops", "Uh oh", "Awesome!", "Successfully", "Please note", "Kindly". Exclamation marks exist only inside the SOLD/champion ceremonies.
6. **Buttons are verbs with objects.** "Approve player", "Lock pool", "Place bid ₹95,000" — never "OK", "Yes", "Submit", "Continue" on consequential actions (28).
7. **Time is absolute when it matters.** Money/audit contexts show absolute timestamps (19:42:10); relative time ("2m ago") only for ambient freshness.
8. **Dignity grammar (C-23):** UNSOLD copy is neutral and forward-looking ("Not sold this round — returns in round 2" / final: "Not sold in this auction"). Never "failed", "rejected", "nobody bid". Rejection communications to players state the private reason category chosen by the organizer, phrased respectfully, never auto-generated shame.
9. **Money grammar (C-7):** Indian notation with unit ("₹1.2 L"); screen-reader expansion provided; exact value in receipts; purse warnings state consequences ("Leaves ₹40,000 for 3 required players").
10. **Bilingual discipline (C-24):** every string externalized with an ID; no concatenation-built sentences (breaks Hindi grammar); variables carry formatters (money, dates) not raw values.

## Terminology (canonical, everywhere)

| Say | Never |
|-----|-------|
| Pool | Player list, inventory |
| Lot | Item, entry |
| Purse | Budget, wallet, funds |
| Bid | Offer |
| SOLD / Not sold | Won, failed, passed |
| Pass (entitlement) | Subscription, plan (except Association bundles) |
| Owner | Manager, captain (distinct concepts, 37) |
| Organizer | Admin (in user-facing copy) |
| Lock | Freeze, finalize |

One concept, one word, all surfaces, matching the glossary (00). Terminology drift is a copy defect.

## Register map

| Surface | Register (06) | Example |
|---------|---------------|---------|
| Console | Scorer | "2 teams have no accepted owner. Auction can't go live." |
| Cockpit | Scorer, terse | "Lot 14 · No bids · Space to close as Not sold" |
| Owner Room | Scorer + warmth | "Yours. Arjun Patel joins Titans — ₹1.2 L. Purse left ₹3.8 L." |
| Stage | Commentator | "Arjun Patel goes to Titans — ₹1.2 L" |
| Ceremony | Ceremony | "SOLD" |
