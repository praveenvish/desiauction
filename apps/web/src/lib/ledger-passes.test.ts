import { describe, expect, it } from "vitest";

import { ledgerOutcomes, passNote, type LedgerPassRow } from "./ledger-passes";

let seq = 0;
function row(lotNumber: string | null, result: string): LedgerPassRow {
  seq += 1;
  return { seq, lotNumber, result };
}

describe("ledger re-runs", () => {
  it("marks a requeued lot's first UNSOLD as superseded and its sale as a re-run", () => {
    const rows = [
      row("L001", "Lot on the block"),
      row("L001", "SOLD"),
      row("L003", "UNSOLD"),
      row("L003", "Lot requeued"),
      row("L009", "UNSOLD"),
      row("L009", "Lot requeued"),
      row("L003", "Lot on the block"),
      row("L003", "SOLD"),
      row("L009", "UNSOLD"),
      row(null, "Auction completed"),
    ];
    const out = ledgerOutcomes(rows);
    expect(out).toMatchObject({ lots: 3, sold: 2, unsold: 1, reRuns: 2 });
    const at = (i: number) => out.bySeq.get(rows[i]?.seq ?? -1);
    expect(at(2)).toEqual({ pass: 1, superseded: true });
    expect(at(7)).toEqual({ pass: 2, superseded: false });
    expect(passNote("UNSOLD", at(2))).toBe("Went back in");
    expect(passNote("SOLD", at(7))).toBe("Re-run · sold");
    expect(passNote("UNSOLD", at(8))).toBe("Re-run · unsold");
    // A lot sold on its first pass needs no note.
    expect(passNote("SOLD", at(1))).toBe(null);
  });

  it("does not call an undone-and-resold lot a re-run", () => {
    const rows = [
      row("L002", "SOLD"),
      row("L002", "UNDO — lot reopened (compensates #1)"),
      row("L002", "SOLD"),
    ];
    const out = ledgerOutcomes(rows);
    const at = (i: number) => out.bySeq.get(rows[i]?.seq ?? -1);
    expect(out).toMatchObject({ lots: 1, sold: 1, reRuns: 0 });
    expect(passNote("SOLD", at(0))).toBe("Not final");
    expect(passNote("SOLD", at(2))).toBe(null);
  });
});
