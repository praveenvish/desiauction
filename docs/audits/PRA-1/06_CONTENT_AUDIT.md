# PRA-1 · 06 — Content Audit

> All copy in the shipped surfaces, plus what copy does not exist.

## 1. What's good (verified, not assumed)

The copy that exists is deliberate, human, and market-aware — no Lorem Ipsum, no
AI filler anywhere in product code (grep for `lorem|TODO|FIXME|coming soon` across
`apps/web/src` and `packages/ui/src` returns only legitimate input `placeholder=`
attributes and a component named "placeholder identity").

- Help text is specific: "We'll send a 6-digit code. India (+91) only for now." (`login-form.tsx:37`)
- Errors are actionable: "That invite link is no longer valid — ask the organizer for a fresh one." (`orgs/page.tsx:22`)
- Empty states teach the next step: "Create one inside an organization to add teams and open registration." (`competitions/page.tsx:57`)
- Input examples are localized and charming (Malad Premier League, Azad Maidan, Malad Mavericks).
- OTP failure modes are enumerated user-safely (cooldown, hourly-limit) rather than leaking internals (`otp.ts`).

## 2. Placeholder / engineering text shipped to users

| Location | Text | Problem |
|----------|------|---------|
| `/` (`page.tsx:8-11`) | "DesiAuction NEXT … Engineering foundation · version dev" | The homepage is an engineering artifact. This is the single worst content defect in the product. |
| `layout.tsx:11` | "Tournament auctions, taken seriously." | Fine as a tagline, but it is the *only* marketing sentence in the entire repository. |
| `README.md` | "Status: Phase 2 — Implementation. Active phase: IP-0" | Stale by six phases; misleads anyone evaluating the repo. |
| `/gallery` | Internal design-system demo | Ungated in production; internal vocabulary ("FLOODLIGHT", token names) exposed. |

## 3. Content that does not exist at all

- **Email/SMS/WhatsApp templates: zero.** There is no message copy because there are no channels. The OTP message itself has no template (`DevInboxSender` writes raw codes to a table).
- **Notification copy: zero** (no notification system).
- **Onboarding copy: zero** (no onboarding).
- **Help/FAQ/docs for customers: zero.** 70+ internal design documents exist under `docs/`, none customer-facing.
- **Legal: zero.** No terms, privacy, refund policy (a public refund policy is explicitly required by `docs/45-billing-model.md`), or cookie/consent text.
- **SEO/social copy: zero** — no OG title/description/image, no per-page descriptions beyond `<title>` strings.

## 4. The name gap (content-level consequence)

Accounts are created with **phone only** (`otp.ts:146`). The registration form asks
for a playing role and nothing else (`register-form.tsx`). The account page renders
`{session.name ?? "— (set during registration)"}` (`account/page.tsx:29`) — copy that
promises a capture step which **does not exist** for self-registered users. Every
downstream surface (registration tables, lots, ceremony, spectator view) degrades to
initials-from-nothing or raw phone numbers. This is a copy promise the product breaks.

## 5. Microcopy consistency

- Button labels are verb-first and consistent ("Send code", "Accept invitation", "Generate fixtures").
- Status vocabulary is consistent underscore-to-space rendering (`replace(/_/g, " ")`) but statuses render lowercase ("registration open") — fine, though unstyled raw enums like `SOLD`/`UNDO` appear in the ledger.
- Titles follow "X · DesiAuction" convention across all pages (verified in each `metadata` export) — good.
- The internal codenames Console/Stage/Owner Room from `docs/16-navigation-system.md` never appear in the UI; navigation vocabulary is entirely absent because navigation is absent.

## 6. Tone risks for public beta

The docs define a strong voice ("Money is physics, not opinion", dignity rules,
"honest states"). None of that voice exists in the product yet because the surfaces
that would carry it (landing, pricing, receipts, notifications, ceremony copy for
players) are unbuilt. The auction room is the only place the brand promise is
experienced — and only by people who were handed a URL.
