# PRA-1 · 04 — Screen Matrix

> Every screen, audited for: real data, states (empty/loading/error), responsiveness, accessibility.
> "Real API" = calls server actions against the live schema (nothing in this app uses dummy data — the gap is absence, not fakery).
>
> Responsive column: the app's shared stylesheets `competitions.css`, `orgs.css`, `login.css`,
> `account.css` contain **zero `@media` rules** (verified per-file); only `auction.css` (2) and
> `gallery.css` (1) have any. Grids may reflow via CSS but no screen has been designed for mobile.
> Accessibility column: 16 `aria-` attributes exist across the whole app; live surfaces have an
> announcer; forms use labeled Fields; no skip links, no focus management on route change.

| Screen | Purpose | Implemented | Real data | Empty state | Loading state | Error state | Responsive | Verdict |
|--------|---------|-------------|-----------|-------------|---------------|-------------|------------|---------|
| `/` | Landing | ❌ placeholder text | n/a | n/a | n/a | n/a | n/a | **Placeholder** |
| `/login` | Sign in | ✅ | ✅ | n/a | ✅ button pending | ✅ field errors + OTP limits | ❓ untested | Complete for dev; **broken in prod (no SMS)** |
| `/account` | Profile/security | ✅ | ✅ | ✅ | ✅ | ✅ toasts | ❓ | **Dead end** (no links out, no profile edit) |
| `/orgs` | Org list/create | ✅ | ✅ | ✅ EmptyState | ✅ | ✅ invite-invalid alert | ❓ | Complete |
| `/org/[slug]` | Members/invites | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | Complete (no settings) |
| `/org/[slug]/venues` | Venues/grounds | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | Complete |
| `/competitions` | List/create | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | Complete |
| `/competitions/[slug]` | Console | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | Complete (no edit/settings) |
| `…/register` | Player signup | 🟡 | ✅ | ✅ closed/na states | ✅ | ✅ | ❓ | **Under-built: role only, no name/photo** |
| `…/registrations` | Ops console | ✅ deep | ✅ | ✅ | 🟡 `data-hydrated` flag, no skeletons | ✅ | ❓ desktop-table | Complete (desktop only) |
| `…/fixtures` | Fixture ops | ✅ deep | ✅ | ✅ | 🟡 | ✅ conflicts panel | ❓ desktop-table | Complete (desktop only) |
| `…/fixtures/calendar` | Calendar | ✅ | ✅ | ✅ | 🟡 | ✅ | ❓ | Complete |
| `…/fixtures/match-day` | Match day | ✅ | ✅ | ✅ | 🟡 | ✅ | ❓ | Complete |
| `…/auction` | Hub | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | Complete |
| `…/auction/live` | Bidder room | ✅ | ✅ WS | ✅ no-lot | ✅ "Connecting…" | ✅ connection state badge | 🟡 auction.css has 2 media rules | Complete |
| `…/auction/cockpit` | Conductor | ✅ | ✅ WS | ✅ queue-empty | ✅ | ✅ needs-resolution | 🟡 | Complete |
| `…/auction/spectate` | Public watch | ✅ | ✅ WS | ✅ | ✅ | ✅ | 🟡 | Complete |
| `…/auction/replay` | Replay | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | Complete |
| `…/auction/ledger` | Event ledger | ✅ | ✅ | ✅ | server-rendered | ✅ | ❓ wide table | Complete |
| `…/auction/engine` | Diagnostics | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | Complete (should be role-gated ops-only) |
| `/join/[token]` | Org invite | ✅ | ✅ | ✅ invalid-token | ✅ | ✅ | ❓ | Complete |
| `/owner-join/[token]` | Owner invite | ✅ | ✅ | ✅ invalid-token | ✅ | ✅ | ❓ | Complete |
| `/gallery` | Design demo | ✅ | static | n/a | n/a | n/a | ✅ 1 media rule | **Should not ship publicly** (ungated) |
| `/dev/inbox` | OTP inbox | ✅ | ✅ | ✅ | ✅ | 404 in prod | n/a | Correctly dev-gated |

## Screens that do not exist but must (first-order)

| Missing screen | Why it's required | Blocking persona |
|----------------|-------------------|------------------|
| Landing/marketing page | Discovery, trust, conversion | Visitor |
| Pricing page | Public pricing is a stated invariant (`docs/45`, invariant 27) | Visitor |
| Terms / Privacy | Legal minimum for collecting phone numbers in production | All |
| Profile / set-name screen | Accounts are nameless (otp.ts:146) | Player, everyone |
| Global navigation shell | Only 1 static internal link exists in the app | All |
| Home/dashboard after login | `/account` is a dead end | All |
| Settlement console (collections, obligations, discharge) | The money loop has no UI | Owner, Treasurer |
| Receipts/documents viewer + download | finops documents are unreachable | Owner, Treasurer |
| Notifications/inbox surface | in-app dispatch rows are written, never rendered | Player, Owner |
| Public competition page | Registration/spectate links need a home | Player, Spectator |
| Results/standings | Season has no outcome surface | All |
| Platform admin console | Operating 100 tenants blind | Founder |
| Help/support/contact | "without engineering assistance" fails by definition | All |
| 404/error pages | Default Next screens today | All |
