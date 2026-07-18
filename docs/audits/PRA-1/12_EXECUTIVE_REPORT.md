# PRA-1 · 12 — Executive Report

**Date**: 2026-07-16 · **Method**: zero-assumption repository audit; every claim verified in code.
**Question**: *Can a customer discover, purchase, onboard, operate and use this product without engineering assistance?*

## Verdict: **NO.** Not close — and the distance is measurable, bounded, and closable.

## The one-paragraph truth

This repository contains an excellent **auction-night operator tool** wrapped in a
**nonexistent product**. Org setup, registration operations, fixtures, and the live
auction room are deep, real, state-complete, and e2e-tested — an organizer handed
the right URLs can run a genuinely superior auction night today. But no customer can
*reach* any of it: the homepage is an engineering placeholder, sign-in codes are
deliverable only to a developer-machine inbox, the signed-in landing page links
nowhere, people have no names, the money pipeline goes dark at exactly the moment
money appears, and there is no pricing, billing, support, admin, legal, or marketing
surface of any kind. The platform has also never been deployed anywhere.

## Five findings that define the situation

1. **The front door is fictional.** OTP delivery is hard-wired to a dev inbox
   (`apps/web/src/server/auth/actions.ts:77`); no SMS adapter exists. Combined with
   the placeholder homepage (`app/page.tsx`) and zero deployment, **customer count is
   structurally capped at zero.**

2. **Seventeen real features are invisible.** There is no navigation shell; the
   entire app contains one static internal link. Login dead-ends at `/account`.
   Discoverability, not capability, is the binding constraint on the built surface.

3. **The money loop dies at the gavel.** Settlement and financial operations —
   obligations, collections, receipts, GST invoices, Tally exports, fiscal close —
   are fully coded and completely headless: no screen, no HTTP route, no delivery
   channel. The product's core promise ("the money is beyond dispute… receipts are
   already done") is unfulfillable by any user.

4. **People are phone numbers.** Accounts are created nameless (`otp.ts:146`); the
   registration form asks only for a playing role; only organizer CSV import ever
   sets a name. The "night that looks like television" currently calls out lots with
   no names on them.

5. **Zero commercial existence.** The billing model is thoroughly specified
   (`docs/45`) and thoroughly unbuilt: no pass, no entitlement, no invoice, no
   pricing page, no analytics, no support, no terms/privacy. There is nothing to buy
   and no one watching.

## "If I invited 100 real customers tomorrow, what would fail first?"

**Failure 0 (before tomorrow starts)**: there is no URL to invite them to — the
product has never been deployed.

Assume you deploy tonight. Then, in order, within the first hour:

1. **~100/100 fail at login** — no SMS provider; nobody receives a code. *Product dead on arrival.*
2. Fix SMS overnight → **~95 fail at orientation**: they land on `/account`, see their phone number and a passkey button, and have no link to anywhere. They leave.
3. The ~5 who type `/competitions` (because you told them) create competitions, share registration links → **players register as nameless phone numbers**; organizers assume the product is broken.
4. The 2–3 who push through run an auction night that **actually works and impresses** — then ask "how do owners pay and where are the receipts?" and discover the answer is *WhatsApp and a spreadsheet* — the exact thing they were promised an escape from.
5. All of them hit an error or a mistyped URL at some point and land on an unbranded default Next.js screen with no way back; none can find help, a human, or a refund policy, because none exist.

## The asymmetry worth acting on

The hard parts are done; the missing parts are cheap relative to what exists.
Every gap above is either founder-external (accounts, credentials, deploy — already
itemized in `docs/operations/PRODUCTION_CHECKLIST.md`) or a thin product layer over
domain code that already works (settlement console over `packages/settlement`;
notification UI over the existing dispatch rows; nav shell over existing routes;
name capture over the existing people table). Nothing found by this audit requires
re-architecture.

**Path**: R0 make-it-real (deploy + SMS) → R1 shell/identity/legal → R2 money
surfaces → private beta (10 tournaments) → public beta at the 31-item gate
(11_PUBLIC_BETA_CHECKLIST.md). Estimated 3–4 months of product-focused work to a
defensible public beta — provided the roadmap stops adding engineering layers and
starts finishing the product around the ones it has.

## Deliverables index

01 Inventory · 02 Personas · 03 Journeys · 04 Screen matrix · 05 Feature matrix ·
06 Content · 07 UX · 08 Completeness scores · 09 Missing phases · 10 Roadmap ·
11 Beta checklist · 12 This report — all under `docs/audits/PRA-1/`.
