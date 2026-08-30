# Email Setup (2026-08-30)

Two systems that are deliberately NOT the same system, on two domains that are
deliberately NOT the same domain.

| | Mailboxes | Transactional |
|---|---|---|
| Domain | `desiauction.in` (root) | `mail.desiauction.in` (subdomain) |
| Provider | Zoho Mail, Forever Free, **India DC** | Resend, Tokyo (`apne1`) |
| Carries | Humans reading and replying | Registration receipts, demo confirmations |
| Cost | ₹0 (5 users, 5 GB each) | ₹0 (3k/month tier) |

**Why the split.** Bulk transactional mail earns bounces and spam complaints.
If it went out on the root domain, a bad send would degrade the reputation of
the domain `privacy@` and `navrangi@` depend on — and those two are statutory
contacts we do not get to have delivered unreliably. Sending lives on a
subdomain with its own SPF and DKIM so the blast radius stops there. Resend
recommends the same split for the same reason.

DNS is at **Hostinger** (`ns1/ns2.dns-parking.com`), not Cloudflare. The zone
editor is hPanel → Domains → DNS Records.

## Mailboxes (Zoho)

One user, `praveen@desiauction.in`. Everything else is an **alias** onto it —
aliases consume no seat, and all mail lands in one inbox.

Four of the aliases are not preferences. They are published by the codebase and
cannot be renamed without a code change:

| Alias | Obligation | Source |
|---|---|---|
| `support@` | Contact page + demo-page mailto | `apps/web/src/content/legal.ts` |
| `privacy@` | DPDP data-protection contact | `legal.ts`, `content/company.ts` |
| `navrangi@` | **Grievance Officer**, IT Rules 3(2) | `company.ts` — and in `REQUIRED_FOR_PRODUCTION` |
| `conduct@` | Code-of-conduct reports | `legal.ts` |

`navrangi@` carries a published obligation: complaints acknowledged within 24
hours, resolved within 15 days. It has to be a mailbox somebody reads.

Also present, no obligation attached: `hello@`, `no-reply@`, `billing@`,
`careers@`, `sales@`, `social@`.

**Free-plan limits.** 5 users, 5 GB each, one domain, **no IMAP/POP/ActiveSync**
— webmail only. If a phone client becomes necessary, Zoho Mail Lite (~₹59/user/
month) is the same setup with IMAP switched on; nothing here changes.

## Sending (Resend)

Domain `mail.desiauction.in`, Tokyo region. Resend's current scheme is two
CNAMEs plus a DKIM TXT — no MX and no separate SPF TXT.

Resend "Enable Receiving" is **off on purpose**: nothing consumes inbound mail,
and `messaging/inbound.ts` is inbound *SMS* (STOP keywords), not email. Replies
are handled by `EMAIL_REPLY_TO` pointing back at the Zoho inbox.

## The zone

Root — Zoho only. Do not add the sending provider here.

| Type | Name | Content |
|---|---|---|
| MX | `@` | `mx.zoho.in` (10), `mx2.zoho.in` (20), `mx3.zoho.in` (50) |
| TXT | `@` | `v=spf1 include:zohomail.in ~all` |
| TXT | `@` | `zoho-verification=…` |
| TXT | `zmail._domainkey` | Zoho DKIM (1024-bit) |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:praveen@desiauction.in` |

Sending subdomain — Resend only.

| Type | Name | Content |
|---|---|---|
| TXT | `resend._domainkey.mail` | Resend DKIM |
| CNAME | `rsend.mail` | `rsend-apne1.forge.rmta.net` |
| CNAME | `send.mail` | `send.forge.rmta.net` |

## App configuration

Env-only. The adapter was already provider-agnostic and its default request
body is already Resend's exact shape, so no `buildRequest` override exists.

    EMAIL_API_ENDPOINT=https://api.resend.com/emails
    EMAIL_API_KEY=re_…
    EMAIL_FROM=DesiAuction <no-reply@mail.desiauction.in>
    EMAIL_REPLY_TO=support@desiauction.in

The first three together decide whether a provider counts as configured; miss
one and `transactionalMailer()` returns `UnconfiguredMailer`, which reports
`"unconfigured"` rather than pretending. `EMAIL_REPLY_TO` is deliberately
outside that check — a missing Reply-To degrades the mail, it does not disable
the provider — so it is conditionally spread into the config rather than passed
as an explicit `undefined`, which `exactOptionalPropertyTypes` would reject.

## Verifying

Query the authoritative nameserver, not a resolver. Root TXT carries a 14400
TTL, so an edit takes up to four hours to show up in cached answers and you will
otherwise chase a phantom failure:

```bash
dig @ns1.dns-parking.com TXT desiauction.in +short
dig @ns1.dns-parking.com TXT _dmarc.desiauction.in +short
dig @ns1.dns-parking.com TXT resend._domainkey.mail.desiauction.in +short
```

End-to-end, without a dev server or the `.next` cache: the harness pattern reads
`.env.local`, imports `server/marketing/demo-booking-mail.ts` and calls
`sendBookingConfirmation` at a real address. Run it as `.mts` — top-level await
fails under tsx's CJS output. `OUTCOME: sent` proves only that the API returned
2xx; delivery and alignment are proved by `Show original` on the received mail
(`SPF`/`DKIM`/`DMARC: PASS`, DKIM signed by `mail.desiauction.in`).

Verified 2026-08-30: delivered to inbox, ICS attachment intact, Reply-To
resolving to `support@`, all three checks passing.

A booking mail sent locally links to `http://localhost:3000` because
`PUBLIC_BASE_URL` defaults there. Production cannot ship that — `env.ts` refuses
to boot when serving with localhost in it, and `preflight:production` separately
requires an https origin.

## Traps

- **Hostinger appends the domain to the Name field.** Enter `_dmarc`,
  `zmail._domainkey`, `send.mail` — never the FQDN, or you get
  `…desiauction.in.desiauction.in` and a record that silently never resolves.
  This has already swallowed one DMARC record.
- **One SPF TXT per domain, ever.** A second makes both invalid. Adding a sender
  to the root means MERGING an `include:` into the existing line — but prefer
  putting the sender on its own subdomain instead, which is why this split
  exists.
- **One `_dmarc` record.** Changing policy means EDITING it. Zoho's DMARC
  "generate" screen produces a string to paste and will happily give you a
  duplicate; it configures nothing server-side and is not needed.
- **Zoho DC is chosen at signup and pinned.** India ⇒ every hostname is `.in`
  (`mx.zoho.in`, `include:zohomail.in`). Mixing in a `.com` endpoint fails
  silently.

## Open

- **DMARC is at `p=none`** — report-only. Tighten to `p=quarantine` around
  2026-09-13 after reading the aggregate reports arriving at `praveen@`, and only
  once transactional sending is confirmed aligned. Going stricter early makes our
  own mail disappear. Edit the existing record.
- **Deployment env** needs all four `EMAIL_*` vars. `.env.local` is local only.
- **DKIM keys are 1024-bit** on both domains (provider defaults). Upgrade to
  2048 if either console offers it.
