"use client";

import {
  formatPaiseINR,
  paise,
  parseRupeesToPaise,
  whatIf,
  type PlanInput,
} from "@desiauction/core";
import { Card, Field, Select } from "@desiauction/ui";
import { useMemo, useState } from "react";

import type { PlanLotRow } from "../../../../../server/auction/owner-plan";

/**
 * WHAT IF (Phase 1.5). "What if I win this player for X?" — the same arithmetic
 * as the line under the raise button, for any player still to come and any
 * amount, answered on the client from the fold the page already holds. No
 * server call, no state saved: a scratchpad, not a plan.
 */

function money(value: number): string {
  return formatPaiseINR(paise(value));
}

export function PlanWhatIf({ input, lots }: { input: PlanInput; lots: readonly PlanLotRow[] }) {
  const candidates = useMemo(
    () => lots.filter((lot) => lot.status !== "sold" && lot.status !== "withdrawn"),
    [lots],
  );
  const [registrationId, setRegistrationId] = useState<string>(candidates[0]?.registrationId ?? "");
  const [rupees, setRupees] = useState("");
  const chosen = candidates.find((lot) => lot.registrationId === registrationId) ?? candidates[0];
  const parsed = rupees.trim() === "" ? null : parseRupeesToPaise(rupees.trim());
  const amount = parsed !== null && parsed.ok ? parsed.value : null;
  const result =
    chosen === undefined || amount === null ? null : whatIf(input, chosen.registrationId, amount);
  const openTargets = input.targets.length;

  if (candidates.length === 0) {
    return null;
  }
  return (
    <Card data-testid="plan-what-if">
      <h2>What if?</h2>
      <div className="plan-what-if-form">
        <Select
          label="If I win"
          value={chosen?.registrationId ?? ""}
          onChange={(event) => {
            setRegistrationId(event.target.value);
          }}
          data-testid="plan-what-if-player"
        >
          {candidates.map((lot) => (
            <option key={lot.registrationId} value={lot.registrationId}>
              {lot.playerName ?? lot.lotNumber} · {lot.number}
            </option>
          ))}
        </Select>
        <Field
          label="for (₹)"
          inputMode="numeric"
          autoComplete="off"
          placeholder={chosen === undefined ? "" : String(chosen.basePrice / 100)}
          value={rupees}
          onChange={(event) => {
            setRupees(event.target.value);
          }}
          {...(parsed !== null && !parsed.ok ? { error: "Enter a whole rupee amount." } : {})}
          data-testid="plan-what-if-amount"
        />
      </div>
      {result !== null && chosen !== undefined ? (
        <p className="plan-note" data-testid="plan-what-if-result">
          <span className="plan-line-money">{money(result.purseAfter)}</span> left ·{" "}
          <span className="plan-line-money">{money(result.plannedExposureAfter)}</span> still
          planned
          {input.targets.some((t) => t.registrationId === chosen.registrationId)
            ? ` for ${String(Math.max(0, openTargets - 1))} other ${openTargets - 1 === 1 ? "target" : "targets"}`
            : ` for ${String(openTargets)} ${openTargets === 1 ? "target" : "targets"}`}
          {result.fitAfter === "fits"
            ? " · plan still fits"
            : result.fitAfter === "at_risk"
              ? " · plan would leave too little for the squad"
              : " · plan would no longer fit"}
        </p>
      ) : (
        <p className="plan-hint">Type an amount to see what would be left.</p>
      )}
    </Card>
  );
}
