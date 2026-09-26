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
    const firstL003 = rows[2]!;
    const saleL003 = rows[7]!;
    const secondL009 = rows[8]!;
    expect(out.bySeq.get(firstL003.seq)).toEqual({ pass: 1, superseded: true });
    expect(out.bySeq.get(saleL003.seq)).toEqual({ pass: 2, superseded: false });
    expect(passNote("UNSOLD", out.bySeq.get(firstL003.seq))).toBe("Went back in");
    expect(passNote("SOLD", out.bySeq.get(saleL003.seq))).toBe("Re-run · sold");
    expect(passNote("UNSOLD", out.bySeq.get(secondL009.seq))).toBe("Re-run · unsold");
    // A lot sold on its first pass needs no note.
    expect(passNote("SOLD", out.bySeq.get(rows[1]!.seq))).toBe(null);
  });

  it("does not call an undone-and-resold lot a re-run", () => {
    const rows = [
      row("L002", "SOLD"),
      row("L002", "UNDO — lot reopened (compensates #1)"),
      row("L002", "SOLD"),
    ];
    const out = ledgerOutcomes(rows);
    expect(out).toMatchObject({ lots: 1, sold: 1, reRuns: 0 });
    expect(passNote("SOLD", out.bySeq.get(rows[0]!.seq))).toBe("Not final");
    expect(passNote("SOLD", out.bySeq.get(rows[2]!.seq))).toBe(null);
  });
});
