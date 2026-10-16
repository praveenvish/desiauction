// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorBindingReceipt } from "../actor-binding";
import { useFamilyMatch, type LocalPolicy, type LocalState } from "./use-family-match";

const state = vi.hoisted(() => ({
  resolve: undefined as ((receipt: ActorBindingReceipt) => void) | undefined,
  subscribe: vi.fn(() => () => undefined),
  load: vi.fn(() => Promise.resolve([])),
  device: vi.fn(() => Promise.resolve("device")),
  sync: vi.fn(() => ({ stop: vi.fn(), flush: () => Promise.resolve() })),
}));
vi.mock("../storage", () => ({
  bindScoringActor: () =>
    new Promise<ActorBindingReceipt>((resolve) => {
      state.resolve = resolve;
    }),
  onScoringStop: state.subscribe,
}));
vi.mock("./queue", () => ({
  loadQueue: state.load,
  scoringDevice: state.device,
  saveQueue: () => Promise.resolve(),
  queueBatch: () => [],
}));
vi.mock("./sync", () => ({
  startSync: state.sync,
  readHistory: () => Promise.resolve({ events: [] }),
}));
const policy: LocalPolicy<LocalState> = {
  replay: () => ({ attempt: 1, lastSeq: 0, finished: false }),
  accepted: () => false,
  scoringReady: () => false,
  undoTypes: [],
  refusal: () => "refused",
};
let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.resolve = undefined;
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});
function mount() {
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    useFamilyMatch("fixture", "B", [], undefined, policy);
    return null;
  }
  act(() => {
    root.render(<Probe />);
  });
  let mounted = true;
  cleanup = () => {
    if (mounted)
      act(() => {
        root.unmount();
      });
    mounted = false;
    host.remove();
  };
}
async function finish(valid: boolean) {
  await act(async () => {
    state.resolve?.({ actorId: "B", valid: () => valid });
    await Promise.resolve();
  });
}

describe("family initializer binding lifetime", () => {
  it("unmount during binding installs no late listener, restore or sender", async () => {
    mount();
    cleanup?.();
    await finish(true);
    expect(state.subscribe).not.toHaveBeenCalled();
    expect(state.load).not.toHaveBeenCalled();
    expect(state.device).not.toHaveBeenCalled();
    expect(state.sync).not.toHaveBeenCalled();
  });
  it("an invalid binding cannot subscribe, restore or sync", async () => {
    mount();
    await finish(false);
    expect(state.subscribe).not.toHaveBeenCalled();
    expect(state.load).not.toHaveBeenCalled();
    expect(state.sync).not.toHaveBeenCalled();
  });
  it("a valid mounted initializer installs cancellation and restores once", async () => {
    mount();
    await finish(true);
    expect(state.subscribe).toHaveBeenCalledTimes(1);
    expect(state.load).toHaveBeenCalledTimes(1);
    expect(state.device).toHaveBeenCalledTimes(1);
    expect(state.sync).toHaveBeenCalledTimes(1);
  });
});
