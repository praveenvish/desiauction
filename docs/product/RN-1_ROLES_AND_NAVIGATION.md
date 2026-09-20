# RN-1 — Roles, Permissions & Navigation

> Programme plan · v2, 2026-09-20 · **all decisions made — no open questions**
> Supersedes the navigation half of docs/16 and docs/17, and v1 of this document.

---

## 0. The goal, stated so it can be tested

> Whoever signs in, whatever their job, reaches it immediately — and can see at
> a glance what they have.

That is measurable, so RN-1 makes it a test rather than an aspiration:

**The One-Tap Law.** For every role, the first screen after sign-in contains
that role's next action, above the fold, reachable in **≤1 tap**. A Playwright
spec per role asserts it. If a role fails the law, the role's home is wrong.

| Role | Their one job | The one action |
|---|---|---|
| Player | *Am I in? When? What did I get?* | Open my entry / my card |
| Team owner | *Spend my purse well* | Enter the room · open my plan |
| Auctioneer | *Run tonight* | Open the cockpit |
| Organizer | *Unblock the next thing* | The top of the attention queue |
| Operator | *Is anything on fire?* | The live board |
| Newcomer | *Which am I?* | Run a tournament · or find one to play |

---

## 1. What is actually wrong

### 1.1 The role engine is sound — the navigation ignores it

`server/roles/roles.ts` already returns complete, correct facts: clubs managed,
teams owned, seasons conducted, whether they play, whether they operate the
platform. Four capability partitions sit underneath, properly isolated, with
the platform grant structurally unforgeable. **None of that changes.**

That answer is consumed in exactly three places: `railFor()` hides two items
from pure players, `roleNavGroups()` adds three groups, `/home` branches on one
boolean. The season tab strip, the ⌘K palette, `/tournaments`, `/orgs`, the
admin strip and the entire mobile experience are **membership-driven, not
role-driven**. Two navigation authorities in one product, disagreeing. That
disagreement is what reads as inconsistent.

### 1.2 The eleven defects

**D1 — Three lists in one sidebar.** `railFor()` (4 items), then
`roleNavGroups()` (up to 3 labelled groups), then `utility` (3 more). Nine links
in three visual idioms, no stated hierarchy. `product-shell.tsx:893`

**D2 — `onlyPlays` is the only role branch, and it is fragile.**
`acceptOwnerJoin` makes every team owner a **viewer-level member of the host
club**, so `memberOf.length > 0`, so `onlyPlays` is false, so a player who
accepts a team is handed the organizer's rail. `nav.ts:railFor`

**D3 — Membership is being treated as a role.** `/tournaments`, `/orgs` and the
palette are built from what you *belong to*, so a team owner's ⌘K is full of an
organizer's destinations. `product-shell.tsx:503–600`

**D4 — The season tab strip has one and a half booleans.** A team owner gets 6
tabs and neither "My plan" nor "My squad" — the only two they came for.
`nav.ts:competitionTabs`

**D5 — The auctioneer has no record.** `roles.conducts` is an array; the shell
takes `[0]`. No queue, no completed list, no résumé. The surface does not exist.

**D6 — Multi-team owners are collapsed.** `currentTeam()` returns one team; own
teams in two seasons and one vanishes. `roles.ts:216`

**D7 — Fourteen flat admin tabs**, most of which 404 for most holders.

**D8 — The admin door is gated on the wrong capability.** `adminNavVisible()`
checks `platform.admin` only, so an operator holding only `platform:support`,
`:moderation`, `:privacy`, `:demo` or `:billing` gets **no door anywhere** and
must type the URL — though their pages work. `heldPlatformCapabilities()`
already exists and the nav never calls it. `server/admin/actions.ts:188`

**D9 — `/home` is 1670 lines with `manages ?` woven through the render.** A
role's home cannot be designed or reviewed, because it is not a thing.

**D10 — Money left the rail for everyone**, including the people who have books.
A placeholder was rightly removed; a real surface went with it.

**D11 — THE BIG ONE: on a phone there is no navigation at all.**
`app-shell.module.css:86` — `.rail { display: none }`, restored only at
`min-width: 720px`. Below that the sole menu is the hamburger drawer, which
lists **clubs you belong to, Account, Help, Report a problem, Theme, Sign out**.
No Home. No Tournaments. No My team. No My plan. No Notifications. Nothing
role-aware whatsoever. `product-shell.tsx:1128–1190`

This is an India-first product for shared handsets on auction night. **The phone
is the product**, and on the phone every fix in D1–D10 is invisible because the
navigation those fixes improve is not rendered. D11 is defect #1.

### 1.3 Not wrong, do not touch
The grant model, the four partitions, the RLS locks, the shell owning the one
`h1`, the `@action` slot's server-resolved primary action, and the repaired
payload gating in `team-workspace.ts`.

---

## 2. The model

### 2.1 Correcting v1: union, not modes

v1 of this plan proposed a **Lens** — one role the product assumes you are in,
with a switcher and a cookie. Tested against the goal in §0, that is the wrong
answer. A mode is a power-user concept: it adds hidden state, a control that
must be taught, and a new question ("why am I seeing this?") in a product whose
complaint is that it is confusing. **Dropped.**

The replacement is simpler and needs no teaching:

> **Your menu is the union of what is yours, ordered by urgency, capped at five.
> Nothing that is not yours ever appears.**

No mode. No cookie. No hydration flash. Deterministic, and testable as a table.

### 2.2 Three questions, three authorities

| Question | Answered by | Derived from |
|---|---|---|
| **Who am I?** | the rail / bottom bar | role facts (global) |
| **Where am I?** | identity bar + tab strip | the URL's scope |
| **What can I do here?** | the one primary action, and the payload | capabilities on *this* scope |

Every defect above is one of these answered by the wrong authority. Nothing may
appear in two of them.

### 2.3 The seven navigation laws

Everything in RN-1 is a consequence of these. They go in `nav.ts` as the
module's doc comment, so the next change has to argue with them.

1. **One primary list.** Exactly one, at most five items. Never three.
2. **Rail = who you are. Tabs = where you are. Action = what you can do.**
3. **Offer only what is yours.** A destination that would 404 or come up empty
   is *absent* — never disabled, never present-and-apologising.
4. **Same menu on every device**, same items, same order, same active state.
5. **One name per surface**, drawn by the shell. No page titles itself.
6. **One primary action per screen**, always in the same place.
7. **Live outranks everything.** An auction you are in takes the top of the rail
   and the top of home, whatever else is true.

### 2.4 One function

`railFor` + `roleNavGroups` + the palette's ad-hoc `useMemo` collapse into:

```ts
export function navigationFor(input: {
  roles: PersonRoles;
  pathname: string;
  scopes: { orgs: OrgRef[]; seasons: SeasonRef[]; platform: PlatformCapability[] };
}): {
  rail: RailItem[];        // ≤5, role-shaped, ordered by §3.1
  context: ContextBlock | null;  // the season/org you are inside
  utility: RailItem[];     // Notifications · Account · Help · (Platform admin)
  palette: PaletteGroup[];
}
```

Pure, no IO, one vitest matrix: **role combinations × representative paths**,
asserted as a table. That file becomes the product ruling.

---

## 3. The menu

### 3.1 Composition — precedence, capped at five

Help, Account and Notifications leave the rail for a **utility** group. The rail
is *work*; utility is *services*. That frees four slots beside Home.

```
1. Home                                        always
2. Auction room / Cockpit   live or paused     LAW 7 — only while the night runs
3. My team                  owns.length > 0    popover when > 1
4. Auction nights           conducts.length > 0
5. Tournaments              organizes.length > 0
6. Organizations            organizes.length > 0
7. Money                    settlement.view or finops on ≥1 org
8. My sports                plays
9. Find tournaments         organizes.length === 0
   Help / Account / Notifications / Platform admin  → utility, always
```

Take the first five. **Overflow is safe** because Home is the union surface —
every role's summary lives there, so a dropped item is always exactly one tap
away. That is why the cap can be hard.

### 3.2 What each person actually sees

| Person | Rail |
|---|---|
| Newcomer | Home · Find tournaments |
| Player | Home · My sports · Find tournaments |
| Team owner (idle) | Home · My team · Find tournaments |
| Team owner (**live**) | Home · **Auction room** ● · My team · Find tournaments |
| Auctioneer | Home · Auction nights · Find tournaments |
| Auctioneer (**live**) | Home · **Cockpit** ● · Auction nights · Find tournaments |
| Organizer | Home · Tournaments · Organizations · Money† |
| Organizer who owns a team | Home · My team · Tournaments · Organizations |
| Operator | as above, **+ Platform admin** in utility |

† only when they hold the books.

**Membership is not a role.** `memberOf` confers read access and **never** a
menu item — that alone fixes D2 and D3 without touching `acceptOwnerJoin`,
which is load-bearing for read access.

### 3.3 The phone gets the same menu (D11)

The same five items become a **bottom tab bar**: icon + short label, same
order, same active state, 44px targets, safe-area inset. This is the idiom
every Indian consumer app already taught our users; a hamburger costs an extra
tap and hides the whole product behind it.

- The bar is absent on `live` and `bare` shells — the auction room already owns
  the viewport by `shellKind`, so it never fights the bid controls.
- The hamburger survives for **utility only**: Account, Help, Theme, Report a
  problem, Platform admin, Sign out. The same rail/utility split as desktop.
- Below 720px the tab bar replaces the rail; above it, the rail. One model,
  two renderings, one test matrix.

### 3.4 No context block — corrected in Phase 1

An earlier draft gave the rail a small "context" block naming the season you
are inside, with 2–4 role-relevant doors. Building it, that block turned out to
**break LAW 2**: the tab strip already answers "where am I", the breadcrumb
already names the scope, and the season switcher already lives in the top bar.
A context block would be a third list restating all three — the exact defect
LAW 1 exists to prevent.

**Dropped.** `NavModel` is `{ rail, utility }` and nothing else. One fewer list
is the better product, and the laws caught it before the pixels did.

### 3.5 Two rules the model surfaced while being built

**The page you are on always has a seat.** The cap is hard, so a busy organizer
who also plays loses "My sports" to it. Walking to `/me` — reachable from their
home, which is the whole justification for a hard cap — then lit *nothing*, and
a menu that cannot say where you are is worse than a long one. The item
claiming the current path now displaces the lowest-precedence one. Home keeps
slot 1; the cap still holds at five. Pinned by test.

**`shellKind` must become session-aware for `/c` (Phase 2).** "Find
tournaments" is a player's most-used rail item and `/c` is a *public* surface,
so today it navigates them out of the shell that drew the item and the whole
chrome changes under them. Phase 2 gives `shellKind` a `hasSession` argument —
the way `liveExit` already has one — so a signed-in visitor keeps their menu
while browsing the directory. Noted in `nav.ts` at the item itself.

### 3.6 Say it when the menu changes

Accepting a team invite, being appointed auctioneer, or being granted staff
changes the menu. Silent change is the confusion; the product says it once:

> **You're now a team owner for Demo Panthers.** Your menu has a new item — *My team*.

An inline notice on the next page load, dismissed permanently on first sight.

---

## 4. Home, per role

`/home` becomes a ~40-line router over five files, none over 350 lines. This is
the highest-leverage change: it is what makes each role's experience
designable, reviewable and testable as a unit.

Every home opens with the same two lines, drawn by the shell:
**a greeting**, and **an identity line that says what you have** —
*"Organizer · Malad Cricket Club · 3 seasons · 1 live"*,
*"Team owner · Demo Panthers · ₹1.2 Cr left"*,
*"Player · 2 seasons · 1 awaiting approval"*.
That line is the founder's "they know exactly what they have."

**4.1 Player** — one next step · my seasons (status, squad and team once sold,
poster when ready) · my record · find a tournament · and last, quiet and
permanent, *want to run your own?*. Nothing else. No lifecycle rail, no money,
no attention queue, no shortcuts.

**4.2 Team owner** — auction state hero (countdown → *Enter the room* →
squad) · my squad with price each and purse remaining · my plan · what I owe ·
one door to the public season page, **not** the organizer's.

**4.3 Auctioneer** *(new surface — D5)* — **Tonight** with the cockpit door ·
**Queue**: every season they conduct that is unfinished, with date, club and
readiness · **Completed**: season, date, lots sold, total spend. The
auctioneer's record, which the product currently cannot produce.

**4.4 Organizer** — today's `manages === true` branch lifted intact. No
behaviour change beyond extraction in this phase.

**4.5 Newcomer** — the existing `choose-path` step, full-bleed. Two doors.

A person with several roles gets several sections on one Home, in the
precedence order of §3.1 — which is exactly why the rail can cap at five.

---

## 5. The season workspace

`competitionTabs(slug, canSettle, canManage)` → `seasonTabs(slug, role)`,
where role is resolved **for that season**, not globally:

| Role in this season | Tabs |
|---|---|
| organizer / staff | Overview · **Players** · Teams · **Schedule** · Auction · Money* · Reviews |
| auctioneer | Overview · Teams · Auction |
| team owner | **My team** · **My plan** · Auction room · Table |
| player | Overview · My entry · Table · Auction |
| member / public | Overview · Table · Auction |

Two consolidations take the organizer from 9 tabs to 7:
**Players** = Registrations + Lineups (both are "who is in this season");
**Schedule** = Fixtures + Table (both are "when, and how it went").
\* Money only with `settlement.view` — absent, not disabled.

This is the deepest fix: the season is the one place where a person's role
genuinely differs per object, and it is currently the place that asks the least.

---

## 6. Administration

**The door (D8).** `adminNavVisible()` → `operatorDoor()`, backed by the
existing `heldPlatformCapabilities()`. *Any* platform capability opens a door,
and the door lands on the first section that person can actually use — `/admin`
for `platform.admin`, `/admin/reports` for a support-only operator.

**Fourteen tabs → four groups.**

| Group | Sections | Capability |
|---|---|---|
| Platform | Overview · Health · Audit | `platform.admin` |
| Live | Live board · Auctions | `platform.admin` |
| People & trust | Users · Organizations · Moderation · Erasure | `.admin` / `.moderate` / `.privacy` |
| Commercial | Passes · Demos · Reports · Reviews · Newsletter · Messaging | `.pass` / `.demo` / `.support` / `.admin` |

**Show only the sections whose capability you hold.** Today's rule is the
opposite — all fourteen shown to everyone, most 404ing — so that comparing
screens cannot reveal who holds what. That rule buys a leak-prevention *between
colleagues who are all staff of this company*, and pays for it with eight dead
clicks per visit, forever, for exactly the operators who are least senior. The
trade is bad. **The 404-on-direct-URL behaviour is untouched** — that is the
real boundary, and it keeps every property the capability engine proves.

---

## 7. Data visibility — the standing rule

> A capability gates the **payload**, never the button. If a read model resolves
> `canManage` and uses it only to hide UI, it is wrong.

Answering "for whom do we show the player list":

| Reader | Sees |
|---|---|
| Organizer / staff of the club | Every registration: name, phone, role, fee, notes |
| Auctioneer of that season | The pool: name, role, base price. **No phones, no fees** |
| Team owner | Own squad in full; rivals' squads **after the hammer only**; **never** a rival's remaining purse before the lot closes |
| Player | Own entry in full; the published pool; own squad once sold |
| Club member (viewer) | What the public sees |
| Public | Published pool and results, per `visibility` |

The team-owner row is **competitive integrity**, not only privacy: a rival's
remaining purse leaking mid-auction decides the auction. Each row is pinned by
a served-payload assertion (`response.text()`, never the DOM).

---

## 8. Routing

One module, `server/auth/destination.ts`. These decisions are currently spread
across `login/page.tsx`, `auth/actions.ts:368/499/831`, `otp.ts:280`,
`onboarding-gate.ts` and `orgs/actions.ts:727`.

| Situation | Destination |
|---|---|
| Signed out, protected route | `/login?next={safeNext(path)}` |
| Signed in, no name | `/onboarding?next=…` |
| `next` present | `safeNext(next)` |
| No `next`, **an auction they are in is live** | straight into the room / cockpit (LAW 7) |
| No `next`, otherwise | `/home`, which routes by role |
| Registration token | back to `/seasons/{slug}/register` |
| Owner invite accepted | `/seasons/{slug}/auction/plan` |
| Demo / review token | the public surface, session or not |

Re-stated so it is not re-broken: **a `loading.tsx` above a gated page commits
HTTP 200 before the gate runs**, destroying `redirect()` and `notFound()` alike.
Gate first, then stream.

---

## 9. Premium — the specifics

"Premium" is a set of decisions, not an adjective:

- **Gold is reserved.** The accent marks the active menu item and the one
  primary action. Nothing else earns it.
- **One motion grammar.** The active indicator *moves* between items
  (transform-only, ≤180ms); it never cross-fades. Honours
  `prefers-reduced-motion`.
- **Live is the only thing that pulses**, and it pulses a dot by `transform`,
  never text by `opacity` — an opacity keyframe on text fails contrast scans
  mid-frame.
- **Badges are counts you can act on.** Notifications, attention. Never
  decorative.
- **Icons: one weight, one grid**, every rail item — the icon is the phone
  bar's whole affordance.
- **Empty states teach.** Never "no data"; always what belongs here and the one
  way to start. One per role, per surface.
- **Skeletons match the final shape**, so nothing jumps. The `@action` slot
  already proved the cost of getting this wrong (CLS 0.123 on /home).
- **44px everywhere**, and the phone bar respects the safe-area inset.

---

## 10. Delivery — six phases, reordered

Mobile moves to Phase 2: fixing a menu nobody can see on a phone is not a fix.
Zero migrations in the whole programme.

| # | Phase | Ships | Proof | Est. |
|---|---|---|---|---|
| 1 | **The model** — ✅ **DONE** | `navigationFor()`, `seasonRoleFor()`, `seasonTabs()`, `operatorDoorHref()`, the seven laws as `nav.ts` canon | **53 tests green**, typecheck + lint + format clean. No UI change. | done |
| 2 | **The menu, both devices** — ✅ **DONE** | Rail + bottom bar from one model; drawer reduced to utility; multi-scope nested list; palette from the menu; every platform set gets a door | Verified in-browser at phone width per role; 5-tab label clipping measured and fixed. **Role-change notice deferred to a follow-up** — it needs a per-viewer "what have you seen" store and is the lowest-value item in the phase. | done |
| 3 | **Home** — ✅ **DONE** | `/home` → 161-line router over 6 role homes (member is the sixth); the new auctioneer home; the identity line | `home-router.test.ts` pins which sections each role gets; verified in-browser as owner, organizer+player+operator, auctioneer+player | done |
| 4 | **The season** — ✅ **DONE** | `seasonTabs(slug, role)` wired; `seasonRoleFor` resolved per season in the layout; `activeSeasonTab` replaces the fixed path→key table; Players/Schedule consolidation with `claims` + sibling links | 87 unit tests; **full e2e 130 passed, 0 failed** | done |
| 5 | **Trust** | Admin grouped into 4; door on held capabilities; the §7 payload matrix | Served-payload assertion per row; one operator per platform set reaches their section in one click | 3–4 d |
| 6 | **Premium** | §9 in full; palette rebuilt from `NavModel.palette`; per-role empty states | Full precompiled e2e; `pnpm verify`; axe in **both** themes; computed-style contrast; target-size | 3–4 d |

**≈ 4 weeks, one person, sequential.** Phases 1–3 deliver the whole complaint.

**Verification discipline** (learned here, not optional): run precompiled
(`PLAYWRIGHT_PRECOMPILED=1`) and hands-off — no edits mid-run; kill stale
servers by pattern *and* port (`next-server` renames itself); axe in both
themes; assert computed styles, not tokens; scope queries to
`getByRole("dialog")` because a closed `FormDialog` keeps its form in the DOM.

---

## 11. Out of scope, deliberately

- Any change to a grant, capability set, RLS policy or gate. Authorization is
  sound; RN-1 changes only what is **offered**.
- Any migration.
- Any new role. Every role here already exists — RN-1 gives each one a shape.
- A visual redesign. This reuses the console kit, the gold accent and the
  existing shells. The complaint is structural, and §9 is the finish on top.
