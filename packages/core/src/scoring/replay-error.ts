import type { RejectReason } from "./types";

export class ReplayError extends Error {
  constructor(
    readonly seq: number,
    readonly reason: RejectReason,
  ) {
    super(`Scoring event ${String(seq)} refused: ${reason}`);
    this.name = "ReplayError";
  }
}
