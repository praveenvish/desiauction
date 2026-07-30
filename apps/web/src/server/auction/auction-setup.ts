import { DEFAULT_AUCTION_CONFIG, paise, type AuctionConfig } from "@desiauction/core";

/**
 * THE SETUP CONTRACT: the numbers a league negotiates, parsed once and refused
 * loudly.
 *
 * Two defects lived here. The form sent numbers, so anything that was not a
 * number was dropped on the floor before the server ever saw it: `"abc"` for a
 * purse silently became ₹2 Cr, `"-5"` for a band silently deleted the band, a
 * zero timer silently became 30s. The config is then declared permanent —
 * "these lock when the auction is created" — so a silent substitution is a
 * permanent one. Every field now arrives as the RAW STRING the organizer typed
 * and is either accepted or refused by name; nothing is coerced.
 *
 * Pure on purpose: the client shows the same message the server would, and the
 * server never trusts the client for it.
 */

export interface AuctionSetupInput {
  pursePerTeam?: string;
  squadMin?: string;
  squadMax?: string;
  timerSeconds?: string;
  extensionSeconds?: string;
  basePriceDefault?: string;
  /** Band label → base price in RUPEES, as typed. Blank drops the band. */
  bands?: Record<string, string>;
  /** The organizer has read the shortfall arithmetic and accepts it. */
  acceptShortSquads?: boolean;
}

/** Field name (matching the input's `name`) → the message shown under it. */
export type AuctionSetupFieldErrors = Record<string, string>;

export type AuctionSetupResult =
  { ok: true; config: AuctionConfig } | { ok: false; fieldErrors: AuctionSetupFieldErrors };

const WHOLE_NUMBER = /^\d+$/;

/** Rupee limits are generous but finite: nothing here should accept 99999. */
const LIMITS = {
  pursePerTeam: { min: 1_000, max: 1_000_000_000, unit: "₹" },
  basePriceDefault: { min: 100, max: 1_000_000_000, unit: "₹" },
  band: { min: 100, max: 1_000_000_000, unit: "₹" },
  squadMin: { min: 1, max: 30, unit: "" },
  squadMax: { min: 1, max: 30, unit: "" },
  timerSeconds: { min: 5, max: 600, unit: "" },
  extensionSeconds: { min: 1, max: 300, unit: "" },
} as const;

function amount(unit: string, value: number): string {
  return unit === "₹" ? `₹${value.toLocaleString("en-IN")}` : String(value);
}

type Bound = { min: number; max: number; unit: string };

function parseWhole(
  raw: string | undefined,
  label: string,
  bound: Bound,
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return { ok: false, error: `${label} is required.` };
  }
  if (!WHOLE_NUMBER.test(trimmed)) {
    return {
      ok: false,
      error: `${label} must be a whole number — digits only, no letters, decimals or minus signs.`,
    };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: `${label} is too large.` };
  }
  if (value < bound.min) {
    return { ok: false, error: `${label} must be at least ${amount(bound.unit, bound.min)}.` };
  }
  if (value > bound.max) {
    return { ok: false, error: `${label} can't be more than ${amount(bound.unit, bound.max)}.` };
  }
  return { ok: true, value };
}

/**
 * Parse the whole form. Every failure is reported against the field that owns
 * it, and a single bad field never silently changes another.
 */
export function parseAuctionSetup(input: AuctionSetupInput): AuctionSetupResult {
  const fieldErrors: AuctionSetupFieldErrors = {};
  const take = (
    key: keyof typeof LIMITS,
    name: string,
    label: string,
    raw: string | undefined,
  ): number | null => {
    const parsed = parseWhole(raw, label, LIMITS[key]);
    if (!parsed.ok) {
      fieldErrors[name] = parsed.error;
      return null;
    }
    return parsed.value;
  };

  const purse = take("pursePerTeam", "pursePerTeam", "Purse per team", input.pursePerTeam);
  const squadMin = take("squadMin", "squadMin", "Squad minimum", input.squadMin);
  const squadMax = take("squadMax", "squadMax", "Squad maximum", input.squadMax);
  const timerSeconds = take("timerSeconds", "timerSeconds", "Lot timer", input.timerSeconds);
  const extensionSeconds = take(
    "extensionSeconds",
    "extensionSeconds",
    "Anti-snipe extension",
    input.extensionSeconds,
  );
  const basePriceDefault = take(
    "basePriceDefault",
    "basePriceDefault",
    "Default base price",
    input.basePriceDefault,
  );

  if (squadMin !== null && squadMax !== null && squadMax < squadMin) {
    fieldErrors["squadMax"] = `Squad maximum must be at least the squad minimum (${String(
      squadMin,
    )}).`;
  }
  if (purse !== null && basePriceDefault !== null && basePriceDefault > purse) {
    fieldErrors["basePriceDefault"] = "The default base price can't be more than the purse.";
  }

  // A band is dropped only when the organizer clears the field. A band with
  // nonsense in it is refused — it used to vanish from the locked config.
  const bands: Record<string, number> = {};
  for (const [rawLabel, rawValue] of Object.entries(input.bands ?? {})) {
    const label = rawLabel.trim().toUpperCase();
    const name = `band${rawLabel.trim().toUpperCase()}`;
    if (rawValue.trim() === "") {
      continue;
    }
    const parsed = parseWhole(rawValue, `Band ${label} base price`, LIMITS.band);
    if (!parsed.ok) {
      fieldErrors[name] = parsed.error;
      continue;
    }
    if (purse !== null && parsed.value > purse) {
      fieldErrors[name] = `Band ${label} base price can't be more than the purse.`;
      continue;
    }
    bands[label] = parsed.value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  // Every value is proven above; the assertions are the parse's own postcondition.
  return {
    ok: true,
    config: {
      ...DEFAULT_AUCTION_CONFIG,
      pursePerTeam: paise((purse ?? 0) * 100),
      squadMin: squadMin ?? DEFAULT_AUCTION_CONFIG.squadMin,
      squadMax: squadMax ?? DEFAULT_AUCTION_CONFIG.squadMax,
      timer: {
        initialSeconds: timerSeconds ?? DEFAULT_AUCTION_CONFIG.timer.initialSeconds,
        extensionSeconds: extensionSeconds ?? DEFAULT_AUCTION_CONFIG.timer.extensionSeconds,
      },
      basePriceBands:
        Object.keys(bands).length === 0
          ? {}
          : Object.fromEntries(
              Object.entries(bands).map(([label, rupees]) => [label, paise(rupees * 100)]),
            ),
      basePriceDefault: paise((basePriceDefault ?? 0) * 100),
    },
  };
}

/**
 * CAN THIS ROOM WORK? — the arithmetic nobody was doing.
 *
 * Reproduced end to end: 14 lots, 3 teams, `squadMin` 8. Every readiness gate
 * passed, the auction opened, and then it could not be closed — "Some teams are
 * still below the minimum squad size" — because 3 × 8 = 24 players were needed
 * and 14 existed. The organizer met that arithmetic at closing time, in a hall,
 * with the override on another screen.
 *
 * `needed` is per-team and counts seats already filled (icons, retained players
 * and anyone already sold), which is exactly what the engine's own
 * below-minimum count measures — so this says the same thing the close guard
 * will say, only hours earlier.
 */
export interface SquadFeasibility {
  ok: boolean;
  poolSize: number;
  teamCount: number;
  squadMin: number;
  squadMax: number;
  /** Seats that must still be filled from the pool for every squad to be legal. */
  needed: number;
  /** How many players short the pool is (0 when it is not short). */
  shortfall: number;
  /** Seats that exist at all, at squadMax. */
  capacity: number;
  /** Players the squads cannot hold even if every seat fills (0 when none). */
  overflow: number;
  /** The arithmetic, in one plain sentence. */
  headline: string;
  /** The over-capacity sentence, when there is one. */
  note: string | null;
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

export function squadFeasibility(input: {
  /** Approved, non-icon players not yet on a squad — who is left to be sold. */
  poolSize: number;
  /** Players already on each team's sheet, one entry per team. */
  squadSizes: readonly number[];
  squadMin: number;
  squadMax: number;
}): SquadFeasibility {
  const { poolSize, squadSizes, squadMin, squadMax } = input;
  const teamCount = squadSizes.length;
  const needed = squadSizes.reduce((sum, size) => sum + Math.max(0, squadMin - size), 0);
  const capacity = squadSizes.reduce((sum, size) => sum + Math.max(0, squadMax - size), 0);
  const shortfall = Math.max(0, needed - poolSize);
  const overflow = Math.max(0, poolSize - capacity);
  const ok = shortfall === 0;
  const headline = ok
    ? `${plural(poolSize, "player", "players")} for ${plural(
        teamCount,
        "squad",
        "squads",
      )} of at least ${String(squadMin)} (${String(needed)} needed) — ${String(
        poolSize - needed,
      )} to spare.`
    : `${plural(poolSize, "player", "players")} cannot fill ${plural(
        teamCount,
        "squad",
        "squads",
      )} of at least ${String(squadMin)} (${String(needed)} needed).`;
  const note =
    overflow > 0
      ? `${plural(poolSize, "player", "players")} for ${String(
          capacity,
        )} squad places at ${String(squadMax)} per team — ${String(
          overflow,
        )} will go unsold however the bidding goes.`
      : null;
  return {
    ok,
    poolSize,
    teamCount,
    squadMin,
    squadMax,
    needed,
    shortfall,
    capacity,
    overflow,
    headline,
    note,
  };
}

/** Where the exit is, named at the point of refusal rather than discovered. */
export const SHORT_SQUAD_OVERRIDE_HINT =
  "Closing an auction with short squads needs the conductor's override on the cockpit (Close auction → “Close short — on the record”).";
