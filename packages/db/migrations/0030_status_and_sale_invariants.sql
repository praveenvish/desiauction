-- WHAT THE STATUS COLUMNS ACTUALLY MEAN, SAID AT THE DATABASE.
--
-- HAND-AUTHORED, like 0019–0029: the drizzle snapshots stop at 0018.
--
-- Two gaps from the integrity audit, both of the same shape: an invariant that
-- lives entirely in TypeScript and therefore does not exist. `text(..., {enum})`
-- emits plain `text` — the enums are a compile-time comment on a column that
-- accepts any string at all — and the sold columns are three independent fields
-- that the application has always written together and the database has never
-- required to agree.
--
-- Both were verified against live data before being written: every existing row
-- in the development database already satisfies every constraint below (checked
-- per table, per status value, plus both directions of the sale rule), so this
-- migration adds constraints rather than repairing anything.

-- 1 · A SOLD LOT HAS A WINNER AND A PRICE; AN UNSOLD ONE HAS NEITHER.
--
--     `sold_to_paddle_id` and `sold_price` are the record of who owns whom and
--     for how much. Every money surface in the product reads them — the squad
--     board, the purse arithmetic, the settlement fold, the org's books — and
--     each reads them slightly differently: `views.ts` requires BOTH to be
--     non-null before it counts a purchase, `dashboard.ts` sums `sold_price`
--     filtered on `status = 'sold'`, `auction-overview.ts` sums `sold_price`
--     for every lot it has already decided is sold. Those three agree only
--     because the rows are consistent. Nothing made them so.
--
--     THE RULE MATCHES THE MACHINE EXACTLY, in both directions, because the
--     machine happens to be strict enough to allow it:
--
--       · `sold` is TERMINAL (packages/core/src/auction.ts, LOT_EDGES.sold is
--         empty), so no command can move a lot out of `sold` and strand a price
--         on a queued row;
--       · the ONE exit is the compensating undo — `LotReopened`, never a back
--         edge — and `undoLastAction` clears both columns in the SAME UPDATE
--         that writes `on_block`, so the row is never momentarily inconsistent;
--       · `transitionLot` writes both columns only under `sell`, in the same
--         statement as `status = 'sold'`;
--       · recovery heals `status`, `sold_price` and `sold_to_paddle_id` from
--         the replayed projection in one statement per lot, and the reducer
--         only ever sets the sale fields alongside `sold` (LotSold) or clears
--         both alongside `on_block` (LotReopened).
--
--     So there is no legitimate intermediate state to weaken the rule for, and
--     the naive form is the true form. A single caveat, recorded deliberately:
--     the reducer's `LotWithdrawn` accepts a lot in ANY status and does not
--     clear the sale fields, so a log that withdrew an already-sold lot would
--     heal into a row this constraint refuses. That log is unreachable — the
--     aggregate cannot emit `withdraw` from `sold` — and if it ever existed,
--     recovery failing loudly is the correct outcome, not a lot that is both
--     withdrawn and sold for ₹12 lakh.
ALTER TABLE "lots"
  ADD CONSTRAINT "lots_sold_state_consistent"
  CHECK (
    CASE
      WHEN "status" = 'sold'
        THEN "sold_to_paddle_id" IS NOT NULL AND "sold_price" IS NOT NULL
      ELSE "sold_to_paddle_id" IS NULL AND "sold_price" IS NULL
    END
  );--> statement-breakpoint

-- 2 · THE STATUS ENUMS, PROMOTED FROM TYPESCRIPT TO THE DATABASE.
--
--     drizzle's `text("status", { enum: [...] })` is a TYPE, not a column
--     definition: the generated DDL is `text not null`, so any string
--     whatsoever is a valid auction/lot/bid/registration status as far as
--     Postgres is concerned. A typo in a raw-SQL backfill, a script written
--     against the wrong vocabulary, or a `status` read out of untyped JSON
--     lands silently — and then every `where status = 'sold'` quietly stops
--     counting a row that every human reading it would call sold.
--
--     The value lists are copied verbatim from packages/db/src/schema.ts, which
--     in turn mirrors the frozen machines in packages/core (AUCTION_STATUSES,
--     LOT_STATUSES, BID_STATUSES, REGISTRATION_STATUSES). Adding a state to a
--     machine now means adding it here too — deliberately: a new state that
--     nobody thought about at the database is exactly the class of change these
--     constraints exist to slow down.
--
--     Scoped to the four auction-critical columns. The rest of the schema has
--     the same gap; these are the ones where a bad value costs money or a
--     player's place.
ALTER TABLE "auctions"
  ADD CONSTRAINT "auctions_status_check"
  CHECK ("status" IN ('scheduled', 'live', 'paused', 'completed', 'reconciled', 'abandoned'));--> statement-breakpoint

ALTER TABLE "lots"
  ADD CONSTRAINT "lots_status_check"
  CHECK ("status" IN (
    'prepared', 'queued', 'on_block', 'closing_soon', 'sold', 'unsold', 'frozen', 'withdrawn'
  ));--> statement-breakpoint

ALTER TABLE "bids"
  ADD CONSTRAINT "bids_status_check"
  CHECK ("status" IN ('accepted', 'outbid', 'invalidated'));--> statement-breakpoint

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_status_check"
  CHECK ("status" IN (
    'draft', 'submitted', 'approved', 'rejected', 'waitlisted', 'withdrawn'
  ));
