# DLT registration sheet — SMS templates

> **Generated** from `apps/web/src/server/messaging/templates.ts` by
> `pnpm --filter @desiauction/web dlt:sheet`. Do not edit by hand: the text below
> must match what the gateway receives character for character, and the code is
> the source of that text.

## Before you register

1. **Principal Entity (PE).** Register DesiAuction's legal entity on one DLT portal
   (Jio TrueConnect, Airtel, Vodafone Idea Vilpower or BSNL — one is enough; it is
   shared across operators). You get a **PE ID**.
2. **Header (sender ID).** Six letters, for service messages. Suggested:
   `DSAUCN` — pick whatever is free; it must read as DesiAuction. Header type:
   **Service Implicit**.
3. **Whitelist the URL domain.** Every template carries a link as fixed text on
   `desiauction.in` (https://desiauction.in/home, https://desiauction.in/support). Since TRAI's 2024 rule, a
   message with a URL on a domain not whitelisted under your entity is blocked.
4. **Content category.** Register every template below as **Service Implicit**.
   (DLT's "Transactional" category is reserved for banks; these are service
   messages about something the recipient just did. None is promotional.)
5. **Link the header to MSG91.** Give MSG91 the PE ID and header; register each
   template in MSG91 against its DLT template ID, then put that MSG91 template id
   in the env var named in each row.

Every variable is `{#var#}` and holds at most **30 characters** (the
portals' limit). Every message is **one SMS segment** (≤ 160 characters) even with
every variable full, and uses only GSM-7 characters.

## Templates

### registration.approved (v2)

A player's registration was approved by the organizer.

| Field | Value |
|---|---|
| Content category | Service Implicit |
| Variables | 1 — `competition` (≤ 30) |
| Env var for the MSG91 template id | `MSG91_TEMPLATE_REGISTRATION_APPROVED` |

Template text to register:

```text
DesiAuction: You are approved for {#var#}. You are in the player pool for auction day. https://desiauction.in/home
```

Example as received:

```text
DesiAuction: You are approved for Malad Premier League 2026. You are in the player pool for auction day. https://desiauction.in/home
```

### registration.waitlisted (v2)

A player's registration was placed on the waitlist.

| Field | Value |
|---|---|
| Content category | Service Implicit |
| Variables | 1 — `competition` (≤ 30) |
| Env var for the MSG91 template id | `MSG91_TEMPLATE_REGISTRATION_WAITLISTED` |

Template text to register:

```text
DesiAuction: You are on the waitlist for {#var#}. The organizer moves players up if a place opens. https://desiauction.in/home
```

Example as received:

```text
DesiAuction: You are on the waitlist for Malad Premier League 2026. The organizer moves players up if a place opens. https://desiauction.in/home
```

### registration.rejected (v2)

A player's registration was declined, with the category of reason.

| Field | Value |
|---|---|
| Content category | Service Implicit |
| Variables | 2 — `competition` (≤ 30), `reason` (≤ 30) |
| Env var for the MSG91 template id | `MSG91_TEMPLATE_REGISTRATION_REJECTED` |

Template text to register:

```text
DesiAuction: Your registration for {#var#} was not approved: {#var#}. https://desiauction.in/home
```

Example as received:

```text
DesiAuction: Your registration for Malad Premier League 2026 was not approved: the season is full. https://desiauction.in/home
```

### registration.withdrawn (v2)

A player's registration was withdrawn.

| Field | Value |
|---|---|
| Content category | Service Implicit |
| Variables | 1 — `competition` (≤ 30) |
| Env var for the MSG91 template id | `MSG91_TEMPLATE_REGISTRATION_WITHDRAWN` |

Template text to register:

```text
DesiAuction: Your registration for {#var#} was withdrawn. You can register again while it is open. https://desiauction.in/home
```

Example as received:

```text
DesiAuction: Your registration for Malad Premier League 2026 was withdrawn. You can register again while it is open. https://desiauction.in/home
```

### registration.restored (v2)

A declined or withdrawn registration was put back under review.

| Field | Value |
|---|---|
| Content category | Service Implicit |
| Variables | 1 — `competition` (≤ 30) |
| Env var for the MSG91 template id | `MSG91_TEMPLATE_REGISTRATION_RESTORED` |

Template text to register:

```text
DesiAuction: Your registration for {#var#} is back under review. https://desiauction.in/home
```

Example as received:

```text
DesiAuction: Your registration for Malad Premier League 2026 is back under review. https://desiauction.in/home
```

### security.phone_changed (v2)

Security alert to the OLD number when an account's mobile number is changed.

| Field | Value |
|---|---|
| Content category | Service Implicit |
| Variables | 1 — `last4` (≤ 4) |
| Env var for the MSG91 template id | `MSG91_TEMPLATE_SECURITY_PHONE_CHANGED` |

Template text to register:

```text
DesiAuction: Your account's mobile number was changed to one ending {#var#}. Not you? Get help now at https://desiauction.in/support
```

Example as received:

```text
DesiAuction: Your account's mobile number was changed to one ending 4321. Not you? Get help now at https://desiauction.in/support
```

### auction.sold (v1)

A player was bought by a team in their season's auction (sent when results are announced).

| Field | Value |
|---|---|
| Content category | Service Implicit |
| Variables | 3 — `team` (≤ 30), `price` (≤ 15), `competition` (≤ 30) |
| Env var for the MSG91 template id | `MSG91_TEMPLATE_AUCTION_SOLD` |

Template text to register:

```text
DesiAuction: Congratulations! {#var#} bought you for {#var#} in {#var#}. https://desiauction.in/home
```

Example as received:

```text
DesiAuction: Congratulations! Cup Kings bought you for Rs 75,000 in Malad Premier League 2026. https://desiauction.in/home
```

### team.appointed (v1)

A player was named captain, vice-captain, icon or retained player of their team (sent when the organizer announces it).

| Field | Value |
|---|---|
| Content category | Service Implicit |
| Variables | 3 — `role` (≤ 30), `team` (≤ 30), `competition` (≤ 30) |
| Env var for the MSG91 template id | `MSG91_TEMPLATE_TEAM_APPOINTED` |

Template text to register:

```text
DesiAuction: You are named {#var#} of {#var#} for {#var#}. https://desiauction.in/home
```

Example as received:

```text
DesiAuction: You are named captain of Cup Kings for Malad Premier League 2026. https://desiauction.in/home
```

### Sign-in code (OTP)

Sent through MSG91's OTP API (`MSG91_TEMPLATE_ID` in the web env), not the
registry above: MSG91 fills the code into its own OTP template. Register this
text on DLT as **Service Implicit**, and create the MSG91 OTP template with the
same text, using `##OTP##` where DLT has `{#var#}`.

```text
{#var#} is your DesiAuction sign-in code. It expires in 5 minutes. Never share it with anyone, including us.
```

Example as received:

```text
482913 is your DesiAuction sign-in code. It expires in 5 minutes. Never share it with anyone, including us.
```

## WhatsApp (optional, later)

WhatsApp authentication templates use Meta's fixed wording ("{{1}} is your
verification code. For your security, do not share this code.") and are approved
in Meta Business Manager, not on DLT. Set `WHATSAPP_TEMPLATE_NAME` to the approved
template's name.

