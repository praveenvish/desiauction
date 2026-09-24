"use client";

import type { MoneyUnit } from "@desiauction/core";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { moneyFormat, type MoneyFormat } from "../lib/money";

/**
 * WHAT THIS SEASON'S AUCTION COUNTS IN (0091), for every panel under it.
 *
 * The same reasoning as `sport-terms.tsx`: the purse board, the paddle, the
 * lot hero and the ceremony all sit several levels below the page that knows
 * the season, and the unit never changes within one. The season layout mounts
 * this once; everything under it asks with `useMoney()`.
 *
 * Only the unit crosses the boundary — the formatters are functions and are
 * rebuilt on the client from it.
 *
 * THE DEFAULT IS RUPEES because that is what every season was before the unit
 * existed. A surface that lists seasons of both kinds (/home, /admin) must not
 * rely on it: it passes each row's own unit to `moneyFormat` instead.
 */
const MoneyUnitContext = createContext<MoneyUnit>("inr");

export function MoneyUnitProvider({ unit, children }: { unit: MoneyUnit; children: ReactNode }) {
  return <MoneyUnitContext.Provider value={unit}>{children}</MoneyUnitContext.Provider>;
}

/** This season's money formatters: `exact`, `compact`, `compactFloor`, `ledger`. */
export function useMoney(): MoneyFormat {
  const unit = useContext(MoneyUnitContext);
  return useMemo(() => moneyFormat(unit), [unit]);
}
