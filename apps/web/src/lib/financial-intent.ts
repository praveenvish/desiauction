/** Durable presentation boundary; canonical authority and money rules stay on the server. */
export interface FinancialIntent {
  readonly key: string;
  readonly actorId: string;
  readonly orgId: string;
  readonly caseId: string;
  readonly targetId: string;
  readonly kind: "payment" | "refund" | "waiver";
  readonly amount: string;
  readonly method: string;
  readonly reason: string;
}
export type FinancialOutcome = "not-started" | "unknown" | "accepted" | "refused";
export interface FinancialRecord {
  readonly intent: FinancialIntent;
  readonly outcome: FinancialOutcome;
  readonly message: string;
  /** Explicitly closed before dispatch; still distinct from a server refusal. */
  readonly retired?: true;
}
export interface FinancialIntentStorage {
  read: () => Promise<unknown>;
  update: (change: (stored: unknown) => readonly FinancialRecord[]) => Promise<void>;
}
export type FinancialAnswer = { ok: true } | { ok: false; error: string };

/** Fail closed on corruption, including another authenticated actor or scope. */
export function readFinancialRecords(
  value: unknown,
  scope: Pick<FinancialIntent, "actorId" | "orgId" | "caseId">,
): readonly FinancialRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Saved financial work cannot be read safely.");
  const keys = new Set<string>();
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid saved financial work.");
    const record = raw as Record<string, unknown>;
    const input = record["intent"];
    if (!input || typeof input !== "object") throw new Error("Invalid saved financial intent.");
    const intent = input as Record<string, unknown>;
    for (const field of [
      "key",
      "actorId",
      "orgId",
      "caseId",
      "targetId",
      "kind",
      "amount",
      "method",
      "reason",
    ]) {
      if (typeof intent[field] !== "string") throw new Error("Invalid saved financial intent.");
    }
    const key = intent["key"] as string;
    if (
      !/^[A-Za-z0-9_.:-]{1,64}$/.test(key) ||
      keys.has(key) ||
      intent["actorId"] !== scope.actorId ||
      intent["orgId"] !== scope.orgId ||
      intent["caseId"] !== scope.caseId ||
      !intent["targetId"] ||
      !intent["amount"] ||
      !["payment", "refund", "waiver"].includes(intent["kind"] as string) ||
      !["not-started", "unknown", "accepted", "refused"].includes(record["outcome"] as string) ||
      typeof record["message"] !== "string" ||
      (record["retired"] !== undefined &&
        (record["retired"] !== true || record["outcome"] !== "not-started"))
    )
      throw new Error("Saved financial work does not match this account and case.");
    keys.add(key);
    return Object.freeze({
      intent: Object.freeze({ ...intent }) as unknown as FinancialIntent,
      outcome: record["outcome"] as FinancialOutcome,
      message: record["message"],
      ...(record["retired"] === true ? { retired: true as const } : {}),
    });
  });
}

/** Restoration never dispatches; the adapter serializes updates and enforces the account epoch. */
export function createFinancialIntentBoundary(
  storage: FinancialIntentStorage,
  scope: Pick<FinancialIntent, "actorId" | "orgId" | "caseId">,
  assertCurrent: () => void,
) {
  let busy = false;
  const read = async () => {
    assertCurrent();
    const records = readFinancialRecords(await storage.read(), scope);
    assertCurrent();
    return records;
  };
  const update = async (
    change: (records: readonly FinancialRecord[]) => readonly FinancialRecord[],
  ) => {
    assertCurrent();
    await storage.update((stored) => {
      assertCurrent();
      return change(readFinancialRecords(stored, scope));
    });
    assertCurrent();
  };
  return {
    read,
    async closeUnsent(key: string): Promise<void> {
      if (busy) throw new Error("A financial action is already being prepared or reviewed.");
      busy = true;
      try {
        await update((history) => {
          const original = history.find((record) => record.intent.key === key);
          if (!original || original.outcome !== "not-started")
            throw new Error(
              "Only an unsent draft can be closed. Unknown outcomes must stay saved.",
            );
          return history.map((record) =>
            record.intent.key === key ? { ...record, retired: true as const } : record,
          );
        });
      } finally {
        busy = false;
      }
    },
    async review(
      key: string,
      inspect: (
        intent: FinancialIntent,
      ) => Promise<{ outcome: "accepted" | "unknown" | "unavailable" }>,
    ): Promise<FinancialRecord> {
      if (busy) throw new Error("A financial action is already being prepared or reviewed.");
      busy = true;
      try {
        const original = (await read()).find((entry) => entry.intent.key === key);
        if (!original) throw new Error("The original financial intent is unavailable.");
        if (original.outcome !== "unknown") return original;
        const answer = await inspect(original.intent);
        assertCurrent();
        if (answer.outcome !== "accepted") return original;
        const accepted: FinancialRecord = {
          ...original,
          outcome: "accepted",
          message: "Original action found in the canonical record.",
        };
        await update((history) =>
          history.map((entry) => (entry.intent.key === key ? accepted : entry)),
        );
        return accepted;
      } finally {
        busy = false;
      }
    },
    async dispatch(
      original: FinancialIntent,
      send: (intent: FinancialIntent) => Promise<FinancialAnswer>,
      reviewedUncertainty = false,
    ): Promise<FinancialRecord> {
      if (busy) throw new Error("A financial action is already being prepared or reviewed.");
      busy = true;
      try {
        const intent = Object.freeze({ ...original });
        const initial: FinancialRecord = { intent, outcome: "not-started", message: "" };
        readFinancialRecords([initial], scope);
        await update((history) => {
          if (history.some((entry) => entry.intent.key === intent.key))
            throw new Error(
              "This intent already exists. Review its original outcome before continuing.",
            );
          if (
            history.some((entry) => entry.outcome === "not-started" && !entry.retired) ||
            (!reviewedUncertainty && history.some((entry) => entry.outcome === "unknown"))
          )
            throw new Error("Review the unresolved financial action before starting new work.");
          return [...history, initial];
        });
        const replace = (record: FinancialRecord) =>
          update((history) => {
            const existing = history.find((entry) => entry.intent.key === intent.key);
            if (
              !existing ||
              existing.retired ||
              JSON.stringify(existing.intent) !== JSON.stringify(intent)
            )
              throw new Error("The original financial intent changed. Reload before continuing.");
            return history.map((entry) => (entry.intent.key === intent.key ? record : entry));
          });
        // Persist uncertainty BEFORE the network boundary. A crash here remains conservative.
        const pending: FinancialRecord = {
          intent,
          outcome: "unknown",
          message: "Outcome unconfirmed. Review this exact action.",
        };
        await replace(pending);
        assertCurrent();
        let answer: FinancialAnswer;
        try {
          answer = await send(intent);
        } catch {
          assertCurrent();
          return pending;
        }
        assertCurrent();
        const finished: FinancialRecord = {
          intent,
          outcome: answer.ok ? "accepted" : "refused",
          message: answer.ok ? "Recorded." : answer.error,
        };
        // If this write fails, the durable record stays unknown; never report a persisted success.
        await replace(finished);
        return finished;
      } finally {
        busy = false;
      }
    },
  };
}
