# 21 — Microcopy

> Canon: C-23, C-24 · v1.0 · 2026-07-11

Canonical strings for high-stakes moments. These are **specifications** — implementations localize them but never rephrase them in English. String IDs in `packages/ui/strings` (20 rule 10).

## Live auction

| Moment | String |
|--------|--------|
| Lot opens | "Lot {n} · {player}" (Stage subtitle: "{role} · Base ₹{base}") |
| Bid accepted (bidder) | "Yours at ₹{amount}" |
| Bid accepted (room) | "{team} — ₹{amount}" |
| Outbid | "{team} leads at ₹{amount}" |
| Anti-snipe | "Time extended" |
| SOLD (ceremony) | "SOLD" → "{player} · {team} · ₹{amount}" |
| Not sold (round) | "Not sold this round — returns in round {r}" |
| Not sold (final) | "Not sold in this auction" |
| Paused | "Auction paused by the organizer — your purse and squad are safe" |
| Resumed | "Live again · Lot {n}" |
| Receipt | "Receipt #{id} · {player} to {team} · ₹{amount} · Purse left ₹{remaining}" |

## Connection honesty (23)

| State | String |
|-------|--------|
| Catching up | "Catching up…" |
| Caught up | "Live · up to date" |
| Stale | "Reconnecting — showing as of {time} (event {seq})" |
| Offline | "No connection. Nothing is lost — bids are recorded on the server." |

## Bid validation (server reasons → human copy, 41)

| Code | String |
|------|--------|
| BELOW_CURRENT | "That's below the current bid — next valid bid is ₹{next}" |
| BUDGET_EXCEEDED | "That bid exceeds your purse (₹{remaining} left)" |
| RESERVE_VIOLATION | "That bid leaves too little for your {n} remaining required players" |
| SQUAD_FULL | "Your squad is full ({max} players)" |
| ROLE_LIMIT | "You already have {limit} {role}s — the limit for this auction" |
| NOT_LEADING_REQUIRED | *(never shown; UI prevents)* |

## Console decisions

| Moment | String |
|--------|--------|
| Approve registration | Button: "Approve {name}" · Result: "{name} is in the pool" |
| Reject (dialog) | "Reject {name}'s registration? They'll be notified respectfully. Reason (kept private):" |
| Lock pool | "Lock the pool? {n} players, {r} rounds. After locking, changes require an audited override." |
| Go-live gate (blocked) | "Not ready: {failing items}. Each links to its fix." |
| Go live | "Start the auction? Owners and the Stage go live immediately." |
| Undo lot (override) | "Reopen lot {n}? The sale of {player} to {team} for ₹{amount} will be reversed. This is recorded in the audit log with your name." |

## Empty/first-run seeds (22)

- Tournaments (none): "Your first tournament starts here." → "Create tournament"
- Pool (none approved): "Approved players appear here, ready to become lots."
- Owner Room (pre-live): "You're in. The auction starts when the organizer opens Lot 1."

## Notification templates (47)

- WhatsApp sold (player): "🏏 {player}, you're going to {team}! Sold for ₹{amount} in {tournament}. See your moment: {link}"
- Owner receipt: "Receipt: {player} → {team}, ₹{amount}. Purse remaining ₹{remaining}. {link}"
- Auction reminder (owner, T-30m): "{tournament} auction starts at {time}. Your Owner Room: {link}"

(The player SOLD message is the only emoji-sanctioned template — it's ceremony, C-23.)
