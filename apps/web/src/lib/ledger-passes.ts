/**
 * RE-RUNS, SAID PLAINLY.
 *
 * The ledger's Results reading listed "48 results" for a 37-lot auction, and
 * three players who were bought (the hub, the rosters and the admin lots table
 * all say Sold) appeared as UNSOLD with nothing beside them — their first pass,
 * before the lot was requeued and sold on the second. The record was right;
 * the reading was ambiguous. This names each outcome's pass so the page can
 * say "Re-run · sold" and "Went back in", and gives the header lots + re-runs.
 *
 * A pass is counted by `Lot requeued` rows: a lot's first outcome is pass 1,
 * and every requeue before an outcome starts the next pass. An UNDO reopens
 * the same pass (the lot never left the block), so it is not a re-run.
 *
 * Pure over core's certified fold rows (`result` words, `lotNumber`), whole-log
 * — never a page — so a pass is the same wherever the row lands.
 */
export interface LedgerPassRow {
  readonly seq: number;
  readonly lotNumber: string | null;
  readonly result: string;
}

export interface OutcomePass {
  /** 1 on the lot's first time under the hammer; 2+ once it was requeued. */
  readonly pass: number;
  /** A later outcome for the same lot exists — this one is not the last word. */
  readonly superseded: boolean;
}

export interface LedgerOutcomes {
  /** Per outcome row (SOLD / UNSOLD / withdrawn), keyed by `seq`. */
  readonly bySeq: ReadonlyMap<number, OutcomePass>;
  /** Lots with at least one outcome. */
  readonly lots: number;
  /** Lots whose last word is SOLD / UNSOLD. */
  readonly sold: number;
  readonly unsold: number;
  /** Times a lot went back into the queue after an outcome. */
  readonly reRuns: number;
}

function isOutcome(result: string): boolean {
  return result === "SOLD" || result === "UNSOLD" || result === "Lot withdrawn";
}

export function ledgerOutcomes(rows: readonly LedgerPassRow[]): LedgerOutcomes {
  const requeues = new Map<string, number>();
  const outcomes: { seq: number; lot: string; pass: number; result: string }[] = [];
  let reRuns = 0;
  for (const row of rows) {
    if (row.lotNumber === null) {
      continue;
    }
    if (row.result === "Lot requeued") {
      requeues.set(row.lotNumber, (requeues.get(row.lotNumber) ?? 0) + 1);
      reRuns += 1;
    } else if (isOutcome(row.result)) {
      outcomes.push({
        seq: row.seq,
        lot: row.lotNumber,
        pass: (requeues.get(row.lotNumber) ?? 0) + 1,
        result: row.result,
      });
    }
  }
  const last = new Map<string, { seq: number; result: string }>();
  for (const outcome of outcomes) {
    last.set(outcome.lot, outcome);
  }
  const bySeq = new Map<number, OutcomePass>();
  for (const outcome of outcomes) {
    bySeq.set(outcome.seq, {
      pass: outcome.pass,
      superseded: last.get(outcome.lot)?.seq !== outcome.seq,
    });
  }
  const finals = [...last.values()];
  return {
    bySeq,
    lots: last.size,
    sold: finals.filter((final) => final.result === "SOLD").length,
    unsold: finals.filter((final) => final.result === "UNSOLD").length,
    reRuns,
  };
}

/** The words beside an outcome's pill; null when there is nothing to add. */
export function passNote(result: string, pass: OutcomePass | undefined): string | null {
  if (pass === undefined) {
    return null;
  }
  if (pass.superseded) {
    return result === "UNSOLD" ? "Went back in" : "Not final";
  }
  if (pass.pass > 1) {
    return `Re-run · ${result === "SOLD" ? "sold" : result === "UNSOLD" ? "unsold" : "withdrawn"}`;
  }
  return null;
}
