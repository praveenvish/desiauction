# PRA-1 · 05 — Feature Matrix

> Backend capability → does it have UI, navigation, permissions, API, docs, demo?
> Classification: **Implemented** (usable end-to-end by a customer) · **Backend-only** ·
> **UI-only** · **Missing** (designed in docs, no code).

| Capability | UI | Reachable via nav | Permissions | HTTP/API | Customer docs | Demo | Classification |
|------------|----|-------------------|-------------|----------|---------------|------|----------------|
| Phone-OTP auth | ✅ /login | ✅ (redirects) | n/a | server actions | ❌ | ✅ e2e | **Implemented (dev only — no SMS provider adapter exists)** |
| Passkeys (enroll/login/rename/remove) | ✅ /account, /login | 🔴 only via /account | self | server actions | ❌ | ✅ e2e | Implemented |
| Session management/revocation | ✅ /account | 🔴 | self | server actions | ❌ | ✅ | Implemented |
| Security events | ❌ | — | — | — | ❌ | tests | **Backend-only** (`auth/security-events.ts`) |
| Profile (name, photo) | ❌ none | — | — | — | — | — | **Missing** (people.name settable only via organizer CSV import) |
| Organizations CRUD | 🟡 create only | 🔴 typed URL | ✅ membership | server actions | ❌ | ✅ e2e | Implemented (create); settings **Missing** |
| Org invites (capability sets) | ✅ | 🔴 | ✅ grants | server actions | ❌ | ✅ | Implemented (delivery manual) |
| Venues & grounds | ✅ | 🔴 | ✅ | server actions | ❌ | ✅ | Implemented |
| Competition lifecycle | ✅ | 🔴 | ✅ authz.ts | server actions | ❌ | ✅ | Implemented |
| Teams | ✅ add | 🔴 | ✅ | server actions | ❌ | ✅ | Implemented (no edit/remove UI verified) |
| Player self-registration | 🟡 | 🔴 link-only | ✅ | server actions | ❌ | ✅ | **Under-built** (role only) |
| Registration ops (triage/bulk/CSV) | ✅ deep | 🔴 | ✅ | server actions | ❌ | ✅ e2e | Implemented |
| Fixtures (generate/schedule/publish/conflicts) | ✅ deep | 🔴 | ✅ | server actions | ❌ | ✅ e2e | Implemented |
| Auction setup (owners, paddles, purses, lots) | ✅ cockpit | 🔴 | ✅ conduct capability | actions + engine | ❌ | ✅ e2e | Implemented |
| Live bidding (WS, increments, undo, freeze, recover) | ✅ | 🔴 | ✅ | engine `/command`, `/ws` | ❌ | ✅ e2e | Implemented |
| SOLD ceremony | ✅ | 🔴 | ✅ | WS | ❌ | ✅ e2e | Implemented |
| Spectator mode | ✅ public | 🔴 no public index | public read-only | WS | ❌ | ✅ | Implemented (undiscoverable) |
| Auction ledger/replay/diagnostics | ✅ | 🔴 | 🟡 engine page gating unverified | actions | ❌ | ✅ | Implemented |
| Settlement intake/cases/obligations | ❌ | — | authz.ts exists, unused by UI | ❌ none | ❌ | seed script only | **Backend-only** |
| Collections & payments (manual methods) | ❌ | — | — | ❌ | ❌ | perf scripts | **Backend-only** |
| Razorpay gateway | ❌ | — | — | **adapter never instantiated in prod code; no webhook route; no env keys** | ❌ | tests | **Backend-only (unwired)** |
| Journal + checkpoints | ❌ | — | — | ❌ | ❌ | tests | **Backend-only** |
| Settlement closure ceremony | ❌ | — | — | ❌ | ❌ | scripts | **Backend-only** |
| FinOps documents (receipt/tax-invoice/correction, GST posture) | ❌ | — | — | ❌ | ❌ | tests | **Backend-only** |
| FinOps dispatch (in-app/outbox) | ❌ no inbox UI | — | — | ❌ | ❌ | tests | **Backend-only** |
| FinOps exports (CSV register, Tally XML) | ❌ no download | — | — | ❌ | ❌ | tests | **Backend-only** |
| Fiscal periods / year-end close | ❌ | — | — | runner loop | ❌ | tests | **Backend-only** |
| Audit log | ❌ viewer | — | — | ❌ | ❌ | tests | **Backend-only** |
| Billing / passes / entitlements | ❌ | — | — | ❌ | designed in docs/45 | ❌ | **Missing** (zero code, zero tables) |
| Platform notifications (SMS/email/WhatsApp) | ❌ | — | — | ❌ | designed in docs/47 | ❌ | **Missing** |
| Reports / standings / season outcomes | ❌ | — | — | ❌ | ❌ | ❌ | **Missing** |
| Platform admin / tenant overview | ❌ | — | — | ❌ | ❌ | ❌ | **Missing** |
| Public API / outbound webhooks | ❌ | — | — | ❌ | designed in docs/50 | ❌ | **Missing** |
| AI import assistant | ❌ | — | — | ❌ | designed in docs/35 | ❌ | **Missing** |

## The headline ratio

Of ~34 identifiable capabilities: **17 implemented** (all clustered in org→competition→registration→fixtures→auction), **10 backend-only** (all of settlement + finops + audit), **7 missing** entirely (all commercial/communication/administration).

Read as a money pipeline:

```
Registration → Auction → [gavel] → Obligations → Collection → Receipt → Books
✅✅✅✅✅✅✅✅✅✅         ⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛
        product surface ends exactly where money begins
```

## Navigation column note

"🔴 typed URL" pervades because no navigation shell exists — see 07_UX_AUDIT. Features being implemented does not make them *findable*; today every feature is dark until someone pastes a link.
