-- WHAT THE FORM ALREADY COLLECTS AND THE PLATFORM COULD NOT HOLD.
--
-- HAND-AUTHORED, like 0022–0033.
--
-- A club's registration form asks for the entry fee and whether it was paid,
-- and it leaves a box for the organizer's own remarks. Neither had a column.
-- Organizers were tracking both in the spreadsheet they were importing FROM,
-- which is the whole problem this import exists to end: the sheet stayed the
-- real record and the platform held a thinner copy.
--
-- MONEY HERE IS NOT SETTLEMENT MONEY, AND THAT BOUNDARY IS THE POINT.
--
-- `fee_amount_paise` is registration-desk bookkeeping: what the player handed
-- over to enter, recorded so the desk can see who has paid. It does NOT post to
-- the finops ledger, it is NOT part of any journal, and it must never be summed
-- into a settlement figure. The certified money machine (IP-5/IP-6) owns team
-- obligations arising from the AUCTION and is frozen; an entry fee is a
-- different fact with a different owner, and wiring the two together later
-- would put uncertified writes inside a certified boundary.
--
-- If entry fees ever need to be real money — receipts, refunds, reconciliation
-- — that is a finops feature with a finops case, not four columns on this
-- table. Whoever proposes it should read this comment first.
--
-- PAISE, AS EVERYWHERE ELSE (C-7): an integer count of the smallest unit, never
-- a float. `bigint` matches `lots.sold_price` and the rest of the money columns.

ALTER TABLE "registrations"
  ADD COLUMN "fee_status" text NOT NULL DEFAULT 'pending';--> statement-breakpoint

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_fee_status_check"
  CHECK ("fee_status" IN ('pending', 'paid', 'waived', 'refunded'));--> statement-breakpoint

-- NULL means "no amount recorded", which is NOT the same as zero: a waived fee
-- and a fee of nothing are different facts and a reader must be able to tell.
ALTER TABLE "registrations"
  ADD COLUMN "fee_amount_paise" bigint;--> statement-breakpoint

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_fee_amount_check"
  CHECK ("fee_amount_paise" IS NULL OR "fee_amount_paise" >= 0);--> statement-breakpoint

-- The UTR / transaction reference a player quotes when they say they paid. Free
-- text on purpose: it comes from whatever rail they used, and validating a
-- format we do not control would refuse the truth.
ALTER TABLE "registrations"
  ADD COLUMN "fee_reference" text;--> statement-breakpoint

-- The organizer's own remark about this registration. DISTINCT from
-- `rejection_note`, which is a triage decision's reason and belongs to the
-- lifecycle; this one is a desk note that survives every status change.
ALTER TABLE "registrations"
  ADD COLUMN "note" text;--> statement-breakpoint

-- Bounded so a pasted essay cannot bloat a row every dashboard query reads.
ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_note_length_check"
  CHECK ("note" IS NULL OR length("note") <= 2000);--> statement-breakpoint

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_fee_reference_length_check"
  CHECK ("fee_reference" IS NULL OR length("fee_reference") <= 200);--> statement-breakpoint

-- Who has not paid yet, per competition — the desk's one real question. Partial,
-- because 'paid' is the steady state and indexing it would index the whole table.
CREATE INDEX "registrations_fee_pending_idx"
  ON "registrations" ("competition_id")
  WHERE "fee_status" <> 'paid';--> statement-breakpoint

-- ADDITIVE AND BACKWARDS COMPATIBLE. Every column is nullable or defaulted, no
-- existing row is rewritten, and nothing above changes a lifecycle rule — so a
-- rollback to the previous build leaves these columns unread rather than broken.
-- No new GRANT: `registrations` already carries them (ops/db/create-app-role.sql),
-- and adding a column does not change a table-level privilege.
COMMENT ON COLUMN "registrations"."fee_amount_paise" IS
  'Registration-desk bookkeeping in paise. NOT settlement money; never posts to the finops ledger.';
