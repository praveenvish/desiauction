# 30 — Table Standards

> Canon: C-7, C-15 · v1.0 · 2026-07-11

## One component

`DataTable` (19) renders every table in the product: TanStack Table core, tokens-only styling, both density modes (10). Hand-rolled tables are lint-banned. Column definitions are typed and colocated with the screen; behavior (sort, select, paginate) is the component's.

## Anatomy & behavior

- **Header:** sticky; sortable columns show direction on the active sort only (one visible sort at a time; multi-sort exists via Shift but renders subtly); header cells announce sort state (13).
- **Rows:** entire row is the click target for peek/navigation (31); hover raises `surface-raised`; row height 40px comfortable / 32px dense.
- **Selection:** leading checkbox column appears only when the view has bulk actions; Shift-range works; a selection bar replaces the toolbar with count + actions ("3 selected · Approve · Reject") and an always-visible clear.
- **Row actions:** ≤ 2 inline icon-actions; overflow to a `⋯` menu; destructive actions live only in the menu, never bare.
- **Pagination:** cursor-based "Load more" + infinite scroll on Console lists (50); classic numbered pages only in audit/ledger views where positional citation matters ("page 3 of the ledger").

## Column type conventions

| Type | Rule |
|------|------|
| Money | Right-aligned, tabular, `Money` renderer (C-7); column ∑ in footer where meaningful (purse tables) |
| Numbers/counts | Right-aligned, tabular |
| Status | `Badge` with icon+text (never color-only, 13) |
| Person/team | `Avatar` + name, leading column, never truncates below 12ch |
| Timestamps | Relative for freshness columns, absolute in audit/money contexts (20 rule 7) |
| Actions | Trailing, fixed width |

## Responsive recomposition (14)

Below `bp-md`, tables **recompose** — never horizontal-scroll as the primary experience:

- List-critical tables (registrations queue) become stacked `EntityCard` lists (31) with the same actions.
- Reference tables (audit) keep horizontal scroll with pinned first column, but gain a card-per-row expanded view.
- The column set that survives recomposition is declared in the column definition (`priority: 1|2|3`).

## The ledger view (special table)

Auction ledger and audit tables carry extra contract: mono `seq`/ID columns (09), absolute timestamps, append-only visual grammar (new rows enter at top with a settle animation during live, 11), no row deletion affordances ever, and export always available (invariant 33). The ledger is the trust artifact — it must *look* incorruptible: no hover edit affordances, no inline mutation of any kind.

## States

Loading = column-true skeleton (23); empty = the four kinds (22); error = zone error with retry (24); every table spec declares all of them (69).
