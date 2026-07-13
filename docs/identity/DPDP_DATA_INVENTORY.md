# DPDP DATA INVENTORY · IDENTITY & TENANCY

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · Permanent subsystem document (IP-2, C-24)

> Factual inventory of personal data in the identity subsystem under India's
> **DPDP Act 2023**. Documents **implemented behavior only** — where an obligation is
> not yet implemented, that is stated, with the phase that owns it. Storage location
> today: local docker-compose PostgreSQL 17 (development; no production environment
> exists yet — IP-0 founder tail). Production target: **Neon, Mumbai region** (C-24);
> photos (IP-3+): S3/MinIO `ap-south-1`.

## 1 · Data map (implemented tables, personal-data columns)

| Table · column                                   | Personal data                       | Purpose                                                        | Collected via                                | Retention (implemented)                                     |
| ------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `people.phone`                                    | Mobile number (identity anchor)     | Authentication, account identity (C-24)                         | Login form, first successful OTP verify       | Life of account — **no deletion path implemented** (§4)      |
| `people.name`                                     | Display name                        | Display to fellow org members                                   | **No capture UI exists yet** — column is null in practice (IP-3) | as above                                    |
| `people.photo_consent_at` / `photo_consent_via`   | Consent fact (photo)                | DPDP consent evidence for player photos (C-25 × R-9)            | **Designed, not captured** — capture UX ships with IP-3 registration (§5) | as above                       |
| `otp_codes.phone` + `code_hash` + `request_ip`    | Phone, hashed code, requester IP    | Login codes; rate limiting (phone 5/h, IP 20/h)                 | OTP request                                   | Codes dead ≤ 5 min; **rows retained, no purge job** (R-6 manual SQL) |
| `otp_inbox.phone` + `code` (plaintext)            | Phone, live code                    | **Development-only** delivery (`/dev/inbox`; 404 in production — proven) | Dev OTP request                     | Dev DB only; R-1 grants production roles nothing on it       |
| `sessions.user_agent` (+ `token_hash`)            | Device description                  | Account-security device list; session continuity                | Login                                         | Revoked/expired rows retained (audit); no purge job          |
| `passkey_credentials.name` (+ public key, counter, transports) | Device name (user-supplied), public key material | Passkey login; credential management        | Passkey enrollment                            | Until user removes (hard delete, implemented) or account ends |
| `audit_log` (actor, action, subject, meta)        | Behavioral trail (logins, grants, device names in meta) | Security evidence, self-service visibility, org accountability | System-written on sensitive actions | **Append-only, indefinite** (D8; immutability grant-enforced + tested) |
| `org_members`, `grants`, `invites` (person ids, `granted_by`, `accepted_by`) | Person ↔ org links, who granted what | Membership + permission management                | Org creation, invite acceptance, grant issuance | Grants soft-revoked (`revoked_at`), rows retained            |
| `organizations.name/slug` + `created_by`          | Creator link (org data otherwise)   | Tenancy                                                         | Create-org form                               | Life of org                                                  |

**Not collected:** passwords (never — C-24), email (post-IP-6 channel), biometrics
(passkey biometry never leaves the user's authenticator — only public keys are
stored), payment data (IP-6), photos (IP-3).

## 2 · Purpose & grounds (as implemented)

Phone, OTP, session, and passkey data serve exactly one purpose: **operating the
account the person asked for** — authentication, continuity, and their own security
surface. Grant/membership/audit data serve **org accountability** — who may act and
who did act. There is no analytics use, no advertising use, no sale, and no sharing
with third parties in the implemented system. No separate consent artifact is
captured at login today; the login form states what will happen ("We'll send a
6-digit code"). A DPDP-grade notice + consent record at first signup is **not
implemented** — pre-GA obligation, owned alongside the deletion path (§4).

## 3 · Disclosure surfaces (implemented)

A person's phone and (future) name are visible to **fellow members of the same org**
(members panel) — necessary for member management, protected by the full trust chain
+ RLS ([THREAT_MODEL.md](THREAT_MODEL.md) §5–6). The last-10 security events are
visible **only to the person themselves** (`/account`). Nothing identity-related is
public (C-23: contact details of people are never public).

## 4 · Deletion & data-principal rights (factual status)

| Right (DPDP)             | Status                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Erasure / account deletion | **Not implemented.** No self-serve or operator flow deletes a `people` row or its graph. Pre-GA obligation; must reconcile with `audit_log` append-only retention (grant-enforced) and future money-trail obligations (IP-6) — likely outcome: anonymize `people`, retain audit facts |
| Correction               | Name: no edit UI yet (IP-3). Phone: no change flow (phone _is_ the identity anchor; a change flow is a pre-GA design item) |
| Access (what you hold on me) | Partial, self-service: sessions, passkeys, last-10 events on `/account`. No export artifact          |
| Grievance                | Not implemented (pre-GA, with the consent notice)                                                        |
| Deletable today          | Passkey credentials (self-serve hard delete) · sessions (revocable; rows retained) · OTP rows (operator SQL, R-6) |

## 5 · Photo consent — designed now, captured at IP-3 (C-25 × DPDP, R-9)

Schema fields exist and are null until capture: `photo_consent_at` (when) and
`photo_consent_via` (how — e.g. `registration_form`, `organizer_upload_attestation`).
Consent points defined for IP-3 registration: the player (or the organizer attesting
on their behalf — the `via` value records which) consents at photo upload, **before**
any rendering on Stage/Owner Room/Overlay surfaces. No photo may render without a
non-null `photo_consent_at` — this becomes an IP-3 acceptance criterion. Withdrawal =
photo removal + consent fields nulled; the branded placeholder (C-25) makes removal
non-degrading by design.

## 6 · Audit evidence available today

Per person: `auth.login.otp`, `auth.login.passkey`, `auth.otp.lockout`,
`auth.passkey.enrolled/renamed/removed`, `auth.session.revoked`. Per org:
`org.created`, `invite.created/accepted/revoked`, `grant.issued/revoked` (actor,
subject, capability set, timestamp). Immutability is grant-enforced and tested
(AUDIT PROOF). This trail is the evidence base for both security response (R-4/R-5)
and future DPDP inquiries.
