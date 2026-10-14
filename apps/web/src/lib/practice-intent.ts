import { isTransportCommandId } from "@desiauction/core";

/** Creation/composition receipts are not engine command acknowledgements. */
export type PracticeIntentResult = {
  intentId: string;
  kind: "accepted" | "refused" | "unknown";
  stage: "before-write" | "end" | "create" | "complete";
  message: string;
  ended: boolean;
  practiceId?: string;
};

export function practiceIntentOutcome(value: unknown, intentId: string): PracticeIntentResult {
  if (value && typeof value === "object") {
    const result = value as Partial<PracticeIntentResult>;
    if (
      result.intentId === intentId &&
      ["accepted", "refused", "unknown"].includes(result.kind ?? "") &&
      ["before-write", "end", "create", "complete"].includes(result.stage ?? "") &&
      typeof result.message === "string" &&
      typeof result.ended === "boolean" &&
      (result.practiceId === undefined ||
        (typeof result.practiceId === "string" && isTransportCommandId(result.practiceId))) &&
      (result.kind !== "accepted" ||
        (result.stage === "complete" && (result.ended || !!result.practiceId))) &&
      (result.stage !== "before-write" || !result.ended)
    )
      return result as PracticeIntentResult;
  }
  return {
    intentId,
    kind: "unknown",
    stage: "complete",
    ended: false,
    message:
      "The practice action has not been confirmed. Review the current practice before continuing.",
  };
}
