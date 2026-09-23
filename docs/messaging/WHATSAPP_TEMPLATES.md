# WhatsApp templates — personal messages

> **Generated** from `apps/web/src/server/messaging/whatsapp.ts` by
> `pnpm --filter @desiauction/web wa:sheet`. Do not edit by hand: Meta matches
> every send against the approved template, and the code is the source of the text.

## How these are used

WhatsApp is the text channel; SMS (MSG91/DLT) is deferred. A person who ticks
**“Send my registration, auction and team updates, and account alerts, on WhatsApp.”** (at registration, or on /account)
gets every moment below on WhatsApp, in the language they chose there (English or
हिन्दी). A person who has **not** opted in never gets a WhatsApp message — their
email carries the moment, with one line inviting them to turn WhatsApp on.

A template whose approved name is not configured sends nothing on WhatsApp. Where
an SMS gateway is configured the moment falls back to SMS; where none is (today),
the text is recorded as `suppressed` with a `no_text_channel:` reason and the
email still goes. So approval can be pending without anything breaking.

Sign-in codes are separate: an **Authentication** template in Meta's own wording,
English only, named in `WHATSAPP_TEMPLATE_NAME` (see WHATSAPP_SETUP.md).

## Before you submit

1. **Meta Business account** verified, with a WhatsApp Business phone number on the
   Cloud API. The same `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` serve
   sign-in codes and these messages.
2. Submit each template below — from **/admin/notifications/templates → Submit to
   Meta** (it sends exactly this text; needs `WHATSAPP_BUSINESS_ACCOUNT_ID`; the sale's picture template only by hand), or by hand
   in **WhatsApp Manager → Message templates**: category **Utility**, ONE template name
   with **two languages** — English (`en`) and Hindi (`hi`). Use the suggested name or
   your own. Once APPROVED, **map** the name on the same admin page (the env var listed
   for it is the fallback when nothing is mapped). A Hindi reader gets English until
   the Hindi version is approved.
3. The button is a **static URL** (no variable) — its label is per language. The
   sale's header is an **image**: the player card for a public, adult player, the
   DesiAuction card otherwise.
4. The variables are the same, in the same order, in both languages; a sample for
   each is listed per language.

## Templates

| Moment | Suggested name | Env fallback for the approved name |
|---|---|---|
| registration.approved | `da_registration_approved` | `WHATSAPP_TEMPLATE_REGISTRATION_APPROVED` |
| registration.waitlisted | `da_registration_waitlisted` | `WHATSAPP_TEMPLATE_REGISTRATION_WAITLISTED` |
| registration.rejected | `da_registration_rejected` | `WHATSAPP_TEMPLATE_REGISTRATION_REJECTED` |
| registration.withdrawn | `da_registration_withdrawn` | `WHATSAPP_TEMPLATE_REGISTRATION_WITHDRAWN` |
| registration.restored | `da_registration_restored` | `WHATSAPP_TEMPLATE_REGISTRATION_RESTORED` |
| security.phone_changed | `da_security_phone_changed` | `WHATSAPP_TEMPLATE_SECURITY_PHONE_CHANGED` |
| security.email_changed | `da_security_email_changed` | `WHATSAPP_TEMPLATE_SECURITY_EMAIL_CHANGED` |
| auction.sold | `da_auction_sold` | `WHATSAPP_TEMPLATE_AUCTION_SOLD` |
| team.appointed | `da_team_appointed` | `WHATSAPP_TEMPLATE_TEAM_APPOINTED` |
| lineup.announced | `da_lineup_announced` | `WHATSAPP_TEMPLATE_LINEUP_ANNOUNCED` |

### registration.approved

When an organizer approves a registration — to the player.

| Field | Value |
|---|---|
| Suggested name | `da_registration_approved` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/home |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_REGISTRATION_APPROVED` |

#### English (`en`)

Button label: “See your registration”

Body to submit:

```text
Hi {{1}}, you are approved for {{2}}. You are in the player pool for auction day.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026

As received:

```text
Hi Arjun, you are approved for Malad Premier League 2026. You are in the player pool for auction day.
```

#### Hindi (`hi`)

Button label: “अपना रजिस्ट्रेशन देखें”

Body to submit:

```text
नमस्ते {{1}}, {{2}} के लिए आपका रजिस्ट्रेशन मंज़ूर हो गया है। ऑक्शन के दिन आप प्लेयर पूल में रहेंगे।
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026

As received:

```text
नमस्ते Arjun, Malad Premier League 2026 के लिए आपका रजिस्ट्रेशन मंज़ूर हो गया है। ऑक्शन के दिन आप प्लेयर पूल में रहेंगे।
```

### registration.waitlisted

When an organizer puts a registration on the waitlist — to the player.

| Field | Value |
|---|---|
| Suggested name | `da_registration_waitlisted` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/home |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_REGISTRATION_WAITLISTED` |

#### English (`en`)

Button label: “See your registration”

Body to submit:

```text
Hi {{1}}, you are on the waitlist for {{2}}. The organizer moves players up if a place opens.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026

As received:

```text
Hi Arjun, you are on the waitlist for Malad Premier League 2026. The organizer moves players up if a place opens.
```

#### Hindi (`hi`)

Button label: “अपना रजिस्ट्रेशन देखें”

Body to submit:

```text
नमस्ते {{1}}, {{2}} के लिए आप वेटिंग लिस्ट में हैं। जगह खाली होने पर आयोजक खिलाड़ियों को आगे बढ़ाते हैं।
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026

As received:

```text
नमस्ते Arjun, Malad Premier League 2026 के लिए आप वेटिंग लिस्ट में हैं। जगह खाली होने पर आयोजक खिलाड़ियों को आगे बढ़ाते हैं।
```

### registration.rejected

When an organizer declines a registration — to the player, with the reason from a closed list.

| Field | Value |
|---|---|
| Suggested name | `da_registration_rejected` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/home |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_REGISTRATION_REJECTED` |

#### English (`en`)

Button label: “See your registration”

Body to submit:

```text
Hi {{1}}, your registration for {{2}} was not approved. Reason: {{3}}. Tap below for the details.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026
- `{{3}}` — the season is full

As received:

```text
Hi Arjun, your registration for Malad Premier League 2026 was not approved. Reason: the season is full. Tap below for the details.
```

#### Hindi (`hi`)

Button label: “अपना रजिस्ट्रेशन देखें”

Body to submit:

```text
नमस्ते {{1}}, {{2}} के लिए आपका रजिस्ट्रेशन मंज़ूर नहीं हुआ। कारण: {{3}}। पूरी जानकारी के लिए नीचे टैप करें।
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026
- `{{3}}` — सीज़न की सभी जगहें भर गई हैं

As received:

```text
नमस्ते Arjun, Malad Premier League 2026 के लिए आपका रजिस्ट्रेशन मंज़ूर नहीं हुआ। कारण: सीज़न की सभी जगहें भर गई हैं। पूरी जानकारी के लिए नीचे टैप करें।
```

### registration.withdrawn

When a registration is withdrawn — to the player.

| Field | Value |
|---|---|
| Suggested name | `da_registration_withdrawn` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/home |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_REGISTRATION_WITHDRAWN` |

#### English (`en`)

Button label: “See your registration”

Body to submit:

```text
Hi {{1}}, your registration for {{2}} was withdrawn. You can register again while registration is open.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026

As received:

```text
Hi Arjun, your registration for Malad Premier League 2026 was withdrawn. You can register again while registration is open.
```

#### Hindi (`hi`)

Button label: “अपना रजिस्ट्रेशन देखें”

Body to submit:

```text
नमस्ते {{1}}, {{2}} के लिए आपका रजिस्ट्रेशन वापस ले लिया गया है। रजिस्ट्रेशन खुला रहने तक आप फिर से रजिस्टर कर सकते हैं।
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026

As received:

```text
नमस्ते Arjun, Malad Premier League 2026 के लिए आपका रजिस्ट्रेशन वापस ले लिया गया है। रजिस्ट्रेशन खुला रहने तक आप फिर से रजिस्टर कर सकते हैं।
```

### registration.restored

When a withdrawn or declined registration is put back under review.

| Field | Value |
|---|---|
| Suggested name | `da_registration_restored` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/home |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_REGISTRATION_RESTORED` |

#### English (`en`)

Button label: “See your registration”

Body to submit:

```text
Hi {{1}}, your registration for {{2}} is back under review. We will tell you what the organizer decides.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026

As received:

```text
Hi Arjun, your registration for Malad Premier League 2026 is back under review. We will tell you what the organizer decides.
```

#### Hindi (`hi`)

Button label: “अपना रजिस्ट्रेशन देखें”

Body to submit:

```text
नमस्ते {{1}}, {{2}} के लिए आपका रजिस्ट्रेशन फिर से जाँच में है। आयोजक का फ़ैसला होते ही हम आपको बताएँगे।
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Malad Premier League 2026

As received:

```text
नमस्ते Arjun, Malad Premier League 2026 के लिए आपका रजिस्ट्रेशन फिर से जाँच में है। आयोजक का फ़ैसला होते ही हम आपको बताएँगे।
```

### security.phone_changed

When the mobile number on an account is changed — to the number being GIVEN UP, sent at once (not queued, not held overnight).

| Field | Value |
|---|---|
| Suggested name | `da_security_phone_changed` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/support |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_SECURITY_PHONE_CHANGED` |

#### English (`en`)

Button label: “Get help”

Body to submit:

```text
Hi {{1}}, the mobile number on your DesiAuction account was changed to one ending {{2}}. If this was not you, get help right away.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — 4321

As received:

```text
Hi Arjun, the mobile number on your DesiAuction account was changed to one ending 4321. If this was not you, get help right away.
```

#### Hindi (`hi`)

Button label: “मदद लें”

Body to submit:

```text
नमस्ते {{1}}, आपके DesiAuction अकाउंट का मोबाइल नंबर बदलकर {{2}} पर ख़त्म होने वाला नंबर कर दिया गया है। अगर यह आपने नहीं किया, तो तुरंत मदद लें।
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — 4321

As received:

```text
नमस्ते Arjun, आपके DesiAuction अकाउंट का मोबाइल नंबर बदलकर 4321 पर ख़त्म होने वाला नंबर कर दिया गया है। अगर यह आपने नहीं किया, तो तुरंत मदद लें।
```

### security.email_changed

When the sign-in email on an account is changed — to the account's phone, sent at once. The old address gets an email.

| Field | Value |
|---|---|
| Suggested name | `da_security_email_changed` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/support |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_SECURITY_EMAIL_CHANGED` |

#### English (`en`)

Button label: “Get help”

Body to submit:

```text
Hi {{1}}, the sign-in email on your DesiAuction account was changed to {{2}}. If this was not you, get help right away.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — a•••@example.com

As received:

```text
Hi Arjun, the sign-in email on your DesiAuction account was changed to a•••@example.com. If this was not you, get help right away.
```

#### Hindi (`hi`)

Button label: “मदद लें”

Body to submit:

```text
नमस्ते {{1}}, आपके DesiAuction अकाउंट का साइन-इन ईमेल बदलकर {{2}} कर दिया गया है। अगर यह आपने नहीं किया, तो तुरंत मदद लें।
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — a•••@example.com

As received:

```text
नमस्ते Arjun, आपके DesiAuction अकाउंट का साइन-इन ईमेल बदलकर a•••@example.com कर दिया गया है। अगर यह आपने नहीं किया, तो तुरंत मदद लें।
```

### auction.sold

When the organizer announces the auction results — to each player a team bought.

| Field | Value |
|---|---|
| Suggested name | `da_auction_sold` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | Image (sample: any player card PNG) |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/home |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_AUCTION_SOLD` |

#### English (`en`)

Button label: “See your season”

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

#### Hindi (`hi`)

Button label: “अपना सीज़न देखें”

Body to submit:

```text
बधाई हो, {{1}}! {{2}} ने आपको {{3}} में खरीदा है — {{4}} के ऑक्शन में। आपका प्लेयर कार्ड ऊपर है — इसे अपनी टीम के साथ शेयर करें।
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Cup Kings
- `{{3}}` — ₹75,000
- `{{4}}` — Malad Premier League 2026

As received:

```text
बधाई हो, Arjun! Cup Kings ने आपको ₹75,000 में खरीदा है — Malad Premier League 2026 के ऑक्शन में। आपका प्लेयर कार्ड ऊपर है — इसे अपनी टीम के साथ शेयर करें।
```

### team.appointed

When the organizer announces captains and icons — to each player named captain, vice-captain, icon or retained player.

| Field | Value |
|---|---|
| Suggested name | `da_team_appointed` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/home |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_TEAM_APPOINTED` |

#### English (`en`)

Button label: “See your season”

Body to submit:

```text
Congratulations, {{1}}! You are named {{2}} of {{3}} for {{4}}. Tap below to see your season.
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Vikram
- `{{2}}` — captain
- `{{3}}` — Cup Kings
- `{{4}}` — Malad Premier League 2026

As received:

```text
Congratulations, Vikram! You are named captain of Cup Kings for Malad Premier League 2026. Tap below to see your season.
```

#### Hindi (`hi`)

Button label: “अपना सीज़न देखें”

Body to submit:

```text
बधाई हो, {{1}}! आपको {{2}} चुना गया है — टीम {{3}}, {{4}}। अपना सीज़न देखने के लिए नीचे टैप करें।
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Vikram
- `{{2}}` — captain
- `{{3}}` — Cup Kings
- `{{4}}` — Malad Premier League 2026

As received:

```text
बधाई हो, Vikram! आपको captain चुना गया है — टीम Cup Kings, Malad Premier League 2026। अपना सीज़न देखने के लिए नीचे टैप करें।
```

### lineup.announced

When the organizer announces a side's lineup for a match still to come — to each player in it.

| Field | Value |
|---|---|
| Suggested name | `da_lineup_announced` |
| Category | Utility |
| Languages | English (`en`), Hindi (`hi`) |
| Header | None |
| Footer | DesiAuction |
| Button | Visit website → https://desiauction.in/home |
| Env fallback for the approved name | `WHATSAPP_TEMPLATE_LINEUP_ANNOUNCED` |

#### English (`en`)

Button label: “See your season”

Body to submit:

```text
Hi {{1}}, you are in the {{2}} lineup vs {{3}} on {{4}}. Good luck!
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Cup Kings
- `{{3}}` — Tigers
- `{{4}}` — Sun, 4 Oct, 7:30 pm

As received:

```text
Hi Arjun, you are in the Cup Kings lineup vs Tigers on Sun, 4 Oct, 7:30 pm. Good luck!
```

#### Hindi (`hi`)

Button label: “अपना सीज़न देखें”

Body to submit:

```text
नमस्ते {{1}}, आप {{2}} की लाइनअप में हैं — {{3}} के ख़िलाफ़, {{4}} को। शुभकामनाएँ!
```

Variable samples (Meta asks for one per variable):

- `{{1}}` — Arjun
- `{{2}}` — Cup Kings
- `{{3}}` — Tigers
- `{{4}}` — Sun, 4 Oct, 7:30 pm

As received:

```text
नमस्ते Arjun, आप Cup Kings की लाइनअप में हैं — Tigers के ख़िलाफ़, Sun, 4 Oct, 7:30 pm को। शुभकामनाएँ!
```

