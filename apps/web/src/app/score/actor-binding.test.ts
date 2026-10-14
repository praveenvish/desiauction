import { describe, expect, it } from "vitest";
import { createActorBinder } from "./actor-binding";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function fixture(actor: string | null = "A") {
  const state = {
    actor: actor ?? undefined,
    stopped: false,
    generation: 0,
    reads: 0,
    purges: 0,
    writes: 0,
    reopens: 0,
  };
  let purgeGate: ReturnType<typeof deferred> | undefined;
  let writeGate: ReturnType<typeof deferred> | undefined;
  const stop = () => {
    state.stopped = true;
    return ++state.generation;
  };
  const bind = createActorBinder({
    stopped: () => state.stopped,
    stopGeneration: () => state.generation,
    reopen: () => {
      state.stopped = false;
      state.reopens++;
    },
    readActor: () => {
      state.reads++;
      return Promise.resolve(state.actor);
    },
    stop,
    purge: async () => {
      state.purges++;
      const gate = purgeGate;
      purgeGate = undefined;
      if (gate) await gate.promise;
      state.actor = undefined;
    },
    writeActor: async (next, valid) => {
      const gate = writeGate;
      writeGate = undefined;
      if (gate) await gate.promise;
      if (!valid()) throw new Error("Binding canceled before write");
      state.writes++;
      state.actor = next;
    },
  });
  return {
    state,
    bind,
    stop,
    holdPurge: () => {
      purgeGate = deferred();
      return purgeGate;
    },
    holdWrite: () => {
      writeGate = deferred();
      return writeGate;
    },
  };
}

describe("authenticated actor storage binding", () => {
  it("coalesces sibling bindings and reopens only after its own completed purge", async () => {
    const f = fixture();
    const first = f.bind("B");
    expect(f.bind("B")).toBe(first);
    const receipt = await first;
    expect(receipt.actorId).toBe("B");
    expect(receipt.valid()).toBe(true);
    expect(f.state).toMatchObject({
      actor: "B",
      reads: 1,
      purges: 1,
      writes: 1,
      reopens: 1,
      stopped: false,
    });
  });

  it("does not reopen after sign-out interrupts its intentional purge", async () => {
    const f = fixture();
    const gate = f.holdPurge();
    const operation = f.bind("B");
    const result = expect(operation).rejects.toThrow("canceled during its purge");
    await Promise.resolve();
    expect(f.state.purges).toBe(1);
    f.stop();
    gate.release();
    await result;
    expect(f.state).toMatchObject({ actor: undefined, writes: 0, reopens: 0, stopped: true });
  });

  it("guards the actor write and invalidates a receipt immediately after a later stop", async () => {
    const f = fixture(null);
    const gate = f.holdWrite();
    const operation = f.bind("B");
    const result = expect(operation).rejects.toThrow("canceled before write");
    await Promise.resolve();
    f.stop();
    gate.release();
    await result;
    expect(f.state.writes).toBe(0);
    const receipt = await f.bind("B");
    expect(receipt.valid()).toBe(true);
    f.stop();
    expect(receipt.valid()).toBe(false);
  });

  it("a competing binding cannot let an older purge reactivate or overwrite it", async () => {
    const f = fixture();
    const gate = f.holdPurge();
    const old = f.bind("B");
    const rejected = expect(old).rejects.toThrow("canceled during its purge");
    await Promise.resolve();
    // Native storage serializes the purge transaction before the next actor
    // read/write. Finish it while the new binding has already superseded B.
    const newer = f.bind("C");
    gate.release();
    await rejected;
    const receipt = await newer;
    expect(receipt.valid()).toBe(true);
    expect(f.state.actor).toBe("C");
    expect(f.state.writes).toBe(1);
  });
});
