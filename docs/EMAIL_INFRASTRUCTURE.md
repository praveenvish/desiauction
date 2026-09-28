# Email Infrastructure

Application email (sign-in codes, registration, auction results, receipts,
demo bookings) is sent through **Amazon SES** in **Mumbai (`ap-south-1`)**.
Business mailboxes stay on **Zoho Mail**, untouched. Resend is kept configured
as the rollback until SES has run cleanly for a few weeks.

Status (2026-09-28): code merged behind `EMAIL_PROVIDER`; AWS account, SES
identity, DNS and production access are in progress — see "Setup checklist".

## Architecture

```
Hostinger VPS (web + finops-runner)
   │  HTTPS, SigV4-signed, SES v2 SendEmail
   ▼
Amazon SES ap-south-1 (shared IPs) ──► recipients' inboxes
   │  bounces/complaints
   ├─► account suppression list (automatic, free)
   └─► email report to bounces@desiauction.in (Zoho alias)

Zoho Mail (desiauction.in root) ── business mailboxes, UNCHANGED
```

- **Two domains, on purpose.** App mail is sent from
  `no-reply@mail.desiauction.in`; people mail `@desiauction.in` (Zoho). A bad
  send can only hurt the `mail.` subdomain's reputation, never the root that
  `privacy@` and the grievance officer (`navrangi@`) depend on.
- **No AWS SDK.** SES is called over its JSON API with a hand-rolled SigV4
  signer (`packages/messaging/src/sigv4.ts`, proved against AWS's published
  test vectors), the same approach the repo already uses for S3.
- **No other AWS services.** No EC2, S3, Route 53, Lambda, SQS or dedicated IP.
  SNS is an optional later step (see "Bounce and complaint handling").

### Code map

| File | Role |
|---|---|
| `packages/messaging/src/mail-provider.ts` | The wire: `MailProvider.send()` with SES and Resend implementations, `mailProviderFromEnv` |
| `packages/messaging/src/mail-provider-config.ts` | Which provider the settings select (import-free; read by both `env.ts`) |
| `packages/messaging/src/sigv4.ts` | AWS Signature V4 |
| `apps/web/src/server/auth/email-sender.ts` | Sign-in / sign-up / email-change codes (`HttpMailer`) |
| `apps/web/src/server/messaging/transactional-mail.ts` | Everything else the web sends, incl. the outbox drain (`HttpTransactionalMailer`) |
| `packages/messaging/src/email-adapter.ts` | Receipts, invoices, corrections (finops `DeliveryPort`) |
| `apps/finops-runner/src/delivery.ts` | The runner's wiring of the finops adapter |
| `apps/web/scripts/mail-test.ts` | Send ONE test email through the configured provider |

Every sender keeps its own breaker, outcomes and retry rules; only the request
format moved into the provider. SES errors are classified there:
throttling, a paused account and the daily quota are **retryable** (the outbox
backs off, the finops job retries); `MessageRejected`, an unverified identity or
a suspended account are **not**.

## Environment variables

Names only — values live in `.env.local` (dev) and `web.env` + `runner.env`
(host). Never in git, never `NEXT_PUBLIC_*`, never logged.

| Name | Tiers | Notes |
|---|---|---|
| `EMAIL_PROVIDER` | web, runner | `ses` \| `resend` \| `auto` \| `dev` (`http` = `resend`). **The rollback switch.** |
| `EMAIL_FROM` | web, runner | `DesiAuction <no-reply@mail.desiauction.in>` — shared by both providers |
| `EMAIL_REPLY_TO` | web | `support@desiauction.in` |
| `SES_REGION` | web, runner | `ap-south-1` |
| `SES_ACCESS_KEY_ID` | web, runner | IAM user `desiauction-mailer` |
| `SES_SECRET_ACCESS_KEY` | web, runner | same |
| `SES_CONFIGURATION_SET` | web, runner | `desiauction-transactional` |
| `SES_FEEDBACK_ADDRESS` | web, runner | `bounces@desiauction.in` (verified in SES) |
| `EMAIL_API_ENDPOINT` / `EMAIL_API_KEY` | web, runner | Resend — keep until cleanup |

A production process **refuses to boot** without a configured mailer, and a
named provider (`ses`/`resend`) that is half-configured is refused rather than
quietly falling back. `pnpm preflight:production` checks both tiers agree.

## AWS resources

All in `ap-south-1`. Only sending costs money.

| Resource | Name | Cost |
|---|---|---|
| AWS account | root = `thedesiauction@gmail.com`, **Paid** plan, MFA on | — |
| SES pricing plan | **à la carte** (switched from the Essentials default) | $0.10 / 1,000 |
| SES domain identity | `mail.desiauction.in`, Easy DKIM RSA-2048 | free |
| Custom MAIL FROM | `bounce.mail.desiauction.in`, on MX failure: use default | free |
| SES email identity | `bounces@desiauction.in` (feedback address) | free |
| Configuration set | `desiauction-transactional` | free |
| Account suppression list | BOUNCE + COMPLAINT | free |
| IAM user | `desiauction-mailer`, no console access, one inline policy | free |
| Budget | `monthly-5-usd`, email alert at 80% | free |

### IAM policy (inline on `desiauction-mailer`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendAsNoReplyOnly",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": [
        "arn:aws:ses:ap-south-1:<ACCOUNT_ID>:identity/mail.desiauction.in",
        "arn:aws:ses:ap-south-1:<ACCOUNT_ID>:identity/bounces@desiauction.in",
        "arn:aws:ses:ap-south-1:<ACCOUNT_ID>:configuration-set/desiauction-transactional"
      ],
      "Condition": {
        "StringEquals": { "ses:FromAddress": "no-reply@mail.desiauction.in" }
      }
    }
  ]
}
```

`ses:SendRawEmail` is not granted — attachments go through the v2 Simple
message. A leaked key can send as `no-reply@mail.` and do nothing else in AWS.
During the sandbox, recipients must be verified identities, which also limits a
leak.

## DNS (Hostinger, `ns1/ns2.dns-parking.com`)

Hostinger's Name field appends the domain — enter the part before
`.desiauction.in` only.

### Added for SES (5 records, all under `mail.`)

| Type | Name | Value |
|---|---|---|
| CNAME | `<token1>._domainkey.mail` | `<token1>.dkim.amazonses.com` |
| CNAME | `<token2>._domainkey.mail` | `<token2>.dkim.amazonses.com` |
| CNAME | `<token3>._domainkey.mail` | `<token3>.dkim.amazonses.com` |
| MX | `bounce.mail` | `feedback-smtp.ap-south-1.amazonses.com` (priority 10) |
| TXT | `bounce.mail` | `v=spf1 include:amazonses.com ~all` |

Tokens are shown in SES → Identities → `mail.desiauction.in` → DKIM; record
the real values here once published.

### Preserved — never edit or delete

| Type | Name | Value | Owner |
|---|---|---|---|
| MX | `@` | `mx.zoho.in` 10, `mx2.zoho.in` 20, `mx3.zoho.in` 50 | Zoho |
| TXT | `@` | `v=spf1 include:zohomail.in include:_spf.reach.hostinger.com ~all` | Zoho + Hostinger Reach — the ONLY SPF record at the root |
| TXT | `zmail._domainkey` | Zoho DKIM | Zoho |
| TXT | `_dmarc` | `v=DMARC1; p=none` | root policy, inherited by `mail.` |
| TXT | `@` | `zoho-verification=…` | Zoho |

SES needs **no** change to the root SPF (it sends from `mail.`, with its own
MAIL FROM), and no MX on `mail.` itself.

### Resend (remove only at cleanup)

`resend._domainkey.mail` (TXT), `send.mail` (CNAME/MX → `send.forge.rmta.net`),
`rsend.mail` (CNAME). Different names from SES's, so both coexist and rollback
is instant.

### Authentication, and why DMARC passes

- **DKIM**: SES signs with `d=mail.desiauction.in` → aligned with the From.
- **SPF**: the envelope sender is `bounce.mail.desiauction.in`, whose TXT
  authorises SES → passes, and aligns (relaxed) with the From.
- **DMARC**: passes on either. The root policy is `p=none`; tightening it is a
  separate decision, only after a clean month and with `rua=` reports back on.

Check from anywhere (authoritative, no cache):

```bash
dig +short CNAME <token1>._domainkey.mail.desiauction.in @ns1.dns-parking.com
dig +short MX bounce.mail.desiauction.in @ns1.dns-parking.com
dig +short TXT bounce.mail.desiauction.in @ns1.dns-parking.com
```

## Sending limits

- **Sandbox** (new account): 200 emails / 24 h, 1 / second, only to verified
  addresses. Enough for all testing.
- **Production access** is requested once, per region, after the site is live
  (AWS reviews the website URL — a parked domain is likely refused). Request:
  *Transactional*, `https://desiauction.in`, peak ~5,000/day, ~150,000/month.
- Need: 2–5k/day, bursts on auction nights. The outbox drains sequentially, so
  the burst rate stays well under any production send rate. If the granted
  daily quota is below 10,000, open a quota increase case (free).

## Cost

Official SES pricing (checked 2026-09-28): à la carte **$0.10 per 1,000
emails**, attachments $0.12/GB. New accounts start on the **Essentials** plan
($0.16/1,000) — switch to à la carte in SES → Pricing plan. The old 3,000/month
SES free tier ended 2026-07-21; new AWS accounts get up to $200 of credits for
6 months instead.

| Emails / month | À la carte | Essentials (default) |
|---|---|---|
| 10,000 | $1 | $1.60 |
| 50,000 | $5 | $8 |
| 100,000 | $10 | $16 |
| 200,000 | $20 | $32 |
| 1,000,000 | $100 | $160 |

Other possible charges: attachments (only the demo `.ics`, ~KB — effectively
$0); 18% GST if billed by AWS India (AISPL). Free: inbound API traffic,
identities, configuration sets, suppression list, CloudWatch SES metrics, one
budget. Never enable: dedicated IPs ($15/month + per-email), Virtual
Deliverability Manager, Mail Manager, the Pro/Enterprise plans ($105/$500 per
month).

## Bounce and complaint handling

**Now (no extra AWS service):**

1. SES account-level suppression list (BOUNCE + COMPLAINT): SES stops sending
   to an address that hard-bounced or complained.
2. Reports are emailed to `SES_FEEDBACK_ADDRESS` (`bounces@desiauction.in`,
   Zoho) for a human to see.
3. The app's own gate already sends notifications only to addresses the person
   verified with a code, which keeps bounce rates low.

AWS's review thresholds: bounce rate 5% (pause at 10%), complaint rate 0.1%
(pause at 0.5%). Watch SES → Reputation metrics weekly. Gmail does not report
complaints to SES; Google Postmaster Tools covers that gap (optional, free).

**Later (optional, ~$0 at this volume):** an SNS topic on the configuration
set, delivering Bounce/Complaint/Delivery events to a new
`/api/webhooks/ses` route that verifies the SNS signature, writes the app's
`suppressions` table and confirms finops dispatches (each receipt is already
tagged `dispatch=<id>`). The existing `/api/webhooks/delivery-status` never
worked with Resend either (it expects a shared-secret header Resend cannot send,
and top-level fields Resend nests under `data`), so this is new capability, not
a regression.

## Known limitation

SES has no idempotency key. If the process dies after SES accepted a receipt
but before the dispatch was marked sent, the retry sends it again. Resend
collapsed that duplicate; SES will not. Rare, and a duplicate receipt is
preferable to a missing one.

## Setup checklist

| # | Step | Who |
|---|---|---|
| 1 | Create AWS account (`thedesiauction@gmail.com`), **Paid** plan, root MFA, region Mumbai | Founder |
| 2 | SES → Pricing plan → à la carte | Founder / Claude |
| 3 | Budget `monthly-5-usd` with email alert | Founder / Claude |
| 4 | SES identity `mail.desiauction.in` (Easy DKIM 2048) + MAIL FROM `bounce.mail` | Claude |
| 5 | Publish the 5 DNS records in Hostinger | Founder / Claude |
| 6 | Zoho alias `bounces@desiauction.in`; verify it in SES | Founder |
| 7 | Configuration set `desiauction-transactional`; suppression list BOUNCE+COMPLAINT | Claude |
| 8 | IAM user `desiauction-mailer` + inline policy + access key → `.env.local` | Founder (key is shown once) |
| 9 | Sandbox tests (below) | Claude + founder |
| 10 | Site live; request production access | Founder submits |
| 11 | Cutover: `EMAIL_PROVIDER=ses` + `SES_*` in `web.env` AND `runner.env`, restart | Claude |
| 12 | After 2–4 clean weeks: cleanup (below) | Claude, confirmed |

## Testing

Sandbox first — every recipient must be a verified SES identity (verify your
Zoho, a Gmail and an Outlook address in SES → Identities).

```bash
pnpm --filter web mail:test --to=you@gmail.com --kind=plain
pnpm --filter web mail:test --to=you@gmail.com --kind=html
pnpm --filter web mail:test --to=you@outlook.com --kind=ics
```

Then through the app, with `EMAIL_PROVIDER=ses` locally: email sign-in code,
sign-up code, a registration notification (outbox), the demo booking (`.ics`),
and a Reply to it (must land at `support@`).

On each received mail, "Show original" / "View source" must show:

- `DKIM: PASS` with `d=mail.desiauction.in`
- `SPF: PASS` for `bounce.mail.desiauction.in`
- `DMARC: PASS`
- `Received: … amazonses.com` and **no** `resend`/`rmta.net` hop

Bounce and complaint paths, without harming reputation — SES's mailbox
simulator: `bounce@simulator.amazonses.com`, `complaint@simulator.amazonses.com`
(expect a report at `bounces@desiauction.in` and the address on the suppression
list only for real recipients, not the simulator).

Zoho must be unaffected: send to and from `praveen@desiauction.in` after the DNS
change.

## Production cutover

1. Site live, production access granted, quota ≥ 10k/day.
2. On the host, set in **both** `web.env` and `runner.env`: `EMAIL_PROVIDER=ses`,
   `SES_*`, keep `EMAIL_FROM`, keep the Resend `EMAIL_API_*` lines.
3. `pnpm preflight:production --env=web.env --runner-env=runner.env`.
4. Restart web + runner. The runner logs `emailDelivery: "ses"` at boot.
5. One controlled test (`mail:test` on the host, then a real sign-in code).
6. Watch 48 h: SES bounce < 2%, complaint < 0.1%, no `failed` spikes in the
   outbox, no `provider_rejected_*` in finops.

## Rollback

Set `EMAIL_PROVIDER=resend` in `web.env` and `runner.env`, restart. No deploy,
no DNS change (Resend's records are still published). Resend's free tier caps
at 100/day — upgrade Resend Pro ($20/month) if the rollback must last.

## Cleanup (only after 2–4 clean weeks on SES)

Safe to remove then, with confirmation:

- Hostinger DNS: `resend._domainkey.mail` TXT, `send.mail` records,
  `rsend.mail` CNAME.
- `EMAIL_API_ENDPOINT` / `EMAIL_API_KEY` from `web.env`, `runner.env`,
  `.env.local`.
- Revoke the Resend API key; downgrade/close the Resend account.

Keep the Resend provider code — it is ~40 lines and a free second route out.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Boot refused: "email needs a configured mailer" | `EMAIL_PROVIDER=ses` with a missing `SES_*` or `EMAIL_FROM` |
| `MessageRejected: Email address is not verified` | Still in sandbox and the recipient is not verified, or the From domain identity is not verified yet |
| `MailFromDomainNotVerifiedException` | `bounce.mail` MX missing/wrong; SES retries detection for 72 h |
| `SignatureDoesNotMatch` / `InvalidClientTokenId` | Wrong key pair, or a stray space/newline in the env file |
| `AccessDeniedException` | IAM policy: From address or ARN (account id, region) does not match |
| `SendingPausedException` | AWS paused sending over reputation — read the SES console notice; retries continue in the background |
| Mail in spam, DKIM pass | New domain warming up; keep volume steady, check content, add Postmaster Tools |
| Clock errors on signing | Host clock drift > 5 min — fix NTP on the VPS |
