import { describe, expect, it, vi } from "vitest";
import {
  AuctionCommands,
  memoryCommandStorage,
  STORAGE_TIMEOUT_MS,
  type CommandStorage,
} from "./command-runtime";
import { commandOutcome, recoveryContext } from "./command-state";

function storage(initial?: unknown) {
  let value = initial;
  const adapter: CommandStorage = {
    read: () => Promise.resolve(value),
    update: (change) => {
      const updated = change(value);
      value = updated;
      return Promise.resolve(updated);
    },
  };
  return { adapter, read: () => value };
}
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function markerId(client: AuctionCommands) {
  const marker = client.markers[0];
  if (!marker) throw new Error("Recovery marker missing");
  return marker.commandId;
}
const accepted = (commandId: string, version = 5) => ({ commandId, accepted: true, version });

describe("auction command safety", () => {
  it("acquires before a same-frame duplicate and keeps unrelated gavel available", async () => {
    const saved = storage();
    const client = new AuctionCommands("person", "auction", saved.adapter, () => {});
    await client.load();
    const answer = held<unknown>();
    let requests = 0;
    let id = "";
    const first = client.dispatch("queue", "QueueLots", {}, (commandId) => {
      requests++;
      id = commandId;
      return answer.promise;
    });
    expect(
      (
        await client.dispatch("queue", "QueueLots", {}, () => {
          requests++;
          return Promise.resolve(undefined);
        })
      ).kind,
    ).toBe("not-started");
    expect(client.blocked("CloseLot", { lotId: "lot" })).toBe(false);
    expect(client.pending("queue")).toBe(true);
    await expect.poll(() => requests).toBe(1);
    expect(client.isCommandPending(id)).toBe(true);
    expect(client.isCommandPending("another-command-on-the-same-control")).toBe(false);
    answer.resolve(accepted(id));
    expect((await first).kind).toBe("accepted");
    expect(requests).toBe(1);
    expect(client.isCommandPending(id)).toBe(false);
    expect(client.markers[0]?.state).toBe("accepted");
    await client.observe(4);
    expect(client.blocked("QueueLots", {})).toBe(true);
    await client.observe(5);
    expect(client.blocked("QueueLots", {})).toBe(false);
  });
  it("persists before dispatch and atomically refuses another tab's conflicting bid", async () => {
    const saved = storage();
    const a = new AuctionCommands("person", "auction", saved.adapter, () => {});
    const b = new AuctionCommands("person", "auction", saved.adapter, () => {});
    await a.load();
    await b.load();
    const answer = held<unknown>();
    let calls = 0;
    let id = "";
    const first = a.dispatch("bid", "PlaceBid", { amountRaw: 100, lotId: "lot" }, (commandId) => {
      calls++;
      id = commandId;
      expect(saved.read()).toEqual(
        expect.arrayContaining([expect.objectContaining({ commandId, state: "prepared" })]),
      );
      return answer.promise;
    });
    await Promise.resolve();
    expect(
      (
        await b.dispatch("bid", "PlaceBid", { amountRaw: 200, lotId: "lot" }, () => {
          calls++;
          return Promise.resolve(undefined);
        })
      ).kind,
    ).toBe("not-started");
    answer.resolve(accepted(id));
    await first;
    expect(calls).toBe(1);
  });
  it.each(["engine_unreachable", "engine_http_502", "command_failed", "lost-answer", "malformed"])(
    "retains %s as unknown across reopen without replay",
    async (reason) => {
      const saved = storage();
      const a = new AuctionCommands("person", "auction", saved.adapter, () => {});
      await a.load();
      let calls = 0;
      const outcome = await a.dispatch(
        "bid",
        "PlaceBid",
        { amountRaw: 100, lotId: "lot" },
        (id) => {
          calls++;
          if (reason === "lost-answer")
            return Promise.reject(new Error("transport ended after commit"));
          if (reason === "malformed") return Promise.resolve(accepted("another-command"));
          return Promise.resolve({ commandId: id, accepted: false, reason, version: 0 });
        },
      );
      expect(outcome.kind).toBe("unknown");
      const b = new AuctionCommands("person", "auction", saved.adapter, () => {});
      await b.load();
      expect(b.blocked("PlaceBid", { amountRaw: 200 })).toBe(true);
      expect(calls).toBe(1);
      expect(await b.review(markerId(b), () => Promise.resolve(false))).toBe(false);
      expect(b.markers[0]?.state).toBe("unknown");
      await b.load();
      expect(await b.review(markerId(b), () => Promise.resolve(true))).toBe(true);
      expect(b.markers[0]?.state).toBe("reviewed");
      expect(b.blocked("PlaceBid", { amountRaw: 200 })).toBe(false);
      expect(calls).toBe(1);
    },
  );
  it("definitive refusal settles only its own marker", async () => {
    const saved = storage();
    const a = new AuctionCommands("person", "auction", saved.adapter, () => {});
    await a.load();
    expect(
      (
        await a.dispatch("complete", "CompleteAuction", {}, (id) =>
          Promise.resolve({
            commandId: id,
            accepted: false,
            reason: "squad_below_minimum",
            version: 3,
          }),
        )
      ).kind,
    ).toBe("refused");
    expect(a.markers).toEqual([]);
    expect(
      a.blocked("CompleteAuction", { overrideSquadMinimum: true, reason: "Approved exception" }),
    ).toBe(false);
  });
  it("storage failure keeps bidding in this tab; corruption is not an empty recovery list", async () => {
    const saved = storage();
    let calls = 0;
    const a = new AuctionCommands(
      "person",
      "auction",
      {
        ...saved.adapter,
        update: () => Promise.reject(new Error("disk unavailable")),
      },
      () => {},
    );
    await a.load();
    // No device storage: the bid still goes out once, guarded in memory.
    await a.dispatch("bid", "PlaceBid", {}, () => {
      calls++;
      return Promise.resolve(undefined);
    });
    expect(calls).toBe(1);
    expect(a.degraded).toBe(true);
    expect(a.error).toBeNull();
    const b = new AuctionCommands(
      "person",
      "auction",
      storage({ wrong: "shape" }).adapter,
      () => {},
    );
    await b.load();
    expect(b.ready).toBe(false);
    expect(b.error).toBeTruthy();
  });
  it("a settlement write that fails moves recovery to this tab and still settles", async () => {
    const saved = storage();
    let writes = 0;
    const a = new AuctionCommands(
      "person",
      "auction",
      {
        ...saved.adapter,
        update: (change) => {
          if (++writes === 2) throw new Error("settlement failed");
          return saved.adapter.update(change);
        },
      },
      () => {},
    );
    await a.load();
    expect(
      (await a.dispatch("bid", "PlaceBid", {}, (id) => Promise.resolve(accepted(id)))).kind,
    ).toBe("accepted");
    expect(a.error).toBeNull();
    expect(a.degraded).toBe(true);
    // The prepared marker was carried into memory and settled there.
    expect(a.markers[0]?.state).toBe("accepted");
  });
  it("late answers after an account/room stop cannot repopulate rendered recovery state", async () => {
    const saved = storage();
    const a = new AuctionCommands("person", "auction", saved.adapter, () => {});
    await a.load();
    const answer = held<unknown>();
    let id = "";
    const sent = a.dispatch("bid", "PlaceBid", {}, (commandId) => {
      id = commandId;
      return answer.promise;
    });
    await expect.poll(() => id).not.toBe("");
    a.stop();
    answer.resolve(accepted(id));
    expect((await sent).kind).toBe("unknown");
    expect(a.markers).toEqual([]);
    expect(a.ready).toBe(false);
  });
  it("does not persist arbitrary payload secrets or accept mismatched answers", () => {
    expect(
      recoveryContext({ lotId: "lot", amountRaw: 100, inviteToken: "bearer", phone: "private" }),
    ).toEqual({ lotId: "lot", amountRaw: 100 });
    expect(commandOutcome(accepted("other"), "this").kind).toBe("unknown");
    expect(commandOutcome({ commandId: "this", accepted: false, version: 0 }, "this").kind).toBe(
      "unknown",
    );
  });
  it("coordinates Undo and Hold without preventing queue or pause, and waits for the acknowledged room", async () => {
    const saved = storage();
    const a = new AuctionCommands("person", "auction", saved.adapter, () => {});
    await a.load();
    const lease = a.acquireChain("UndoLastAction", {});
    if (!lease) throw new Error("Undo lease unavailable");
    expect(a.isChainActive(lease.commandId)).toBe(true);
    expect(a.isChainActive("other-lease")).toBe(false);
    expect(a.blocked("CloseLot", { lotId: "lot" })).toBe(true);
    expect(a.blocked("QueueLots", {})).toBe(false);
    expect(a.blocked("PauseAuction", {})).toBe(false);
    expect(
      (
        await a.dispatch(
          "undo",
          "UndoLastAction",
          {},
          (id) => Promise.resolve(accepted(id)),
          undefined,
          lease,
        )
      ).kind,
    ).toBe("accepted");
    const observed = a.waitForRoom("undo");
    await a.observe(5);
    expect(await observed).toBe(true);
    expect(a.blocked("OpenLot", { lotId: "different" })).toBe(true);
    expect(
      (
        await a.dispatch(
          "undo-hold",
          "HoldLot",
          { lotId: "lot" },
          (id) =>
            Promise.resolve({ commandId: id, accepted: false, reason: "not_found", version: 5 }),
          undefined,
          lease,
        )
      ).kind,
    ).toBe("refused");
    await a.releaseChain(lease);
    expect(a.isChainActive(lease.commandId)).toBe(false);
    expect(a.blocked("CloseLot", { lotId: "lot" })).toBe(false);
  });
  it("retains frozen partial requeue progress with the uncertain item", async () => {
    const saved = storage();
    const a = new AuctionCommands("person", "auction", saved.adapter, () => {});
    await a.load();
    const targets = ["first", "uncertain", "remaining"],
      progress = ["first"];
    const pending = a.dispatch(
      "requeue-uncertain",
      "RequeueLot",
      { lotId: "uncertain" },
      (id) =>
        Promise.resolve({ commandId: id, accepted: false, reason: "command_failed", version: 0 }),
      { targets, accepted: progress },
    );
    targets.push("later");
    progress.push("fabricated");
    expect((await pending).kind).toBe("unknown");
    const b = new AuctionCommands("person", "auction", saved.adapter, () => {});
    await b.load();
    expect(b.markers[0]?.batch).toEqual({
      targets: ["first", "uncertain", "remaining"],
      accepted: ["first"],
    });
  });
});

describe("practice lifecycle recovery", () => {
  it("coordinates card and cockpit lifecycle before dispatch and retains lost creation through reopening", async () => {
    const saved = storage();
    const card = new AuctionCommands("person", "real", saved.adapter, () => {});
    const cockpit = new AuctionCommands("person", "real", saved.adapter, () => {});
    await card.load();
    await cockpit.load();
    const answer = held<unknown>();
    let calls = 0;
    const first = card.dispatchPractice(
      "again",
      "RunPracticeAgain",
      { practiceId: "old", realAuctionId: "real", perTeam: 3 },
      () => {
        calls++;
        return answer.promise;
      },
    );
    expect(
      (
        await card.dispatchPractice("again", "RunPracticeAgain", {}, () => {
          calls++;
          return Promise.resolve(null);
        })
      ).kind,
    ).toBe("not-started");
    expect(
      (
        await cockpit.dispatchPractice("end", "EndPracticeLifecycle", {}, () => {
          calls++;
          return Promise.resolve(null);
        })
      ).kind,
    ).toBe("not-started");
    answer.resolve(null);
    expect((await first).kind).toBe("unknown");
    const reopened = new AuctionCommands("person", "real", saved.adapter, () => {});
    await reopened.load();
    expect(reopened.blocked("StartPractice", {})).toBe(true);
    expect(reopened.markers[0]?.context).toEqual({
      practiceId: "old",
      realAuctionId: "real",
      perTeam: 3,
    });
    expect(calls).toBe(1);
  });
  it("settles a real created identity without a fabricated engine version", async () => {
    const saved = storage();
    const card = new AuctionCommands("person", "real", saved.adapter, () => {});
    await card.load();
    const outcome = await card.dispatchPractice(
      "start",
      "StartPractice",
      { perTeam: 2 },
      (intentId) =>
        Promise.resolve({
          intentId,
          kind: "accepted",
          stage: "complete",
          message: "Created",
          ended: false,
          practiceId: crypto.randomUUID(),
        }),
    );
    expect(outcome.kind).toBe("accepted");
    expect(outcome).not.toHaveProperty("ack");
    expect(saved.read()).toEqual([]);
    expect(card.blocked("StartPractice", {})).toBe(false);
  });
  it("retains partial end-before-unknown-creation and does not turn review into a receipt", async () => {
    const saved = storage();
    const card = new AuctionCommands("person", "real", saved.adapter, () => {});
    await card.load();
    const outcome = await card.dispatchPractice(
      "again",
      "RunPracticeAgain",
      { practiceId: "old" },
      (intentId) =>
        Promise.resolve({
          intentId,
          kind: "unknown",
          stage: "create",
          message: "End established; creation unknown",
          ended: true,
        }),
    );
    expect(outcome).toMatchObject({ kind: "unknown", ended: true, stage: "create" });
    expect(card.markers[0]?.lifecycle).toEqual({ stage: "create", ended: true });
    const reopened = new AuctionCommands("person", "real", saved.adapter, () => {});
    await reopened.load();
    expect(reopened.markers[0]?.lifecycle).toEqual({ stage: "create", ended: true });
    const id = markerId(card);
    expect(await card.review(id, () => Promise.resolve(false))).toBe(false);
    expect(card.blocked("EndPracticeLifecycle", {})).toBe(true);
    await card.load();
    expect(await card.review(id, () => Promise.resolve(true))).toBe(true);
    expect(card.markers[0]?.state).toBe("reviewed");
    expect(card.blocked("StartPractice", {})).toBe(false);
    expect(card.markers[0]).not.toHaveProperty("practiceId");
  });
  it("reports established end and refused creation as partial, with no pending repeat", async () => {
    const saved = storage();
    const card = new AuctionCommands("person", "real", saved.adapter, () => {});
    await card.load();
    const outcome = await card.dispatchPractice("again", "RunPracticeAgain", {}, (intentId) =>
      Promise.resolve({
        intentId,
        kind: "refused",
        stage: "create",
        message: "Old ended; replacement exists",
        ended: true,
      }),
    );
    expect(outcome).toMatchObject({ kind: "refused", ended: true, stage: "create" });
    expect(card.markers).toEqual([]);
  });
  it("reserves in memory when storage cannot, and rejects mismatched direct receipt", async () => {
    let calls = 0;
    const broken = new AuctionCommands(
      "person",
      "real",
      { read: () => Promise.resolve(undefined), update: () => Promise.reject(new Error("full")) },
      () => {},
    );
    await broken.load();
    expect(
      (
        await broken.dispatchPractice("start", "StartPractice", {}, () => {
          calls++;
          return Promise.resolve(null);
        })
      ).kind,
    ).toBe("unknown");
    expect(calls).toBe(1);
    expect(broken.degraded).toBe(true);
    const saved = storage();
    const card = new AuctionCommands("person", "real", saved.adapter, () => {});
    await card.load();
    expect(
      (
        await card.dispatchPractice("start", "StartPractice", {}, () =>
          Promise.resolve({
            intentId: "another",
            kind: "accepted",
            stage: "complete",
            ended: false,
            message: "Created",
            practiceId: "new",
          }),
        )
      ).kind,
    ).toBe("unknown");
    expect(card.blocked("RunPracticeAgain", {})).toBe(true);
  });
  it("does not allow an altered resource list to release the lifecycle lock", async () => {
    const saved = storage();
    const card = new AuctionCommands("person", "real", saved.adapter, () => {});
    await card.load();
    await card.dispatchPractice("start", "StartPractice", {}, () => Promise.resolve(null));
    const value = saved.read() as Array<Record<string, unknown>>;
    const first = value[0];
    if (!first) throw new Error("Missing persisted intent");
    first["resources"] = [];
    const reopened = new AuctionCommands("person", "real", saved.adapter, () => {});
    await reopened.load();
    expect(reopened.ready).toBe(false);
    expect(reopened.error).toMatch(/damaged/);
    expect(reopened.blocked("StartPractice", {})).toBe(true);
  });
});

describe("exact-practice shared termination reservations", () => {
  function rooms() {
    const saved = storage();
    const ordinary = new AuctionCommands("person", "practice", saved.adapter, () => {}, "real");
    const lifecycle = new AuctionCommands("person", "real", saved.adapter, () => {});
    return { saved, ordinary, lifecycle };
  }
  it.each(["PlaceBid", "CloseLot", "UndoLastAction"])(
    "held/unknown %s excludes End and Run again across tabs",
    async (type) => {
      const { ordinary, lifecycle } = rooms();
      await ordinary.load();
      await lifecycle.load();
      const answer = held<unknown>();
      let sent = 0;
      const ongoing = ordinary.dispatch("ordinary", type, {}, () => answer.promise);
      for (const action of ["EndPracticeLifecycle", "RunPracticeAgain"]) {
        expect(
          (
            await lifecycle.dispatchPractice("end", action, { practiceId: "practice" }, () => {
              sent++;
              return Promise.resolve(null);
            })
          ).kind,
        ).toBe("not-started");
      }
      answer.resolve(undefined);
      expect((await ongoing).kind).toBe("unknown");
      expect(
        (
          await lifecycle.dispatchPractice(
            "end",
            "EndPracticeLifecycle",
            { practiceId: "practice" },
            () => {
              sent++;
              return Promise.resolve(null);
            },
          )
        ).kind,
      ).toBe("not-started");
      expect(sent).toBe(0);
      expect(await ordinary.review(markerId(ordinary), () => Promise.resolve(true))).toBe(true);
      await lifecycle.load();
      expect(
        (
          await lifecycle.dispatchPractice(
            "end",
            "EndPracticeLifecycle",
            { practiceId: "practice" },
            (intentId) =>
              Promise.resolve({
                intentId,
                kind: "refused",
                stage: "before-write",
                ended: false,
                message: "Room changed",
              }),
          )
        ).kind,
      ).toBe("refused");
    },
  );
  it.each(["EndPracticeLifecycle", "RunPracticeAgain"])(
    "held/unknown %s excludes exact-practice mutations while clock/recovery remain available",
    async (type) => {
      const { ordinary, lifecycle, saved } = rooms();
      await ordinary.load();
      await lifecycle.load();
      const answer = held<unknown>();
      let sends = 0;
      const ongoing = lifecycle.dispatchPractice(
        "end",
        type,
        { practiceId: "practice" },
        () => answer.promise,
      );
      for (const command of ["PlaceBid", "CloseLot", "UndoLastAction", "QueueLots"]) {
        expect(
          (
            await ordinary.dispatch("normal", command, {}, () => {
              sends++;
              return Promise.resolve(null);
            })
          ).kind,
        ).toBe("not-started");
      }
      await ordinary.load();
      expect(ordinary.blocked("PauseAuction", {})).toBe(false);
      expect(ordinary.blocked("RecoverAuction", {})).toBe(false);
      const another = new AuctionCommands(
        "person",
        "another-practice",
        saved.adapter,
        () => {},
        "real",
      );
      await another.load();
      expect(another.blocked("PlaceBid", {})).toBe(false);
      answer.resolve(undefined);
      expect((await ongoing).kind).toBe("unknown");
      expect(
        (
          await ordinary.dispatch("normal", "PlaceBid", {}, () => {
            sends++;
            return Promise.resolve(null);
          })
        ).kind,
      ).toBe("not-started");
      expect(sends).toBe(0);
    },
  );
  it("persists the Undo→Hold lease across acknowledged Undo observation and blocks termination in another tab", async () => {
    const { ordinary, lifecycle } = rooms();
    await ordinary.load();
    await lifecycle.load();
    const lease = ordinary.acquireChain("UndoLastAction", {});
    if (!lease) throw new Error("No correction lease");
    const undo = await ordinary.dispatch(
      "undo",
      "UndoLastAction",
      {},
      (id) => Promise.resolve(accepted(id, 5)),
      undefined,
      lease,
    );
    expect(undo.kind).toBe("accepted");
    await ordinary.observe(5);
    expect(await ordinary.waitForRoom("undo")).toBe(true);
    expect(
      (
        await lifecycle.dispatchPractice(
          "end",
          "EndPracticeLifecycle",
          { practiceId: "practice" },
          () => Promise.resolve(null),
        )
      ).kind,
    ).toBe("not-started");
    await lifecycle.load();
    expect(lifecycle.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "UndoHoldChain", auctionId: "practice" }),
      ]),
    );
    const hold = await ordinary.dispatch(
      "hold",
      "HoldLot",
      { lotId: "lot" },
      (id) =>
        Promise.resolve({
          commandId: id,
          accepted: false,
          reason: "illegal_transition",
          version: 5,
        }),
      undefined,
      lease,
    );
    expect(hold.kind).toBe("refused");
    await ordinary.releaseChain(lease);
    await lifecycle.load();
    expect(
      (
        await lifecycle.dispatchPractice(
          "end",
          "EndPracticeLifecycle",
          { practiceId: "practice" },
          (intentId) =>
            Promise.resolve({
              intentId,
              kind: "accepted",
              stage: "complete",
              ended: true,
              message: "Ended",
            }),
        )
      ).kind,
    ).toBe("accepted");
  });
  it("a real-auction acknowledgement version never settles the practice marker in the shared store", async () => {
    const { ordinary, lifecycle } = rooms();
    await ordinary.load();
    await lifecycle.load();
    await ordinary.dispatch("bid", "PlaceBid", {}, (id) => Promise.resolve(accepted(id, 5)));
    await lifecycle.load();
    await lifecycle.observe(1000);
    await ordinary.load();
    expect(ordinary.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          auctionId: "practice",
          state: "accepted",
          acknowledgedVersion: 5,
        }),
      ]),
    );
    expect(ordinary.blocked("PlaceBid", {})).toBe(true);
    await ordinary.observe(5);
    expect(ordinary.blocked("PlaceBid", {})).toBe(false);
  });
  it("unrelated queue and gavel still do not share a reservation", async () => {
    const { ordinary } = rooms();
    await ordinary.load();
    const answer = held<unknown>();
    const ongoing = ordinary.dispatch("queue", "QueueLots", {}, () => answer.promise);
    expect(ordinary.blocked("CloseLot", {})).toBe(false);
    answer.resolve(undefined);
    await ongoing;
  });
});

it("finishes a lease release in memory when storage fails, and clears identity on stop", async () => {
  const saved = storage();
  const client = new AuctionCommands("person", "auction", saved.adapter, () => {});
  await client.load();
  const lease = client.acquireChain("UndoLastAction", {});
  if (!lease) throw new Error("No correction lease");
  await client.dispatch(
    "undo",
    "UndoLastAction",
    {},
    (id) => Promise.resolve(accepted(id)),
    undefined,
    lease,
  );
  saved.adapter.update = () => Promise.reject(new Error("Release storage failed"));
  await client.releaseChain(lease);
  expect(client.error).toBeNull();
  expect(client.degraded).toBe(true);
  expect(client.isChainActive(lease.commandId)).toBe(false);
  expect(client.markers.some((item) => item.commandId === lease.commandId)).toBe(false);
  client.stop();
  expect(client.stopped).toBe(true);
  expect(client.isChainActive(lease.commandId)).toBe(false);
});

describe("bidding without device storage", () => {
  it("falls back to this tab when the store hangs instead of failing", async () => {
    vi.useFakeTimers();
    try {
      const client = new AuctionCommands(
        "person",
        "auction",
        { read: () => new Promise(() => {}), update: () => new Promise(() => {}) },
        () => {},
      );
      const loading = client.load();
      await vi.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS);
      await loading;
      expect(client.ready).toBe(true);
      expect(client.degraded).toBe(true);
      let calls = 0;
      const sent = client.dispatch("bid", "PlaceBid", {}, (id) => {
        calls++;
        return Promise.resolve(accepted(id));
      });
      expect((await sent).kind).toBe("accepted");
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("a bid whose answer was lost unblocks bidding once the room moves on", async () => {
    const client = new AuctionCommands("person", "auction", memoryCommandStorage(), () => {});
    await client.load();
    await client.observe(7);
    const lost = await client.dispatch("bid", "PlaceBid", {}, () =>
      Promise.reject(new Error("socket closed")),
    );
    expect(lost.kind).toBe("unknown");
    expect(client.blocked("PlaceBid", {})).toBe(true);
    await client.observe(7);
    expect(client.blocked("PlaceBid", {})).toBe(true);
    await client.observe(8);
    expect(client.blocked("PlaceBid", {})).toBe(false);
  });
});
