# PX-1 · 07 — Product Gap Matrix

> Backend capability → required UI → current UI → gap → priority.
> Every "required UI" cell references a blueprint (06 P-xx). No gap requires backend change; the ⚙ column is the only new code besides UI.

| Backend capability (frozen, existing) | Required UI | Current UI | Gap | ⚙ thin wiring | Priority |
|---|---|---|---|---|---|
| OTP auth (`requestOtpAction`/`verifyOtpAction`, OtpSender port) | P-08 login | ✅ built | Name gate; redirect to /home; **SMS adapter for the existing port** | `updateProfileAction`; SMS OtpSender impl | **P0** |
| Passkeys + sessions | P-09 account | ✅ built | Shell + profile card | — | P0 |
| people.name column | Name everywhere | ❌ never captured | Name gate + profile edit | `updateProfileAction` | **P0** |
| Orgs/members/invites/grants | P-12/P-13 | ✅ built | Shell only | — | P0 |
| Venues/grounds | P-14 | ✅ built | Shell only | — | P1 |
| Competition lifecycle/teams | P-16 | ✅ built | Tabs, stepper, public-page ShareField | — | P0 |
| Registration pipeline (8 actions) | P-17 + P-06 | ✅ console built | Public competition page; mobile collapse | `publicCompetitionView` | **P0** |
| Fixtures (13 actions) | P-18 | ✅ built | Shell + mobile | — | P1 |
| Auction setup/conduct/live/ledger/replay | P-19…P-25 | ✅ built | Shells, engine-page gate, phone pass | — | P0/P1 |
| Spectator view | P-25 + P-06 | ✅ built, undiscoverable | Public page CTA | (shared) | P0 |
| **Settlement writer** (openCase…closeCase, waive, void, reopen) | **P-26 settlement console** | ❌ none | Entire screen | capability-gated action wrappers | **P0** |
| Manual collections (`createPayment`, `attestManualCapture`, `refundManualPayment`) | P-26 record card | ❌ none | Entire flow | (same wrappers) | **P0** |
| Case/payment/journal folds | P-27 case detail | ❌ none | Entire screen | read wrappers | P1 |
| Closure ceremony + evidence | P-26 ceremony panel | ❌ none | Panel | read wrapper | P1 |
| Razorpay adapter + `handleRazorpayWebhook` | (behind flag; no beta UI) | ❌ unwired | Webhook route + env keys + staging transaction | `/api/webhooks/razorpay/route.ts` | P2 (flagged) |
| Auction sold projections (`ledgerView`) | P-28 results | ❌ none | Entire screen | read composition | P1 |
| Person-scoped money (paddles→teams→obligations; documents by party) | P-29 my money | ❌ none | Entire screen | `myMoneyView` | **P0** |
| FinOps documents (`issueReceipt/Invoice/Correction`, `receiptCandidates`, `issueDueReceipts`) | P-30 Documents tab | ❌ none | Entire tab | wrappers | P1 |
| FinOps dispatch (in-app adapter writes rows; `recoverDispatch`, `confirmDispatchManually`) | P-11 inbox + P-30 Dispatches | ❌ none | Inbox + queue | person-scoped read | P1 |
| FinOps exports (CSV register, Tally XML, artifact store) | P-30 Exports + downloads | ❌ none | Tab + streaming route | download route | P1 |
| Fiscal periods (open/attest/exception/close, evidence) | P-30 Fiscal tab | ❌ none | Tab | wrappers | P2 |
| Runner/follower/provider health snapshots | P-30 Health + P-32 admin | ❌ none | Panels | read wrappers | P1 |
| audit_log table | P-33 viewer | ❌ none | Screen | read query | P2 |
| Grants mechanism (scoped capabilities) | `platform.admin` gate | ✅ mechanism | Platform-scope grant seed | seed script | P1 |
| env validation / healthz / Sentry / images / workflows | production deploy | ✅ code | **First actual deploy** (founder externals) | — | **P0** |
| — (no backend; static) | P-01…P-05, P-07 marketing/legal/help/errors | ❌ none | Entire public site | — | **P0** |

## Reading the matrix

- **P0 rows** = the beta-blocking set: shell+home+name, public site, public competition page, settlement console, my-money, SMS adapter, deploy. Everything else polishes.
- **No row requires a thaw.** The two closest calls are ruled in 01 §7: no competition-settings tab (backend lacks edit), inbox read-tracking (ships read-only if the freeze bars a `seenAt` column).
- The Razorpay row is deliberately P2-flagged: beta collects via the manual methods the writer already certifies; gateway money enters only after one verified staging transaction (ops checklist §3).
