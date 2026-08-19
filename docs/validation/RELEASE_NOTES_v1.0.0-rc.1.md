# Release Notes — v1.0.0-rc.1

**DesiAuction** — tournament player auctions, taken seriously.
Release Candidate 1 · 2026-07-18 · Branch `main` · Engineering programme CLOSED.

This is the first release candidate: the complete platform, hardened and
release-packaged. It is engineering-complete. Public launch is a **conditional
GO**, gated on founder-provisioned operational externals (not engineering) — see
[PX-12_RELEASE_CANDIDATE](PX-12_RELEASE_CANDIDATE.md).

## What's in it

The whole product, delivered across the PX programme over the frozen IP-1…IP-6
platform:

- **Identity & access** — phone-first OTP sign-in, passkeys, sessions;
  grants-not-roles authorization with four partitioned capability engines
  (org, settlement, finops, platform); tenant isolation via Postgres RLS wired
  through every mutating action under a non-BYPASSRLS role.
- **Organizer workspace** — organizations, members, invites, grants; competitions,
  teams, a readiness centre.
- **Public registration** — one-link player registration with saved drafts,
  approvals/waitlists/decline, CSV roster import; a public competition directory.
- **Live auction** — server-verified bidding on every screen at once, an
  auctioneer cockpit (call/sell/undo/pause), a synchronized SOLD ceremony, a
  public spectator stage, and self-healing recovery from a server snapshot.
- **Settlement** — a case opens automatically when the gavel falls with every
  obligation computed; record cash/UPI/bank collections; waive/adjust under a
  controller grant; close with an immutable evidence package and a ceremony.
- **Financial operations** — receipts, invoices and corrections with real
  numbering; delivery to the recipient's inbox; Tally-compatible exports verified
  against the ledger; fiscal periods and a year-end close.
- **Platform administration** — a read-only operator console: platform health,
  organization/user inspection, and an audit explorer.
- **Public surfaces** — landing, features, pricing, a help centre, a legal centre,
  support, release notes, and navigation-only search.

## Production hardening (PX-11)

- Fixed an **open-redirect** on login (`safeNext` backslash bypass) and a **stored
  XSS** on the public competition page (JSON-LD output encoding) — both with
  permanent regression coverage.
- Added a **Content-Security-Policy** plus Referrer-Policy and Permissions-Policy;
  a web **readiness probe** (`/readyz`) distinct from liveness; engine **graceful
  shutdown** on SIGTERM; PII-safe log redaction; and a `no-circular` architecture
  gate (the one type-only cycle fixed).

## Release engineering (PX-12)

- **`pnpm preflight:production`** — a cross-service, fail-closed configuration
  gate to run before every deploy.
- Operator documentation: beta onboarding, known limitations, issue reporting,
  the production checklist, deployment, disaster recovery, and secret rotation.

## Rollback posture

At this tag, PX-2 through PX-12 had added **zero database migrations** (schema
stable at 15, 0000–0014), so rollback to the previous image was a pure app-image
swap.

> **Superseded — 2026-08-19.** Do not carry this sentence forward to a later
> release. Migrations 0015–0026 shipped after this tag (schema is at 27), and
> `0019_tournaments.sql` renames a table and drops a column. Migrations are
> forward-only; there are no down migrations. Rolling back a release that ships a
> migration requires expand/contract or a restore point —
> [DEPLOYMENT §Rollback](../operations/DEPLOYMENT.md#rollback).

## Verification (this RC)

Fresh and green: TypeScript, lint, Prettier, dependency boundaries (incl.
`no-circular`), package unit tests, web integration (419), engine integration
(64), production build (57 static pages at this tag; 75 on the current branch), accessibility
(axe across all surfaces), security headers, and the production preflight (both
directions).

## Known limitations & launch gate

Launch requires founder-provisioned externals: SMS (login-critical), managed
Postgres with the confirmed app role, S3 storage, DNS/TLS, Sentry DSNs, and the
staging performance certification. Razorpay live keys and email/WhatsApp are not
launch-blocking (manual capture + the in-app inbox cover beta). Full list:
[KNOWN_LIMITATIONS](../operations/KNOWN_LIMITATIONS.md).

## Rollback procedure

Redeploy the previous app image. No database action. Roll back if `/readyz` or
engine `/healthz` does not go green, a smoke step fails, or a confirmed S1
(money integrity / data loss / auth broken / auction blocked) is not resolvable
in place. Criteria: [PX-12_RELEASE_CANDIDATE](PX-12_RELEASE_CANDIDATE.md) §7.

## Post-freeze

No source changes after this tag except approved release-blocking fixes
(critical defects, security vulnerabilities, deployment blockers, compliance,
release-blocking regressions), each with root cause, risk assessment,
verification, a release note, and rollback validation. Future work follows
semantic versioning; PX milestone numbering ends here.
