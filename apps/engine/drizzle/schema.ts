import { bigint, char, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Throwaway table for the IP-0 tracer bullet (IP-0_DESIGN §32). Lives outside
 * src/ because only drizzle-kit and the spike touch it; a follow-up migration
 * drops it at IP-0 exit (§36). The unique(auction_id, seq) constraint is the
 * database-level guarantee the single-writer discipline is measured against.
 */
export const spikeLedger = pgTable(
  "spike_ledger",
  {
    id: char("id", { length: 26 }).primaryKey(),
    auctionId: text("auction_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("spike_ledger_auction_seq").on(table.auctionId, table.seq)],
);
