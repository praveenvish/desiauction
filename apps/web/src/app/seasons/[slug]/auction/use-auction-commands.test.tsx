// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorBindingReceipt } from "../../../score/actor-binding";
import type { AuctionCommands } from "./command-runtime";
import { useAuctionCommands } from "./use-auction-commands";

const storage = vi.hoisted(() => ({
  resolve: undefined as ((receipt: ActorBindingReceipt) => void) | undefined,
  listeners: new Set<() => void>(),
  read: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("../../../score/storage", () => ({
  bindScoringActor: () =>
    new Promise<ActorBindingReceipt>((resolve) => {
      storage.resolve = resolve;
    }),
  onScoringStop: (listener: () => void) => {
    storage.listeners.add(listener);
    return () => storage.listeners.delete(listener);
  },
  scoringRead: storage.read,
  scoringUpdate: (_key: string, update: (value: undefined) => unknown) =>
    Promise.resolve(update(undefined)),
}));
vi.mock("./recovery-events", () => ({
  onAuctionRecoveryChange: () => () => undefined,
  publishAuctionRecovery: () => undefined,
}));

let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage.resolve = undefined;
  storage.listeners.clear();
  storage.read.mockClear();
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

function mount() {
  const host = document.createElement("div");
  const root = createRoot(host);
  let commands: AuctionCommands | undefined;
  function Probe() {
    commands = useAuctionCommands("B", "room", null);
    return null;
  }
  act(() => {
    root.render(<Probe />);
  });
  if (!commands) throw new Error("Missing mounted runtime");
  let mounted = true;
  cleanup = () => {
    if (mounted)
      act(() => {
        root.unmount();
      });
    mounted = false;
    host.remove();
  };
  return commands;
}
async function finishBinding(valid: () => boolean) {
  await act(async () => {
    storage.resolve?.({ actorId: "B", valid });
    await Promise.resolve();
  });
}
function stop() {
  act(() => {
    for (const listener of storage.listeners) listener();
  });
}

describe("auction initialization after authenticated actor binding", () => {
  it("restarts only its initializing runtime after the intentional purge receipt", async () => {
    const commands = mount();
    stop();
    expect(commands.stopped).toBe(true);
    await finishBinding(() => true);
    expect(commands.stopped).toBe(false);
    expect(commands.ready).toBe(true);
    expect(storage.read).toHaveBeenCalledTimes(1);
  });

  it("a stop immediately before activation invalidates the receipt and cannot load", async () => {
    const commands = mount();
    stop();
    await finishBinding(() => false);
    expect(commands.stopped).toBe(true);
    expect(commands.ready).toBe(false);
    expect(storage.read).not.toHaveBeenCalled();
  });

  it("unmount prevents a completed binding from reviving an old runtime", async () => {
    const commands = mount();
    cleanup?.();
    await finishBinding(() => true);
    expect(commands.stopped).toBe(true);
    expect(storage.read).not.toHaveBeenCalled();
  });
});
