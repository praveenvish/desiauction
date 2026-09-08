import { oversOf } from "./overs";

import type { SideTotals, TiebreakerSpec } from "../standings";

/**
 * TIEBREAKS AND SCORE SUMMARIES, DECLARED RATHER THAN WRITTEN.
 *
 * Four packs in, every `compute` any of them needed turned out to be one of
 * four shapes — a difference, a ratio, a rate per N, or a plain total. Writing
 * them as functions meant each pack re-derived arithmetic that had already been
 * got right somewhere else, and one of those derivations is genuinely easy to
 * get wrong in a way nobody sees until a league table is wrong all season.
 *
 * So they live here, once, with the subtleties baked in. A pack now DECLARES
 * `difference("goals")` instead of writing the subtraction, which means:
 *
 *   · a pack is data — roughly forty lines of obvious values, copyable by
 *     somebody who is not a TypeScript programmer;
 *   · the arithmetic is reviewed once instead of once per sport;
 *   · the null-versus-zero and divide-by-zero rules cannot be re-litigated
 *     wrongly by the fifth pack.
 *
 * THE ESCAPE HATCH STAYS. `TiebreakerSpec` is still an interface, so a sport
 * whose ranking genuinely is not one of these four writes its own — that is
 * what an escape hatch is for, and needing one is a fact about the sport rather
 * than a failure of this file.
 */

const value = (totals: SideTotals, side: "scored" | "conceded", field: string): number =>
  totals[side][field] ?? 0;

/**
 * The optional half of every helper below.
 *
 * `key` exists because a derived name is not always the natural one: cricket's
 * rate is "net run rate" everywhere in the sport and in this codebase, not
 * "net runs rate". A pack should not have to accept a slightly wrong word to
 * use the shared arithmetic.
 */
export interface TiebreakerOptions {
  readonly key?: string;
  readonly precision?: number;
}

/**
 * Scored minus conceded. Football's goal difference, kabaddi's score difference.
 *
 * Never null: a team that has played nothing has a difference of zero, and that
 * is TRUE — they have neither outscored nor been outscored. It reads oddly
 * beside a rate, which genuinely cannot be computed without a denominator, but
 * the two are different facts and flattening them would be the error.
 */
export function difference(
  field: string,
  label: string,
  options: TiebreakerOptions = {},
): TiebreakerSpec {
  return {
    key: options.key ?? `${field}_difference`,
    label,
    precision: options.precision ?? 0,
    compute: (totals) => value(totals, "scored", field) - value(totals, "conceded", field),
  };
}

/** Plain total scored. Football's goals-for, kabaddi's points-for. */
export function total(
  field: string,
  label: string,
  options: TiebreakerOptions = {},
): TiebreakerSpec {
  return {
    key: options.key ?? `${field}_for`,
    label,
    precision: options.precision ?? 0,
    compute: (totals) => value(totals, "scored", field),
  };
}

/**
 * Scored ÷ conceded — volleyball's set and point ratios.
 *
 * THIS IS THE ONE THAT IS EASY TO GET WRONG, and the reason this library
 * exists. A team that has conceded nothing has divided by zero, and the two
 * obvious answers are both wrong in a way nobody notices until the table is:
 *
 *   · NULL sorts them BELOW everyone, because a null tiebreak sorts last by
 *     design — the league's only unbeaten team finishes bottom;
 *   · ZERO does the same thing more quietly.
 *
 * `Infinity` is the honest answer and it sorts correctly through
 * `compareStandings` with no special case: `Infinity - 5` is positive, so an
 * unbeaten team is placed above a beaten one, and two unbeaten teams are caught
 * by that function's `av === bv` check (`Infinity === Infinity`) and fall
 * through to the NEXT tiebreak. The single arrangement that would break the
 * sort — `Infinity - Infinity`, which is `NaN` — is exactly the one that
 * equality check prevents.
 *
 * Null is kept for the side that has played nothing at all: nothing scored and
 * nothing conceded is genuinely "no ratio", not an infinite one.
 */
export function ratio(
  field: string,
  label: string,
  options: TiebreakerOptions = {},
): TiebreakerSpec {
  return {
    key: options.key ?? `${field}_ratio`,
    label,
    precision: options.precision ?? 3,
    compute: (totals) => {
      const scored = value(totals, "scored", field);
      const conceded = value(totals, "conceded", field);
      if (scored === 0 && conceded === 0) {
        return null;
      }
      return conceded === 0 ? Number.POSITIVE_INFINITY : scored / conceded;
    },
  };
}

/**
 * A rate per N, taken on both sides and subtracted — cricket's net run rate.
 *
 * OVERS ARE BALLS. `4.5` overs is four overs and five balls, and a rate built
 * on that decimal is wrong by roughly eight percent per fractional over,
 * quietly, in the number that decides who qualifies. That is why `per` exists:
 * runs ÷ BALLS × 6, never runs ÷ a decimal.
 *
 * Null rather than zero when either side has no denominator — a team yet to
 * face a ball has no rate, and zero is a real rate that a team exactly level
 * has earned.
 */
export function netRate(
  numerator: string,
  denominator: string,
  per: number,
  label: string,
  options: TiebreakerOptions = {},
): TiebreakerSpec {
  const side = (totals: SideTotals, which: "scored" | "conceded"): number | null => {
    const bottom = value(totals, which, denominator);
    return bottom === 0 ? null : (value(totals, which, numerator) / bottom) * per;
  };
  return {
    key: options.key ?? `net_${numerator}_rate`,
    label,
    precision: options.precision ?? 3,
    compute: (totals) => {
      const scored = side(totals, "scored");
      const conceded = side(totals, "conceded");
      return scored === null || conceded === null ? null : scored - conceded;
    },
  };
}

/**
 * A side's totals on one line, from a template.
 *
 * `"{runs}/{balls:overs}"` renders cricket's "180/20.0"; `"{sets} ({points})"`
 * renders volleyball's "3 (98)"; `"{goals}"` renders football's "12". The
 * `:overs` suffix names a formatter, which is the one piece of sport-specific
 * presentation that is not just a number — and the only one any pack has
 * needed.
 *
 * A template rather than a function because this is what the league table
 * prints UNDER each tiebreak so a reader can check it. Making it declarative
 * keeps a pack copyable; a sport that truly needs logic here can still supply
 * its own `summariseSide`.
 */
const FORMATTERS: Record<string, (n: number) => string> = {
  overs: oversOf,
};

export function summariseFields(
  template: string,
): (totals: Readonly<Record<string, number>>) => string {
  return (totals) =>
    template.replace(/\{(\w+)(?::(\w+))?\}/g, (_whole, field: string, format?: string) => {
      const raw = totals[field] ?? 0;
      const formatter = format === undefined ? undefined : FORMATTERS[format];
      return formatter === undefined ? String(raw) : formatter(raw);
    });
}
