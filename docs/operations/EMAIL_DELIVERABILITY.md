# Email deliverability — the proof, before every release that touches email

Email programme PR19. `docs/EMAIL_INFRASTRUCTURE.md` says how mail is wired
(SES, DNS, bounces). This page says how we **prove** it lands, looks right and
stays out of spam — what a script checks, and the short list a person does.

## 1. The automatic half — `mail:deliverability`

```bash
pnpm --filter @desiauction/web mail:deliverability -- --provider=ses --ns=ns1.dns-parking.com --dkim=lgwx7ikjosf5mwl5nre3qy5uioc4byin,7hmmiygebgoshfoe3oadjjaamddizyyi,w4rliyz3b6fcz4nja6n4zumrdos7xg2e --report=deliverability.md
```

It prints pass / warn / fail, with the fix beside each, and exits 1 on any fail.

| Half | Checks |
|---|---|
| Authentication (live DNS, asked of the authoritative server) | SPF on `bounce.mail.` authorises SES · the bounce MX points at SES · each DKIM CNAME points at `dkim.amazonses.com` · DMARC exists (warns while `p=none`) · exactly one SPF record at the root |
| Content (every design × language × version, as sent) | under Gmail's 102 KB clip · a non-empty text part · subject ≤ 78 characters · no `<script>` · every link https and on our own domain · every image has `alt`, `width` and `height` · `lang` on `<html>` |

The content half also runs in CI on every push (`deliverability.test.ts`,
"finds no failure in any design we send").

**Result on 2026-09-28** (SES, authoritative DNS): 7 pass · 1 warn · 0 fail.
The warning is DMARC `p=none` with no `rua=` — see §4.

## 2. The person's half — before the first release, and after any layout change

Send the real designs to yourself (one at a time, SES sandbox-safe):

```bash
pnpm --filter @desiauction/web mail:test --to=you@example.com --template=all --language=en
pnpm --filter @desiauction/web mail:test --to=you@example.com --template=all --language=hi
```

Then tick each client. For each, open **four** mails: the sign-in code, "you
were sold" (the stage), a match-day note (the matchup) and a receipt (the
document).

| Client | Light | Dark | What to look at |
|---|---|---|---|
| Gmail — web | ☐ | ☐ | not clipped ("[Message clipped]" never appears); the code is one tap to copy |
| Gmail — Android app | ☐ | ☐ | the stage and matchup panels stay dark and legible |
| Gmail — iOS app | ☐ | ☐ | Hindi renders in Noto Sans Devanagari, not boxes |
| Apple Mail — iPhone | ☐ | ☐ | dark mode uses our dark palette, not an inverted one |
| Outlook — web | ☐ | ☐ | the gold button is a button, not a link |
| Outlook — Windows desktop | ☐ | — | tables hold their widths; nothing overlaps |
| Yahoo Mail — web | ☐ | ☐ | the footer's "Manage emails" works |

In Gmail, **Show original** on any one mail must read `SPF: PASS`,
`DKIM: PASS`, `DMARC: PASS`.

## 3. A score from outside — mail-tester

1. Open <https://www.mail-tester.com>, copy the one-time address.
2. `pnpm --filter @desiauction/web mail:test --to=<that address> --template=auction.sold`
3. Target **10/10**. Anything under 9 names its reason; fix that, not the score.

## 4. What to change, and when

| When | Change |
|---|---|
| Now | Add `rua=mailto:dmarc@desiauction.in` to `_dmarc` (keep `p=none`) so reports arrive — Zoho can host the mailbox. |
| After a clean month of reports | `p=quarantine; pct=25`, then 100, then `p=reject`. |
| Before production access in SES | Google Postmaster Tools for `desiauction.in` (domain verification by TXT) — spam rate stays under 0.1%, never near 0.3%. |
| Always | Bounces and complaints are handled by the SES webhook (`EMAIL_INFRASTRUCTURE.md` → Bounce and complaint handling); a complaint suppresses that address for good. |

## 5. Web push — first device test after deploy

Web push (PR18) needs `WEB_PUSH_*` set (`pnpm --filter @desiauction/web push:keys`,
once per environment). Then on a phone and a laptop: `/account` →
Notifications → **Notifications on this device** → on, and trigger any inbox
notice (announce a lineup to a test player). The notification must arrive,
and tapping it must open `/inbox`. On an iPhone, add DesiAuction to the Home
Screen first — Safari only allows web push from there.
