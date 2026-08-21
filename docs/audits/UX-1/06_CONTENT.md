# UX-1 — Content audit

## The standard the product already holds

Read enough of this product's copy and a house style appears, and it is a good
one: concrete, unhedged, and willing to name what it does *not* do.

- Empty states describe the world rather than the database. "No players in the
  pool yet" is followed by *why* — "Every registration is reviewed by the
  organizer before the player appears here" — and, when registration is open, by
  the action that changes it.
- The help centre corrects itself in public. `help.ts` carries source comments
  recording claims that were removed for being false: that `/money` showed dues
  (it does not — one query, `myDocuments`), that the inbox announces receipts (it
  carries no finance event at all). The article now says so plainly.
- Refusals are sentences, not enums. `auction-copy.ts` maps every machine
  rejection to human English — "You must keep enough purse to fill your minimum
  squad", "Bids move in set steps — pick one of the amounts shown" — and the map
  is an exhaustive `Record` on purpose, so adding a rejection code without copy
  fails the build.
- The landing page proves rather than claims: a simulated auction stage labelled
  "Simulated demo · fictional players", with a screen-reader narration derived
  from the same script so the two cannot drift.

That standard is why the content findings below are few and specific rather than
a rewrite.

## Changed

| Where | Was | Now | Why |
| --- | --- | --- | --- |
| `c/[slug]` hero | "All seasons" | **"All tournaments"** | One destination had four labels, and this was the only one using the *other* domain noun the product deliberately keeps apart. `/c` is `<h1>Tournaments</h1>`, titled "Tournaments · DesiAuction", and called "Browse tournaments" / "All tournaments" by the header and footer. |
| `c/[slug]` hero | *(no action at all)* | **"See the squads"** | For a closed or finished competition the only control was a ghost link *away* from the page. The squads were a scroll down and nothing pointed at them. |
| Readiness verdict | "Ready for auction" | **"Ready — but running short"** | The green verdict sat directly above an amber row reading "Short — 2 players cannot fill 4 squads". The exclusion of feasibility from blockers is a deliberate, well-reasoned product decision; the presentation reconciled nothing. |
| Bid/command failure | "That didn't go through. Try again." | **"The auction service isn't responding. Nothing was recorded — tell the auctioneer before bidding again."** | `engine_unreachable` and `engine_http_*` were the only refusals with no sentence — and they are the two most likely real failures in a hall. "Try again" is not merely generic there, it is wrong: retrying fails identically. |
| Network failure on a bid | *(silence)* | **"That didn't reach the auction — check your connection and try again."** | There was no message at all, because there was no catch. See F-2. |
| Admin identity bar | "Platform admin" under "Platform admin" | **"Messaging"** under "Platform admin" | The page had no section label, so the title fell back to the surface name already shown above it. |

## Left alone, deliberately

The brief asked for a renaming pass across every page. Working through it, the
existing vocabulary beat the generic alternatives, and the reasoning is recorded
in `02_INVENTORY.md`. In summary: **Tournament/Season** carries real information
(a tournament recurs; a season is the edition that runs), **Cockpit / Board /
Overlay / Stage** name four genuinely different screens in the room, and
**Paddle / Lot / Purse / Gavel** is the language the users already speak.

Renaming these would cost clarity and gain nothing.

## Open content observations

- **Three near-identical generic fallbacks.** "That didn't work. Try again."
  (×5), "That did not save. Try again." (×2) and "That didn't go through. Try
  again." are the same sentence in three wordings. Each sits behind a specific
  map, so a user rarely meets one — but they should be one string.
- **Search rows state their type twice** (F-17). `result.hint` renders "Help
  article" beside `result.section` rendering "HELP", with no excerpt to
  distinguish two results. Not changed here: adding excerpts is a content-model
  change, not a copy edit.
- **Sentence case is not quite universal.** The finance profile renders its
  auto-receipt value as lowercase "off" beside sentence-case siblings ("Not
  registered for GST").
- **`/money` tells readers to bookmark it** (F-18) because it is in no menu.
  The help centre is honest about this, which is the right way to ship a known
  gap — but a receipts page a paying customer must bookmark is a product
  decision worth revisiting before general availability, not a permanent shape.
