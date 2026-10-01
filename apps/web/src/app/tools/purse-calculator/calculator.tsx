"use client";

import {
  defaultAuctionConfigFor,
  formatAmount,
  maxAffordableBid,
  paise,
  pointsSlabs,
  validateAuctionConfig,
  type MoneyUnit,
} from "@desiauction/core";
import { Field, Select } from "@desiauction/ui";
import { useId, useState } from "react";

/**
 * THE PURSE CALCULATOR (SEO-1 Phase 4d).
 *
 * Every number comes from the functions the live auction runs: the reserve
 * rule (`maxAffordableBid`), the increment ladders (the default config, or
 * `pointsSlabs` for a points league) and the config check
 * (`validateAuctionConfig`). The page cannot promise a first bid the room would
 * refuse, because it asks the same code the room asks.
 *
 * Amounts are entered in whole rupees (or points) and carried as ×100, the
 * scale core works in for both units.
 */

interface Inputs {
  unit: MoneyUnit;
  teams: number;
  purse: number;
  squadMin: number;
  squadMax: number;
  basePrice: number;
  pool: number;
}

const START: Record<MoneyUnit, Omit<Inputs, "unit">> = {
  inr: { teams: 8, purse: 1_00_000, squadMin: 11, squadMax: 15, basePrice: 2_000, pool: 120 },
  points: { teams: 8, purse: 1_000, squadMin: 11, squadMax: 15, basePrice: 10, pool: 120 },
};

const whole = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** An average to the whole rupee or point: paise are noise when planning a purse. */
const wholeUnits = (scaled: number): number => Math.round(scaled / 100) * 100;

export function PurseCalculator() {
  const [inputs, setInputs] = useState<Inputs>({ unit: "inr", ...START.inr });
  const resultsId = useId();
  const set =
    (key: keyof Omit<Inputs, "unit">) => (event: { currentTarget: { value: string } }) => {
      const value = whole(event.currentTarget.value, 0);
      setInputs((current) => ({ ...current, [key]: value }));
    };

  const { unit, teams, squadMin, squadMax, pool } = inputs;
  const purse = paise(inputs.purse * 100);
  const base = paise(inputs.basePrice * 100);
  const money = (value: number) => formatAmount(paise(Math.round(value)), unit);

  const defaults = defaultAuctionConfigFor(unit);
  const slabs = unit === "points" ? pointsSlabs(purse) : defaults.slabs;
  const verdict = validateAuctionConfig({
    ...defaults,
    pursePerTeam: purse,
    squadMin,
    squadMax,
    slabs,
    basePriceBands: {},
    basePriceDefault: base,
  });

  const firstBid = maxAffordableBid({
    purseRemaining: purse,
    squadSize: 0,
    squadMin,
    minPossiblePrice: base,
  });
  const floorSpend = squadMin * base;
  const shortfall = floorSpend - purse;
  const needMin = teams * squadMin;
  const needMax = teams * squadMax;

  const warnings: string[] = [];
  if (!verdict.ok) {
    warnings.push(
      verdict.reason === "squad bounds"
        ? "The minimum squad must be at least 1 and no bigger than the maximum."
        : verdict.reason === "base price vs purse"
          ? "The base price must be above zero and no more than the purse."
          : "These settings would not be accepted by the auction.",
    );
  }
  if (shortfall > 0) {
    warnings.push(
      `A team cannot fill its minimum squad of ${String(squadMin)} at the base price: that costs ${money(floorSpend)}, ${money(shortfall)} more than the purse.`,
    );
  }
  if (pool > 0 && pool < needMin) {
    warnings.push(
      `${String(teams)} teams of at least ${String(squadMin)} need ${String(needMin)} players, and the pool has ${String(pool)}.`,
    );
  }

  return (
    <div className="tool-calc">
      <form
        className="tool-calc-form"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Select
          label="Auction in"
          value={unit}
          onChange={(event) => {
            const next = event.currentTarget.value === "points" ? "points" : "inr";
            setInputs({ unit: next, ...START[next] });
          }}
        >
          <option value="inr">Rupees (₹)</option>
          <option value="points">Points</option>
        </Select>
        <Field label="Teams" inputMode="numeric" value={String(teams)} onChange={set("teams")} />
        <Field
          label={unit === "inr" ? "Purse per team (₹)" : "Purse per team (points)"}
          inputMode="numeric"
          value={String(inputs.purse)}
          onChange={set("purse")}
        />
        <Field
          label="Minimum squad"
          inputMode="numeric"
          value={String(squadMin)}
          onChange={set("squadMin")}
        />
        <Field
          label="Maximum squad"
          inputMode="numeric"
          value={String(squadMax)}
          onChange={set("squadMax")}
        />
        <Field
          label={unit === "inr" ? "Lowest base price (₹)" : "Lowest base price (points)"}
          help="The cheapest any player can be bought for."
          inputMode="numeric"
          value={String(inputs.basePrice)}
          onChange={set("basePrice")}
        />
        <Field
          label="Players registered"
          help="Optional. Checks the pool is big enough."
          inputMode="numeric"
          value={String(pool)}
          onChange={set("pool")}
        />
      </form>

      <section className="tool-calc-results" aria-labelledby={resultsId} aria-live="polite">
        <h2 id={resultsId} className="tool-calc-title">
          What the auction will allow
        </h2>
        {warnings.length > 0 ? (
          <ul className="tool-calc-warnings" data-testid="calc-warnings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <dl className="tool-calc-figures">
          <div>
            <dt>Biggest first bid</dt>
            <dd data-testid="calc-first-bid">{money(firstBid)}</dd>
            <dd className="tool-calc-note">
              The reserve rule keeps enough back to buy {Math.max(0, squadMin - 1)} more players at
              the base price.
            </dd>
          </div>
          <div>
            <dt>Left after a minimum squad at base</dt>
            <dd data-testid="calc-headroom">{money(Math.max(0, purse - floorSpend))}</dd>
            <dd className="tool-calc-note">
              What a team can spend above the base price across its whole squad.
            </dd>
          </div>
          <div>
            <dt>Average per player</dt>
            <dd>
              {money(wholeUnits(purse / Math.max(1, squadMax)))} –{" "}
              {money(wholeUnits(purse / Math.max(1, squadMin)))}
            </dd>
            <dd className="tool-calc-note">
              Spread over a full squad of {squadMax}, or a minimum squad of {squadMin}.
            </dd>
          </div>
          <div>
            <dt>Players the teams will buy</dt>
            <dd data-testid="calc-players">
              {needMin === needMax ? needMin : `${String(needMin)} – ${String(needMax)}`}
            </dd>
            <dd className="tool-calc-note">
              {teams} teams, each buying {squadMin}
              {squadMin === squadMax ? "" : ` to ${String(squadMax)}`} players.
            </dd>
          </div>
        </dl>
        <h3 className="tool-calc-subtitle">Bid increments</h3>
        <ul className="tool-calc-ladder" data-testid="calc-ladder">
          {slabs.map((slab, index) => {
            const from = index === 0 ? 0 : (slabs[index - 1]?.upTo ?? 0);
            return (
              <li key={`${String(from)}-${String(slab.upTo)}`}>
                {slab.upTo === null ? `Above ${money(from)}` : `Up to ${money(slab.upTo)}`}:{" "}
                <strong>+{money(slab.step)}</strong>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
