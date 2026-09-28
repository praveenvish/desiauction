import { describe, expect, it } from "vitest";

import { ledgerPlayers, type LedgerPlayerRow } from "./ledger-players";

let seq = 0;
function row(
  result: string,
  lotNumber: string | null = "L001",
  extra: Partial<LedgerPlayerRow> = {},
): LedgerPlayerRow {
  seq += 1;
  return {
    seq,
    atMs: 1_000 * seq,
    lotNumber,
    playerName: lotNumber === null ? null : `Player ${lotNumber}`,
    teamName: null,
    paddleNumber: null,
    amount: null,
    result,
    ...extra,
  };
}

describe("ledger, one row per player", () => {
  it("folds a lot sold on its second pass into one player with both passes", () => {
    seq = 0;
    const result = ledgerPlayers([
      row("Auction opened", null),
      row("Lot on the block", "L003"),
      row("UNSOLD", "L003"),
      row("Lot requeued", "L003"),
      row("Lot on the block", "L003"),
      row("Bid accepted", "L003", { teamName: "Thane Tuskers", amount: 500_000 }),
      row("Bid accepted", "L003", { teamName: "Thane Tuskers", amount: 550_000 }),
      row("SOLD", "L003", { teamName: "Thane Tuskers", paddleNumber: "P03", amount: 550_000 }),
    ]);
    expect(result.players).toHaveLength(1);
    const player = result.players[0];
    expect(player?.outcome).toBe("sold");
    expect(player?.teamName).toBe("Thane Tuskers");
    expect(player?.paddleNumber).toBe("P03");
    expect(player?.amount).toBe(550_000);
    expect(player?.passCount).toBe(2);
    expect(player?.passes.map((pass) => [pass.pass, pass.outcome, pass.bids])).toEqual([
      [1, "unsold", 0],
      [2, "sold", 2],
    ]);
    expect(result.soldOnReRun).toBe(1);
    expect(result.bids).toBe(2);
    // The night runs from "Auction opened", not from the setup before it.
    expect(result.openedAtMs).toBe(1_000);
    expect(result.closedAtMs).toBeNull();
  });

  it("an undone sale stays on the record but is not the last word", () => {
    seq = 0;
    const result = ledgerPlayers([
      row("SOLD", "L001", { teamName: "Arrows", amount: 1_000_000 }),
      row("UNDO — lot reopened (compensates #1)", "L001"),
      row("SOLD", "L001", { teamName: "Blasters", amount: 1_500_000 }),
    ]);
    const player = result.players[0];
    expect(player?.teamName).toBe("Blasters");
    expect(player?.passCount).toBe(1);
    expect(player?.passes.map((pass) => [pass.teamName, pass.undone])).toEqual([
      ["Arrows", true],
      ["Blasters", false],
    ]);
    // Undo reopens the same pass: this is not a re-run sale.
    expect(result.soldOnReRun).toBe(0);
  });

  it("counts sold and unsold by the last word, lists lots in number order", () => {
    seq = 0;
    const result = ledgerPlayers([
      row("UNSOLD", "L010"),
      row("SOLD", "L002", { teamName: "A", amount: 1 }),
      row("Lot queued", "L001"),
      row("UNSOLD", "L002"),
    ]);
    expect(result.players.map((player) => [player.lotNumber, player.outcome])).toEqual([
      ["L001", "none"],
      ["L002", "unsold"],
      ["L010", "unsold"],
    ]);
    expect(result.sold).toBe(0);
    expect(result.unsold).toBe(2);
  });
});
