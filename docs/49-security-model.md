# 49 — Security Model

> Canon: C-13, C-14, C-24 · v1.0 · 2026-07-11

## Threat model (what actually attacks this product)

| Threat | Answer |
|--------|--------|
| **Bid manipulation** (the existential one: insider or outsider altering money) | Single-writer engine, append-only ledger, DB-level immutability, hash-chained audit (48), grant-traced bids (invariant 9–11) |
| Account takeover (owner phone/OTP) | OTP rate limits + device binding on live sessions + passkeys upsell for repeat users; owner sessions re-verify before first bid of a live auction |
| Token leakage (public links shared beyond intent) | Tokens are narrow capabilities (36), revocable, expiring; redaction at read model (invariant 35); no PII on public surfaces (invariant 8) |
| Tenant bleed | `org_id` everywhere + **Postgres RLS as defense-in-depth** (C-13): even a query bug can't cross tenants; break-glass is the only cross-tenant read (invariant 1) |
| Scraping/abuse of public stage | Rate limits, no enumerable IDs (ULIDs), no bulk PII exists publicly to scrape |
| Payment fraud | Hosted checkout (no PAN data), HMAC webhooks, reconciliation sweep (46) |
| Insider (us) | No platform write path to tenant money (invariant 9); break-glass read-only + audited (37) |

## AuthN

- **Phone-first** (C-24): OTP (WhatsApp→SMS) for all account creation; **passkeys** offered immediately after first login (the durable, phishing-proof upgrade); email+password intentionally not offered (one less credential class to defend; the reference's password-reset stub was a known scar).
- Sessions: httpOnly, Secure, SameSite=Lax cookies; short-lived access + rotating refresh; device list + remote sign-out in Settings.
- Step-up: `tournament:override` actions and billing require re-auth within 10 min (28 ladder 4 pairs with step-up).

## AuthZ

Grants model (36) with one policy module; deny-by-default; read models grant-filtered at query time; 404-not-403 for non-members (no existence leaks); UI state is never the boundary (36).

## Application security

- All input validated at the boundary with the shared zod contracts (29/50) — one schema, both sides.
- Standard headers: strict CSP (nonce-based, no unsafe-inline), HSTS, X-Frame-Options deny (Overlay's embed route gets a scoped frame-ancestors exception), Referrer-Policy strict.
- Rate limiting: per-IP, per-identity, per-capability tiers (bids get a dedicated, generous-but-bounded limiter tuned to auction pace; OTP gets a hostile-grade one, 42).
- SSRF-guarded webhook egress (URL allowlist policy, private-range block); HMAC-signed payloads (C-14).
- Secrets: platform KMS/managed store, never in env-committed files; rotation runbook (61); production config validated by a fail-closed startup check (the reference's `production:check` pattern, kept as behaviour).
- Supply chain: lockfile-pinned, Renovate + audit gate in CI (59), no post-install scripts without allowlist.

## Data protection (DPDP Act 2023, C-24)

- **Minimization by design**: the standard registration form is the minimal set (42); PII-flagged custom fields excluded from public read models automatically.
- Purpose limitation: player data serves the tournament; cross-org visibility requires consent (38); no advertising use, ever.
- **Erasure**: right-to-erasure pseudonymizes identity and preserves money facts (invariant 4) — documented publicly in the privacy policy so the promise is inspectable.
- Data residency: primary region Mumbai (C-13); processors (Razorpay, WhatsApp BSP, Sentry) documented in a public subprocessor list.
- Breach process: severity ladder, notification obligations, and the honesty rule — affected orgs hear from us first (03 §5).

## Verification

- CI: SAST (Semgrep ruleset), dependency audit, secret scanning (59).
- Pre-GA: external penetration test focused on the engine, tokens, and tenancy; annual re-test.
- Security review is one of the eight phase-gate reviews for every implementation phase (README).
