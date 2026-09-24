"use client";

import { Button, Field, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useMoney } from "../../../../../components/money-unit";
import type { MoneyFormat } from "../../../../../lib/money";
import { createAuctionAction, type AuctionDashboard } from "../../../../../server/auction/actions";
import {
  squadFeasibility,
  type AuctionSetupFieldErrors,
} from "../../../../../server/auction/auction-setup";

/**
 * The figure a money field holds, read back in its season's unit ("₹2,00,00,000
 * · ₹2 Cr", or "1,000 pts"). A purse typed as 20000000 is one missing zero from
 * a tenth of the league it meant; the read-back is how an organizer sees that
 * before it locks. Nothing for a value the server would refuse anyway.
 */
function amountReadBack(
  value: string,
  money: MoneyFormat,
): { help: string } | Record<string, never> {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return {};
  const stored = Number(trimmed) * 100;
  if (!Number.isSafeInteger(stored)) return {};
  const exact = money.exact(stored);
  const compact = money.compact(stored);
  return { help: compact !== exact ? `${exact} · ${compact}` : exact };
}

/**
 * The numbers the form starts from, in the season's unit (0091). A points
 * league starts at 1,000 a team with bands of 50 / 20 / 10 — the rupee
 * defaults read as points would be twenty million.
 */
const STARTING = {
  inr: { purse: "20000000", base: "10000", bands: { A: "50000", B: "25000", C: "10000" } },
  points: { purse: "1000", base: "10", bands: { A: "50", B: "20", C: "10" } },
} as const;

/**
 * RULES OF THE NIGHT (DA-05). These are the numbers a league negotiates; they
 * lock when the auction is created. Pre-filled with the defaults every auction
 * used to get, so an organizer who does not care still clicks one button — and
 * a value that is not a whole number is refused, never replaced.
 */
export function RulesStep({ slug, dashboard }: { slug: string; dashboard: AuctionDashboard }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const money = useMoney();
  const starting = STARTING[money.unit];
  const [purse, setPurse] = useState<string>(starting.purse);
  const [squadMin, setSquadMin] = useState("8");
  const [squadMax, setSquadMax] = useState("15");
  const [timer, setTimer] = useState("30");
  const [extension, setExtension] = useState("15");
  const [baseDefault, setBaseDefault] = useState<string>(starting.base);
  const [bands, setBands] = useState<Record<string, string>>({ ...starting.bands });
  const [fieldErrors, setFieldErrors] = useState<AuctionSetupFieldErrors>({});
  const [acceptShortSquads, setAcceptShortSquads] = useState(false);

  const { ready } = dashboard;
  // The same sum the server will do, run against whatever is typed right now.
  const unplacedPool = ready.pool.filter((entry) => entry.teamId === null).length;
  const typed = squadFeasibility({
    poolSize: unplacedPool,
    squadSizes: ready.squadSizes,
    squadMin: /^\d+$/.test(squadMin.trim()) ? Number(squadMin) : dashboard.feasibility.squadMin,
    squadMax: /^\d+$/.test(squadMax.trim()) ? Number(squadMax) : dashboard.feasibility.squadMax,
  });

  const create = async () => {
    setBusy(true);
    const result = await createAuctionAction(slug, {
      pursePerTeam: purse,
      squadMin,
      squadMax,
      timerSeconds: timer,
      extensionSeconds: extension,
      basePriceDefault: baseDefault,
      bands,
      acceptShortSquads,
    });
    setBusy(false);
    setFieldErrors(result.fieldErrors ?? {});
    if (result.ok) {
      toast({ title: "Auction created — now bring in the team owners.", tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error ?? "Refused.", tone: "danger" });
    }
  };

  return (
    <div className="auction-setup as-rules" data-testid="auction-setup">
      <div className="as-rules-grid">
        <Field
          label={`Purse per team (${money.label})`}
          name="pursePerTeam"
          inputMode="numeric"
          value={purse}
          {...amountReadBack(purse, money)}
          error={fieldErrors["pursePerTeam"]}
          onChange={(event) => {
            setPurse(event.target.value);
          }}
        />
        <Field
          label="Squad minimum"
          name="squadMin"
          inputMode="numeric"
          value={squadMin}
          error={fieldErrors["squadMin"]}
          onChange={(event) => {
            setSquadMin(event.target.value);
          }}
        />
        <Field
          label="Squad maximum"
          name="squadMax"
          inputMode="numeric"
          value={squadMax}
          error={fieldErrors["squadMax"]}
          onChange={(event) => {
            setSquadMax(event.target.value);
          }}
        />
        <Field
          label="Lot timer (seconds)"
          name="timerSeconds"
          inputMode="numeric"
          value={timer}
          error={fieldErrors["timerSeconds"]}
          onChange={(event) => {
            setTimer(event.target.value);
          }}
        />
        <Field
          label="Anti-snipe extension (seconds)"
          name="extensionSeconds"
          inputMode="numeric"
          value={extension}
          error={fieldErrors["extensionSeconds"]}
          onChange={(event) => {
            setExtension(event.target.value);
          }}
        />
        <Field
          label={`Default base price (${money.label})`}
          name="basePriceDefault"
          inputMode="numeric"
          value={baseDefault}
          {...amountReadBack(baseDefault, money)}
          error={fieldErrors["basePriceDefault"]}
          onChange={(event) => {
            setBaseDefault(event.target.value);
          }}
        />
        {(["A", "B", "C"] as const).map((label) => (
          <Field
            key={label}
            label={`Band ${label} base price (${money.label})`}
            name={`band${label}`}
            inputMode="numeric"
            value={bands[label]}
            error={fieldErrors[`band${label}`]}
            help="Clear the field to drop this band."
            onChange={(event) => {
              setBands({ ...bands, [label]: event.target.value });
            }}
          />
        ))}
      </div>
      {/* The arithmetic, before the room exists. */}
      <p
        className={typed.ok ? "as-hint" : "auction-feasibility is-short"}
        data-testid="feasibility-preview"
      >
        {typed.headline}
        {typed.note !== null ? ` ${typed.note}` : ""}
      </p>
      {!typed.ok ? (
        <label className="auction-ack">
          <input
            type="checkbox"
            checked={acceptShortSquads}
            data-testid="accept-short-squads"
            onChange={(event) => {
              setAcceptShortSquads(event.target.checked);
            }}
          />
          <span>
            Create anyway — I accept that {typed.shortfall} squad place
            {typed.shortfall === 1 ? "" : "s"} cannot be filled, and that closing short needs the
            conductor&apos;s override on the cockpit.
          </span>
        </label>
      ) : null}
      <div className="as-actions">
        <Button
          size="touch"
          onClick={() => void create()}
          loading={busy}
          disabled={!ready.ok}
          data-testid="create-auction"
        >
          Create auction
        </Button>
        <span className="as-hint">These lock once the auction is created.</span>
      </div>
    </div>
  );
}
