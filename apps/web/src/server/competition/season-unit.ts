import type { MoneyUnit } from "@desiauction/core";
import { competitions } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { cache } from "react";

import { systemDb } from "../db";

/**
 * WHAT A SEASON'S AUCTION COUNTS IN, BY SLUG (0091) — for the season layout
 * and the server components under it that print amounts.
 *
 * On the system pool and ungated on purpose: the answer is a formatting word
 * ("₹" or "pts"), not season data, and the season tree holds public children
 * (/spectate, /overlay, /board, /register) that no membership gate can sit
 * above. Every page still runs its own gate; an unknown or foreign slug gets
 * rupees here and a 404 from its page, exactly as before.
 *
 * Memoised per render (React `cache`): the layout and a page that both ask
 * cost one read.
 */
export const seasonUnit = cache(async (slug: string): Promise<MoneyUnit> => {
  const [row] = await systemDb
    .select({ unit: competitions.auctionUnit })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  return row?.unit ?? "inr";
});
