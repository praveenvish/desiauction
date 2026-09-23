# WhatsApp setup — Meta Cloud API, end to end

DesiAuction launches with **WhatsApp as its text channel**: sign-in codes and
personal messages go out through Meta's WhatsApp Cloud API **directly**
(`graph.facebook.com`, no BSP, no platform fee). SMS through MSG91 is deferred
until DLT registration is done, and stays dormant until then — nothing below
needs an MSG91 account.

This is the founder's checklist, in the order Meta makes you do it. Each step
says where the value you need lives, and which `web.env` variable it goes in.
Steps marked **(wait)** involve a Meta review; start them early.

---

## 1. Meta Business verification (wait)

1. Go to **business.facebook.com** → create (or pick) the business portfolio
   for the legal entity that runs DesiAuction.
2. **Settings → Business info**: fill the legal name, address and website
   (`https://desiauction.in`) exactly as they appear on the company documents.
3. **Settings → Security Centre → Start verification**. Upload the incorporation
   certificate / GST / Udyam document Meta asks for. The website must show the
   same legal name — the Legal Centre footer does, once
   `apps/web/src/content/company.ts` is filled.

Verification is what lifts the new-number limits (step 9) and is required for
the display name review. It usually takes 1–5 working days.

## 2. The app and the WhatsApp Business Account

1. **developers.facebook.com → My Apps → Create app** → type **Business** →
   attach it to the verified business portfolio.
2. In the app dashboard, **Add product → WhatsApp → Set up**. This creates a
   **WhatsApp Business Account (WABA)** under the business.
3. **App settings → Basic**: set the Privacy Policy URL
   (`https://desiauction.in/legal/privacy`) and Terms URL, then switch the app
   to **Live** mode. A development-mode app only delivers webhooks for test
   numbers.
4. Still on **App settings → Basic**: **App secret → Show**. Copy it.
   → `WHATSAPP_APP_SECRET` (it signs every callback Meta sends us).

## 3. The phone number and display name (wait)

1. **WhatsApp Manager → Phone numbers → Add phone number.** Use a number that
   is **not** registered on the WhatsApp or WhatsApp Business app (or delete
   that account first). A landline works; verification is by voice call.
2. **Display name**: `DesiAuction`. It must match the brand on the website.
   Meta reviews it; until it is approved, messages show the number only.
3. Open the number → copy the **Phone number ID** (a long number — *not* the
   phone number itself).
   → `WHATSAPP_PHONE_NUMBER_ID`
4. Set a two-step verification PIN on the number and keep it with the other
   secrets (SECRET_ROTATION.md). Losing it makes re-registering the number slow.

## 4. A permanent token (System User)

The temporary token on the "API Setup" page expires in 24 hours. Production
needs a System User token:

1. **business.facebook.com → Settings → Users → System users → Add** →
   name `desiauction-server`, role **Admin**.
2. **Assign assets**: the app (full control) and the WhatsApp account
   (full control).
3. **Generate new token** → pick the app → expiry **Never** → permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. Copy the token (it is shown once).
   → `WHATSAPP_ACCESS_TOKEN`

Rotation: generate a new token for the same System User, deploy it, then revoke
the old one (SECRET_ROTATION.md).

## 5. The callback URL (webhook)

This is where Meta tells us what became of each message (sent → delivered →
read, or failed) and where people's replies land — **STOP among them**. A
WhatsApp number whose replies go nowhere cannot be told to stop, which breaks
Meta's policy and the DPDP Act, so **production refuses to boot** with sending
configured and these two secrets unset.

1. Choose a verify token: any random string of 16+ characters, e.g.
   `openssl rand -hex 24`.
   → `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
2. Deploy `web.env` with `WHATSAPP_APP_SECRET` and
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN` set **first** — Meta calls the URL the moment
   you save it, and the route answers 404 until it is configured.
3. App dashboard → **WhatsApp → Configuration → Webhook → Edit**:
   - **Callback URL**: `https://desiauction.in/api/webhooks/whatsapp`
   - **Verify token**: the value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - **Verify and save.** Meta sends a `GET` with `hub.challenge`; the route
     echoes it back only if the token matches.
4. **Webhook fields → `messages` → Subscribe.** That one field carries both the
   delivery statuses and the inbound messages. Nothing else is read.
5. Press **Test** next to `messages`. Meta posts a sample payload signed with the
   app secret. Expect a `200` in the Caddy webhook access log
   (`/api/webhooks/whatsapp`) and a `whatsapp callback handled` line in the web
   log. A `401` means `WHATSAPP_APP_SECRET` is not this app's secret.

What the route does, so you can check it:

| Meta sends | We do |
|---|---|
| a status for a message the outbox sent | move `message_outbox.delivery_status` forward only (sent → delivered → read; failed only before a delivery, and final). Meta's timestamp becomes `delivered_at` / `read_at`; a failure keeps its code and title in `delivery_error`. |
| a status for anything else (e.g. a sign-in code) | ignore it |
| "STOP" (or unsubscribe, cancel, end…) | record it in `whatsapp_inbound`, append a `whatsapp.updates` consent row with `granted = false`, reply "You won't get DesiAuction updates on WhatsApp any more. Reply START to turn them back on." |
| "START" (or subscribe, resume, yes…) | record it, append `granted = true` for a number we know, reply "WhatsApp updates from DesiAuction are back on. Reply STOP any time." |
| anything else | record the keyword as `unknown`, reply nothing — this is not a chatbot |
| the same message again (Meta retries) | nothing — each message id is handled once |

Message bodies are never stored — only the keyword a message was read as —
and `whatsapp_inbound` rows are deleted after 90 days by the scheduled
feedback job (`FEEDBACK_JOB_SECRET`), and at once on account erasure.

Sign-in codes are **not** affected by STOP: they are sent only when the person
asks for one, and "turn off updates" must never lock anyone out of their account.

## 6. Templates (wait)

Everything we send first (not as a reply) must be an **approved template**.

1. **Authentication template — the sign-in code.** WhatsApp Manager → Message
   templates → Create → category **Authentication** → **Copy code** button,
   language English (`en`). Meta writes the text itself. Put its approved name
   in `WHATSAPP_TEMPLATE_NAME`, and its language code in
   `WHATSAPP_TEMPLATE_LANGUAGE` if it is not `en`.
2. **Utility templates — the personal messages.** The list, the exact text to
   submit (English and Hindi) and a suggested name for each are in
   [WHATSAPP_TEMPLATES.md](WHATSAPP_TEMPLATES.md). That sheet is generated from
   the code (`pnpm --filter @desiauction/web wa:sheet`). Submit them from the
   admin page (6.3) — it sends exactly that text — or by hand in WhatsApp
   Manager, character for character. A template with no approved name mapped
   (or set in env) is simply not sent on WhatsApp.
3. **Status and mapping — `/admin/notifications/templates`** (platform admins
   only). Needs the **WhatsApp Business Account id**: WhatsApp Manager →
   **Account tools → Business account id** (or the app dashboard's WhatsApp →
   API Setup page, "WhatsApp Business Account ID").
   → `WHATSAPP_BUSINESS_ACCOUNT_ID` (the System User token from step 4 already
   carries `whatsapp_business_management`, which this uses).

   On that page, per message:
   - **Map / Change** — the approved name this message goes out under, and the
     languages it is approved in. It takes effect from the next send (within
     30 seconds on every server), wins over the `WHATSAPP_TEMPLATE_<KEY>` env
     var, and warns when Meta's last status sync has not seen the name
     APPROVED. **Clear mapping** falls back to the env var.
   - **Meta status** per language — Approved / Pending / Rejected (with Meta's
     reason) / Paused / Disabled, and the quality rating. Read with **Refresh
     from Meta** (at most once a minute) and every six hours by the scheduled
     feedback job (`FEEDBACK_JOB_SECRET`).
   - **Submit to Meta…** — sends the code's own template (body, samples, footer,
     button) for approval under a name you choose, in English, Hindi or both;
     the dialog shows the exact request. The status shows **Pending** at once.
     Nothing changes for players until you **map** the approved name — the
     page offers "Use <name>" once Meta approves a name submitted from it. The
     sale message has a picture header, whose sample image Meta needs uploaded
     separately: submit that one in WhatsApp Manager, then map it here.
   - The sign-in template (`WHATSAPP_TEMPLATE_NAME`) is shown read-only with its
     status: whether anybody can sign in is never changed from a screen.
   - Every map, clear and submit is on the audit log with your name; a mapping
     change can be reverted from the page's "Recent changes".

   Without the WABA id the page still maps names; it just cannot show Meta's
   verdict or submit, and says so.

Submit in **Utility**, not Marketing: these are consequences of the person's
own registration (a sale, a named role, a lineup). Meta may re-categorise a
template it reads as promotional — if it does, reword it, do not accept
Marketing.

## 7. `web.env`

```sh
OTP_PROVIDER=whatsapp
LOGIN_DEFAULT_METHOD=email            # keep email as the front door at launch (see below)
WHATSAPP_PHONE_NUMBER_ID=…            # step 3
WHATSAPP_ACCESS_TOKEN=…               # step 4 — System User, never expires
WHATSAPP_TEMPLATE_NAME=…              # step 6.1 — approved authentication template
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_APP_SECRET=…                 # step 2.4 — App settings → Basic
WHATSAPP_WEBHOOK_VERIFY_TOKEN=…       # step 5.1 — yours, 16+ chars
WHATSAPP_BUSINESS_ACCOUNT_ID=…        # step 6.3 — optional: Meta status + submit in admin
WHATSAPP_TEMPLATE_…=…                 # optional fallback per template; map names in admin instead (6.3)
```

No `MSG91_*` variable is needed. `pnpm preflight:production --env=web.env`
checks the WhatsApp credentials and both webhook secrets (its warning about
unset `WHATSAPP_TEMPLATE_*` names is advisory: it reads the env file, not the
names mapped in admin — the admin grid is the truth), and only warns about
SMS if phone is the default login door: with no SMS fallback a Meta outage
would close that door, so leave `LOGIN_DEFAULT_METHOD=email` until SMS is live
(the phone tab stays one click away).

## 8. Prove it

1. **Sign-in:** on a phone that has never used the product, choose the phone
   tab on /login. The code arrives on WhatsApp within seconds.
2. **Opt-in and a message:** tick the WhatsApp box on /account (or at
   registration), trigger a message (e.g. announce a test lineup). It arrives
   on WhatsApp; in the database its `message_outbox` row has a
   `provider_message_id` and, within a minute, `delivery_status = delivered`,
   then `read` once opened.
3. **STOP:** reply `STOP`. The confirmation arrives; the latest
   `whatsapp.updates` consent row for that person is `granted = false`; the next
   personal message is not sent to them on WhatsApp. Reply `START` and it flips back.

## 9. Quality rating and limits

- A new number can start conversations with **250** unique people per 24 h.
  Meta raises the tier automatically (1K → 10K → 100K → unlimited) as long as
  the number sends steadily at the current tier with a **Medium or High quality
  rating**. Business verification (step 1) is what makes the first raise possible.
- Quality falls when people **block or report** the number. The things that
  protect it are the things this product already does: opt-in only, utility
  messages only, STOP honoured at once, no marketing.
- Watch **WhatsApp Manager → Insights / Phone numbers** for the rating. If it
  drops to Low, Meta may pause a template or lower the tier — pause any bulk
  send (a whole squad sheet) until it recovers.
- Replies inside the 24-hour window after someone writes to us are free-form
  and free of charge; everything else is a template and billed per conversation
  by category (authentication and utility are the cheap ones in India).
