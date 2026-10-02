import { sendEngineCommand } from "./engine-client";

/**
 * End a practice auction through the engine, its single writer (0101). True
 * once it is over — including when it already was.
 *
 * Ending a rehearsal is not the destructive act aborting the night is, so the
 * auctioneer who opens the night may do it: the command carries `manage` for
 * that one purpose. Deliberately NOT in a "use server" module — every export
 * there is callable from a browser, and this takes the auction id on trust.
 */
export async function endPractice(practiceId: string, personId: string): Promise<boolean> {
  const ack = await sendEngineCommand({
    auctionId: practiceId,
    type: "AbortAuction",
    actor: personId,
    conduct: true,
    manage: true,
    payload: { reason: "practice ended" },
  });
  return ack.accepted || ack.reason === "illegal_transition";
}
