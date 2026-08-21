# UX-1 — Product inventory and information architecture

## The surface, counted

79 routed pages, swept signed-out and signed-in as a founder holding every
capability the product has (`org:owner` + `settlement:controller` +
`finops:controller` + `platform:admin`), so no surface was unreachable.

| Area | Routes | Shell | Notes |
| --- | ---: | --- | --- |
| Marketing & company | 16 | public | landing, features, pricing, about, security, careers, blog, case studies, API docs, releases, rules, contact, schedule-demo, support, search ×2 |
| Help & legal | 9 | public | help index, category, articles; legal index and policies |
| Public competition | 3 | public | `/c` directory, `/c/[slug]`, `/c/[slug]/p/[number]` |
| Auth & onboarding | 2 | public / bare | `/login`, `/onboarding` |
| Console home & account | 7 | console | home, inbox, account, money, orgs, tournaments ×2 |
| Organization workspace | 8 | console | org, venues, settlement, money ×4, tournament |
| Season workspace | 14 | console | overview, teams, registrations, readiness, fixtures ×3, standings, register, money ×2 |
| Auction | 10 | live / bare | hub, live, cockpit, spectate, replay, ledger, engine, board, overlay |
| Platform administration | 8 | console | overview, orgs ×2, users ×2, audit, health, messaging |
| Misc | 2 | bare | gallery, 404 |

Four shells decide chrome by pathname (`nav.ts:24-70`): **public**, **console**,
**live** (chrome-free but branded) and **bare** (overlay, venue board,
onboarding, gallery).

## The navigation, as built

This is one of the strongest parts of the product and the audit changes nothing
about its shape.

**Primary rail — four items.** Home · Tournaments · Organizations · Help.
`nav.ts:78-107` records why it is four rather than the five the original canon
demanded, why slot 2 became Tournaments rather than Seasons, and why `/money`
was removed. The reasoning is explicit, dated and correct; a comment that
contradicts the array beneath it is exactly how a stale claim survives, and this
one says so about itself.

**Contextual tabs** appear only inside a container: seven on a season (Overview,
Teams, Registrations, Fixtures, Table, Auction, Money), five on administration,
four on organization money. Money tabs are **absent**, not disabled, for anyone
without `settlement.view` — matching the surfaces themselves, which 404.

**The live shell** replaces all chrome with one exit door, which is right: the
auction room is a place you are *in*.

Every structural check came back clean across all 109 records: exactly one `h1`
per page, no heading-level skips, exactly one `<main>`, `lang="en"` everywhere,
no image without `alt`.

### The three things worth changing

1. **`/admin/messaging` is not in the model at all** (F-4) — no tab, wrong tab
   highlighted, duplicated identity bar.
2. **`/money` is reachable from nothing** (F-18) — a real receipts page for the
   people who paid, documented as deliberately unlisted during beta.
3. **One label out of four calls `/c` "seasons"** (F-10).

### Naming, reviewed and left alone

The brief asked for a page-by-page renaming pass. Working through it, the
existing vocabulary is already better than the generic alternatives:

| Term | Keep? | Why |
| --- | --- | --- |
| Tournament / Season | **Keep** | A tournament recurs ("BPL"); a season is the edition that runs ("BPL 2"). The distinction is in the schema, the URL structure and the organizer's own language. Collapsing it would lose information. |
| Readiness | **Keep** | Names the question it answers. "Setup checklist" would be vaguer. |
| Cockpit / Board / Overlay / Stage | **Keep** | Four genuinely different surfaces for four different screens in the room. Renaming them "Auction 1..4" would be worse. |
| Settlement / Finance | **Keep** | They are different capabilities on purpose (`settlement.view` vs `finops.view`), and the product is right to keep the words apart. |
| Paddle, Lot, Purse, Gavel | **Keep** | Auction vocabulary the users already speak. |

The one term that does not survive review is **"All seasons"** as the label on a
link to a page headed "Tournaments" (F-10).

## Roles

Four capability partitions, and they do not imply one another — which is the
product's most important and least obvious idea, stated plainly in the help
centre ("Roles are grants, not titles"):

| Grant | Reaches |
| --- | --- |
| `org:owner` / `org:staff` | the organization and its seasons |
| `settlement.view` / `settlement:controller` | the Money tabs and settlement desk |
| `finops.view` / `finops:controller` | the finance console, registers, documents |
| `platform.admin` | `/admin`, and nothing else — an org owner is not a platform admin |

Data gating is decided on the server and obeyed in the client: a bidder sees
their own purse and the public bid feed, never a rival's remaining money
(`live-panel.tsx:330-345`). This was a known past defect; it is closed.
