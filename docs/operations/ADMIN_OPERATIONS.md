# Admin operations — watching auction nights and taking pages down

What the platform operator has on `/admin` for running the beta, and what each
surface can and cannot do. Every page here is behind a platform grant that can
only be installed out of band:

```bash
pnpm --filter @desiauction/web seed:admin -- --set <set> +91XXXXXXXXXX
```

| Set                   | Opens                                                              |
| --------------------- | ------------------------------------------------------------------ |
| `platform:admin`      | Overview, Live, auction watch, Organizations, Users, Audit, Health |
| `platform:billing`    | Passes                                                             |
| `platform:demo`       | Demos                                                              |
| `platform:privacy`    | Erasure                                                            |
| `platform:support`    | Reports, Reviews                                                   |
| `platform:moderation` | Moderation                                                         |

No set is a superset of another. The founder normally holds all six. A page
you do not hold the grant for is a 404, the same as for a stranger.

## The Overview

Top to bottom: **Live now** (every auction running, busiest first), **Waiting
on your desks** (open work on the desks _you_ hold, oldest first — shown only if
you hold one), then the platform totals, outcomes, the attention queue and
recent activity.

The attention queue lists things administration cannot fix (a stalled job
runner, an auction nobody closed, a discrepant settlement case). The desk card
lists things you can.

## Auction night: `/admin/live`

Every auction whose status is `live` or `paused`, refreshing every 10 seconds
while the tab is visible. Each room shows lots sold/unsold/left, money spent,
bids in the last five minutes, when anything last happened, and the engine's
own view of the room (people connected, broadcast latency).

A room is **Bidding** if anything happened in the last 15 minutes, **Quiet** if
not, **Paused** if the organizer paused it. A room silent for over 12 hours moves
to **Never closed** — the status still says live, but the night is over and
nobody closed it. Only the organizer can close it, from their cockpit.

**Engine trouble** is called out in words on the room: the engine not
answering within 2 seconds, the engine having halted the room, the timer
watchdog stalling, or commands queuing. The first place to look after that is
`/admin/health` and the engine's `/readyz`.

The line under the header says how fresh the numbers are. "Couldn't refresh"
means the board kept the last good data and is retrying — a stale board and a
quiet auction look identical without it.

## One auction: `/admin/auctions/[id]`

Reached from the live board, the Overview, or the auction badge on an
organization's season list. While live it refreshes every 5 seconds: what is on
the block and the current bid, every team's purse, the bid tape (the last 15
bids), the engine card, and the tail of the event log. Once the auction closes
the page stops refreshing and reads as its report — every lot with its base and
final price and winning paddle, and each team's players, spend, purse left and
top buy.

The numbers come from the same read the organizer's own Auction tab uses, so the
two screens cannot disagree.

**Administration watches; it never conducts.** There is no pause, close,
undo or recover here, and a dependency rule (`admin-never-imports-engine-commands`)
keeps the engine's command client out of reach of every admin module. If a room
needs a hand, call the organizer — the fix is in their cockpit.

## Taking a public page down: `/admin/moderation`

Anyone can open a club and publish a season to the open web. The moderation
desk lists every public season (search by season, slug or club; open the page to
judge what a stranger sees) and every season DesiAuction has taken down.

**Take down…** asks for a reason of 10–500 characters — the organizer reads it
— and then, in one statement:

- makes the season private, which removes its public page, player pages, share
  cards, directory listing and sitemap entry at once (every public surface keys
  on visibility alone);
- records the hold (when, who, why) on the season, and an audit row
  `competition.platform_held` on the club's own timeline.

While the hold stands the database refuses to make the season public
(`competitions_platform_hold_private_check`), whatever path tries. The
organizer's Public page card says **Taken down** with the reason and the support
address, and their Publish button explains itself.

A hold deletes nothing and stops nothing. The club keeps running its season;
registration by direct link, the auction and settlement all carry on.

**Lift the hold…** hands the decision back. It does not republish — the season
stays private until the organizer publishes it again. The lift is audited as
`competition.platform_hold_lifted`, with your note if you gave one.

If you receive a legal takedown notice, act on it here first, then answer the
sender from `support@`. The audit row is your record of when it was done.

## What is deliberately not here

- Cancelling, force-completing, or changing purses or allocations of an auction.
  Those rewrite a certified result the club owns.
- Refunds. Money belongs to the club's settlement desk.
- Suspending a person or a club. Not built yet; revisit at the first abuse
  report that a take-down does not cover.
- Revenue and transaction pages. The platform takes no payment of its own yet;
  a revenue figure here would be a number about the clubs' money.
