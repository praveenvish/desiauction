# WhatsApp templates — personal messages

> **Generated** from `apps/web/src/server/messaging/whatsapp.ts` by
> `pnpm --filter @desiauction/web wa:sheet`. Do not edit by hand: Meta matches
> every send against the approved template, and the code is the source of the text.

## How these are used

A player who ticks **“Send my auction and team updates on WhatsApp instead of SMS”**
(at registration, or on /account) gets these moments on WhatsApp **instead of** the
SMS. Everyone else keeps the SMS. A template whose name is not configured, or a
WhatsApp send that fails, falls back to the SMS for that message, so nothing is
lost while approval is pending.

## Before you submit

1. **Meta Business account** verified, with a WhatsApp Business phone number on the
   Cloud API. The same `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` serve
   sign-in codes and these messages.
2. Create each template below in **WhatsApp Manager → Message templates**:
   category **Utility**, language **English (en)**. Use the suggested name or your
   own, then put the APPROVED name in the env var listed for it.
3. The button is a **static URL** (no variable). The sale's header is an **image**:
   the player card for a public, adult player, the DesiAuction card otherwise.

## Templates

### auction.sold

When the organizer announces the auction results — to each player a team bought.

| Field | Value |
|---|---|
| Suggested name | `da_auction_sold` |
| Category | Utility |
| Language | English (en) |
| Header | Image (sample: any player card PNG) |
| Footer | DesiAuction |
| Button | Visit website — “See your season” → https://desiauction.in/home |
| Env var for the approved name | `WHATSAPP_TEMPLATE_AUCTION_SOLD` |

Body to submit:

```text
Congratulations, {{1}}! {{2}} bought you for {{3}} in the {{4}} auction. Your player card is above — share it with your team.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Cup Kings
- `{{3}}` — ₹75,000
- `{{4}}` — Malad Premier League 2026

As received:

```text
Congratulations, Arjun! Cup Kings bought you for ₹75,000 in the Malad Premier League 2026 auction. Your player card is above — share it with your team.
```

### team.appointed

When the organizer announces captains and icons — to each player named captain, vice-captain, icon or retained player.

| Field | Value |
|---|---|
| Suggested name | `da_team_appointed` |
| Category | Utility |
| Language | English (en) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website — “See your season” → https://desiauction.in/home |
| Env var for the approved name | `WHATSAPP_TEMPLATE_TEAM_APPOINTED` |

Body to submit:

```text
Congratulations, {{1}}! You are named {{2}} of {{3}} for {{4}}.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Vikram
- `{{2}}` — captain
- `{{3}}` — Cup Kings
- `{{4}}` — Malad Premier League 2026

As received:

```text
Congratulations, Vikram! You are named captain of Cup Kings for Malad Premier League 2026.
```

### lineup.announced

When the organizer announces a side's lineup for a match still to come — to each player in it.

| Field | Value |
|---|---|
| Suggested name | `da_lineup_announced` |
| Category | Utility |
| Language | English (en) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website — “See your season” → https://desiauction.in/home |
| Env var for the approved name | `WHATSAPP_TEMPLATE_LINEUP_ANNOUNCED` |

Body to submit:

```text
{{1}}, you are in the {{2}} lineup vs {{3}} on {{4}}. Good luck!
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Cup Kings
- `{{3}}` — Tigers
- `{{4}}` — Sun, 4 Oct, 7:30 pm

As received:

```text
Arjun, you are in the Cup Kings lineup vs Tigers on Sun, 4 Oct, 7:30 pm. Good luck!
```

