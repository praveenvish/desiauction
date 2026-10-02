# Practice auction (0101)

A short rehearsal the organiser runs **inside the season** before the real
auction, so every owner learns the bidding screens on their own phone. It uses
the same link, sign-in, engine and screens as the real night, and nothing it
does reaches the season.

## Who sees what

| Person | Experience |
|---|---|
| Organiser | Auction page → **Practice auction** card. They choose 2 or 3 players per team, see the sum and press **Start**. The card then shows each team as *Ready to bid*, *Not bidding yet* or *You bid for this team*. **Open the cockpit** runs the practice, and **Run again** or **End practice** finish it. |
| Owner / captain | Their usual auction link lands in the practice. An amber **PRACTICE** bar sits on every screen, with a **Practice \| Real auction** switch. They pick up their paddle and bid exactly as on the night. |
| Everyone else | Nothing. Public pages, posters, careers, notifications, settlement, admin counts and reminders never see a practice. |

## Rules

- **Players.** Practice size is teams × N + 2 players, where N is 2 or 3. The 2 extra players can't all be bought, so owners also see a player go unsold.
- **Sample players.** They are the season's own players: approved pool players first, then by registration number. If the season has fewer, all of them are used.
- **Money.** Each team has a **100-point purse**, even in a rupee season. Every player opens at 10, and the bid steps are +1 up to 20, +2 up to 50, then +5. The squad is exactly N players.
  - The reserve rule therefore bites: a team needing 2 players can spend at most 90 on its first.
- **Timer and unsold rule.** These are the real auction's own.
- **Squads.** Every team starts with an empty squad, and pre-signed players are not counted.
- **Owners.**
  - Copied in: owners who accepted their link or hold a grant on the real auction.
  - Joining later: an owner who joins after the practice starts is added the moment they open the room (engine command `PracticeAddOwner`, which checks they own that team on the real auction).
  - Teams nobody owns: the organiser holds their paddle.
- **When a practice can exist.** Only while the real auction is `scheduled`, and only one at a time.
- **Ending.**
  - **Opening the real auction ends the practice first.** This is true from both the cockpit and the auction page, and every phone in the practice moves to the real auction by itself.
  - A practice never *completes*. Completing sends results, so a practice ends by abort instead (**End practice**, or **Run again**, which ends it and starts a fresh one).

## How it is built

- **Data.**
  - `auctions.kind` is `'real' | 'practice'` (migration 0101).
  - Only one non-abandoned real auction and one non-abandoned practice may exist per season (two partial unique indexes).
- **Aggregate** (`packages/auction`).
  - `createPracticeAuction` makes the practice in one transaction, using the same events the existing writers emit, so the engine replays it like any night.
  - For a practice:
    - a sale or undo never writes `registrations.team_id`;
    - opening skips `settlePool`;
    - `complete` is refused;
    - audit rows carry `meta.practice = "true"`.
- **Reads.**
  - `auctionOf` returns the real auction only.
  - `roomAuctionOf` returns the practice while one runs. Only the live-room gate uses it (`liveGate(slug, { room: true })`), and it honours the per-season room-switch cookie.
  - Every other query that finds auctions, lots, paddles, grants or owner links by season, org, person or player filters with `isRealAuction()` / `inRealAuction()`.
  - `real-auction-filter.test.ts` scans `apps/web/src/server` and fails on a new reader that does neither.
- **Moving phones.**
  - `PracticeBar` polls `practiceRoomStateAction` every 5 s while the real auction is waiting, and refreshes the room when a practice starts, restarts or ends.
- **Tests.**
  - `practice.regression.test.ts`: the aggregate, against Postgres.
  - `e2e/practice-auction.spec.ts`: the whole flow with an organiser and two owners.
