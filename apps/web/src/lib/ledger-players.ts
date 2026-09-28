/**
 * THE LEDGER, ONE ROW PER PLAYER (redesign 2026-09-28).
 *
 * A finished auction's ledger opened on its Results reading: 48 rows for 37
 * players, because a player sold on a second pass appears twice — UNSOLD
 * ("Went back in"), then SOLD. The record was right; the question an organizer
 * brings to a ledger after the night ("what happened to Hemant Soni?", "what
 * did Mumbai buy?") is asked per PLAYER. This folds the same rows into one
 * entry per lot: its final word, and every pass that led there.
 *
 * Pure over core's certified fold rows, whole-log — never a page — so it is
 * the same projection wherever it is read, and it invents nothing: every value
 * below is a row's own field. A pass is counted as in ledger-passes.ts: every
 * `Lot requeued` starts the next one; an UNDO reopens the SAME pass (the lot
 * never left the block), so it marks the undone sale rather than adding a pass.
 */

export interface LedgerPlayerRow {
  readonly seq: number;
  readonly atMs: number;
  readonly lotNumber: string | null;
  readonly playerName: string | null;
  readonly teamName: string | null;
  readonly paddleNumber: string | null;
  readonly amount: number | null;
  readonly result: string;
}

export interface PlayerPass {
  /** 1 on the lot's first time under the hammer; 2+ after each requeue. */
  readonly pass: number;
  readonly outcome: "sold" | "unsold" | "withdrawn";
  readonly seq: number;
  readonly atMs: number;
  readonly teamName: string | null;
  readonly amount: number | null;
  /** Bids accepted during this pass (voided ones are not subtracted: the record says both). */
  readonly bids: number;
  /** A sale later reopened by an UNDO. */
  readonly undone: boolean;
}

export interface LedgerPlayer {
  readonly lotNumber: string;
  readonly playerName: string | null;
  /** The last word on the lot; "none" when it never reached an outcome. */
  readonly outcome: "sold" | "unsold" | "withdrawn" | "none";
  readonly teamName: string | null;
  readonly paddleNumber: string | null;
  readonly amount: number | null;
  /** How many times the lot went under the hammer (1 unless requeued). */
  readonly passCount: number;
  readonly passes: readonly PlayerPass[];
}

export interface LedgerPlayers {
  readonly players: readonly LedgerPlayer[];
  readonly sold: number;
  readonly unsold: number;
  /** Sold on a second (or later) pass. */
  readonly soldOnReRun: number;
  readonly bids: number;
  /** When the room opened and closed ("Auction opened" / "Auction completed"). */
  readonly openedAtMs: number | null;
  readonly closedAtMs: number | null;
}

const OUTCOMES: Readonly<Record<string, PlayerPass["outcome"]>> = {
  SOLD: "sold",
  UNSOLD: "unsold",
  "Lot withdrawn": "withdrawn",
};

export function ledgerPlayers(rows: readonly LedgerPlayerRow[]): LedgerPlayers {
  interface Draft {
    lotNumber: string;
    playerName: string | null;
    requeues: number;
    bidsThisPass: number;
    passes: PlayerPass[];
  }
  const byLot = new Map<string, Draft>();
  let bids = 0;
  // The night, not its setup: lots are prepared and owners invited before the
  // room opens, and a range starting there reads as the auction starting early.
  let openedAtMs: number | null = null;
  let closedAtMs: number | null = null;
  for (const row of rows) {
    if (row.result === "Auction opened" && openedAtMs === null) {
      openedAtMs = row.atMs;
    }
    if (row.result === "Auction completed") {
      closedAtMs = row.atMs;
    }
    if (row.result === "Bid accepted") {
      bids += 1;
    }
    if (row.lotNumber === null) {
      continue;
    }
    let draft = byLot.get(row.lotNumber);
    if (draft === undefined) {
      draft = {
        lotNumber: row.lotNumber,
        playerName: row.playerName,
        requeues: 0,
        bidsThisPass: 0,
        passes: [],
      };
      byLot.set(row.lotNumber, draft);
    }
    if (draft.playerName === null && row.playerName !== null) {
      draft.playerName = row.playerName;
    }
    if (row.result === "Bid accepted") {
      draft.bidsThisPass += 1;
    } else if (row.result === "Lot requeued") {
      draft.requeues += 1;
      draft.bidsThisPass = 0;
    } else if (row.result.startsWith("UNDO")) {
      // The lot is back on the block in the same pass: the sale it reopens
      // stays on the record, marked undone.
      const last = draft.passes[draft.passes.length - 1];
      if (last !== undefined && last.outcome === "sold" && !last.undone) {
        draft.passes[draft.passes.length - 1] = { ...last, undone: true };
      }
    } else {
      const outcome = OUTCOMES[row.result];
      if (outcome !== undefined) {
        draft.passes.push({
          pass: draft.requeues + 1,
          outcome,
          seq: row.seq,
          atMs: row.atMs,
          teamName: outcome === "sold" ? row.teamName : null,
          amount: outcome === "sold" ? row.amount : null,
          bids: draft.bidsThisPass,
          undone: false,
        });
      }
    }
  }

  const players: LedgerPlayer[] = [...byLot.values()]
    .map((draft): LedgerPlayer => {
      const standing = draft.passes.filter((pass) => !pass.undone);
      const final = standing[standing.length - 1];
      const soldTo =
        final?.outcome === "sold" ? rows.find((row) => row.seq === final.seq) : undefined;
      return {
        lotNumber: draft.lotNumber,
        playerName: draft.playerName,
        outcome: final?.outcome ?? "none",
        teamName: final?.teamName ?? null,
        paddleNumber: soldTo?.paddleNumber ?? null,
        amount: final?.amount ?? null,
        passCount: draft.requeues + 1,
        passes: draft.passes,
      };
    })
    .sort((a, b) => a.lotNumber.localeCompare(b.lotNumber, "en", { numeric: true }));

  return {
    players,
    sold: players.filter((player) => player.outcome === "sold").length,
    unsold: players.filter((player) => player.outcome === "unsold").length,
    soldOnReRun: players.filter(
      (player) =>
        player.outcome === "sold" &&
        (player.passes.filter((pass) => !pass.undone).at(-1)?.pass ?? 1) > 1,
    ).length,
    bids,
    openedAtMs,
    closedAtMs,
  };
}
