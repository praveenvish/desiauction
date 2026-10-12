import { expect, it, vi } from "vitest";
import {
  createFinancialIntentBoundary,
  readFinancialRecords,
  type FinancialIntent,
  type FinancialRecord,
} from "./financial-intent";
const intent: FinancialIntent = {
  key: "original",
  actorId: "person",
  orgId: "org",
  caseId: "case",
  targetId: "team",
  kind: "payment",
  amount: "1,234.50",
  method: "manual:cash",
  reason: "",
};
function fixture() {
  let durable: unknown;
  let current = true;
  const write = vi.fn((change: (stored: unknown) => readonly FinancialRecord[]) => {
    durable = structuredClone(change(durable));
    return Promise.resolve();
  });
  const store = { read: () => Promise.resolve(durable), update: write };
  const guard = () => {
    if (!current) throw new Error("Account changed");
  };
  return {
    boundary: createFinancialIntentBoundary(store, intent, guard),
    store,
    guard,
    write,
    stop: () => {
      current = false;
      durable = undefined;
    },
  };
}
it("retains committed lost answers on reload, never dispatches restoration or rotates an existing key", async () => {
  const f = fixture();
  const send = vi.fn(async (original: FinancialIntent) => {
    expect((await f.boundary.read())[0]?.intent).toEqual(original);
    expect((await f.boundary.read())[0]?.outcome).toBe("unknown");
    throw new Error("lost after commit");
  });
  expect((await f.boundary.dispatch(intent, send)).outcome).toBe("unknown");
  const restored = createFinancialIntentBoundary(f.store, intent, f.guard);
  expect((await restored.read())[0]?.intent).toEqual(intent);
  await expect(restored.dispatch(intent, send, true)).rejects.toThrow("already exists");
  await expect(restored.dispatch({ ...intent, key: "new" }, send)).rejects.toThrow("unresolved");
  expect(send).toHaveBeenCalledTimes(1);
});
it("excludes duplicate activation even before the first storage read completes", async () => {
  const f = fixture();
  const send = vi.fn(() => Promise.resolve({ ok: true as const }));
  const first = f.boundary.dispatch(intent, send);
  await expect(f.boundary.dispatch({ ...intent, key: "second" }, send)).rejects.toThrow(
    "already being",
  );
  await first;
  expect(send).toHaveBeenCalledTimes(1);
});
it("prevents dispatch on failed storage and fails closed on corrupt or other-actor records", async () => {
  const f = fixture();
  f.write.mockRejectedValueOnce(new Error("storage unavailable"));
  const send = vi.fn(() => Promise.resolve({ ok: true as const }));
  await expect(f.boundary.dispatch(intent, send)).rejects.toThrow("storage unavailable");
  expect(send).not.toHaveBeenCalled();
  expect(() =>
    readFinancialRecords([{ intent, outcome: "failed", message: "" }], intent),
  ).toThrow();
  expect(() =>
    readFinancialRecords(
      [{ intent: { ...intent, actorId: "other" }, outcome: "unknown", message: "" }],
      intent,
    ),
  ).toThrow();
});
it("allows a genuinely identical second payment using a new key", async () => {
  const f = fixture();
  const send = vi.fn(() => Promise.resolve({ ok: true as const }));
  await f.boundary.dispatch(intent, send);
  await f.boundary.dispatch({ ...intent, key: "second" }, send);
  expect((await f.boundary.read()).map((r) => r.outcome)).toEqual(["accepted", "accepted"]);
});
it("preserves unresolved history during explicitly reviewed new work", async () => {
  const f = fixture();
  await f.boundary.dispatch(intent, () => Promise.reject(new Error("lost")));
  await f.boundary.dispatch(
    { ...intent, key: "deliberate-new" },
    () => Promise.resolve({ ok: true as const }),
    true,
  );
  expect((await f.boundary.read()).map((r) => r.outcome)).toEqual(["unknown", "accepted"]);
});
it("preserves exact refund amount, target and reason in a definitive refusal", async () => {
  const f = fixture();
  const original = {
    ...intent,
    kind: "refund" as const,
    targetId: "payment",
    amount: "12.34",
    reason: "Partial correction",
    method: "",
  };
  const record = await f.boundary.dispatch(original, (sent) => {
    expect(sent).toEqual(original);
    return Promise.resolve({ ok: false as const, error: "Authority revoked" });
  });
  expect(record.outcome).toBe("refused");
  expect(record.intent).toEqual(original);
});
it("suppresses stale successful callbacks after account purge", async () => {
  const f = fixture();
  await expect(
    f.boundary.dispatch(intent, () => {
      f.stop();
      return Promise.resolve({ ok: true as const });
    }),
  ).rejects.toThrow("Account changed");
  expect(f.write).toHaveBeenCalledTimes(2);
  expect(await f.store.read()).toBeUndefined();
});
it("keeps durable uncertainty when acknowledged-result storage fails", async () => {
  const f = fixture();
  await expect(
    f.boundary.dispatch(intent, () => {
      f.write.mockRejectedValueOnce(new Error("ack write failed"));
      return Promise.resolve({ ok: true as const });
    }),
  ).rejects.toThrow("ack write failed");
  expect((await f.boundary.read())[0]?.outcome).toBe("unknown");
});

it("serializes two mounted owners without dropping their retained history", async () => {
  const f = fixture();
  const other = createFinancialIntentBoundary(f.store, intent, f.guard);
  let answer: ((value: { ok: true }) => void) | undefined;
  const send = vi.fn(
    () =>
      new Promise<{ ok: true }>((resolve) => {
        answer = resolve;
      }),
  );
  const first = f.boundary.dispatch(intent, send);
  await expect(other.dispatch({ ...intent, key: "concurrent" }, send)).rejects.toThrow(
    "unresolved",
  );
  // Let the first operation reach its network boundary; no concurrent dispatch occurred.
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(1);
  answer?.({ ok: true });
  await first;
  await other.dispatch({ ...intent, key: "later" }, () => Promise.resolve({ ok: true }));
  expect((await f.boundary.read()).map((r) => r.intent.key)).toEqual(["original", "later"]);
});

it("negative and unavailable command review preserve unknown; exact positive review resolves without replay", async () => {
  const f = fixture();
  const send = vi.fn(() => Promise.reject(new Error("lost")));
  await f.boundary.dispatch(intent, send);
  for (const outcome of ["unknown", "unavailable"] as const) {
    expect((await f.boundary.review(intent.key, () => Promise.resolve({ outcome }))).outcome).toBe(
      "unknown",
    );
    expect((await f.boundary.read())[0]?.outcome).toBe("unknown");
  }
  expect(
    (
      await f.boundary.review(intent.key, (original) => {
        expect(original).toEqual(intent);
        return Promise.resolve({ outcome: "accepted" });
      })
    ).outcome,
  ).toBe("accepted");
  expect(send).toHaveBeenCalledTimes(1);
});

it("explicitly closes only unsent drafts without calling them refused or deleting unresolved work", async () => {
  let records: readonly FinancialRecord[] = [{ intent, outcome: "not-started", message: "" }];
  const boundary = createFinancialIntentBoundary(
    {
      read: () => Promise.resolve(records),
      update: (change) => {
        records = change(records);
        return Promise.resolve();
      },
    },
    intent,
    () => {},
  );
  await boundary.closeUnsent(intent.key);
  expect(records[0]?.outcome).toBe("not-started");
  expect(records[0]?.retired).toBe(true);
  await boundary.dispatch({ ...intent, key: "new-draft" }, () => Promise.resolve({ ok: true }));
  expect(records).toHaveLength(2);
  const f = fixture();
  await f.boundary.dispatch(intent, () => Promise.reject(new Error("lost")));
  await expect(f.boundary.closeUnsent(intent.key)).rejects.toThrow("Unknown outcomes");
  expect((await f.boundary.read())[0]?.outcome).toBe("unknown");
});
