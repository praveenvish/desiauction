import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareMatch } from "./prepare";

const control = vi.hoisted(
  (): {
    mode: "purge" | "invalid" | "write-stop" | "persist-stop";
    listeners: Set<() => void>;
    writes: ReturnType<typeof vi.fn>;
  } => ({
    mode: "purge",
    listeners: new Set<() => void>(),
    writes: vi.fn(),
  }),
);
vi.mock("../storage", () => ({
  onScoringStop: (listener: () => void) => {
    control.listeners.add(listener);
    return () => control.listeners.delete(listener);
  },
  bindScoringActor: (actorId: string) => {
    for (const stop of control.listeners) stop();
    return Promise.resolve({ actorId, valid: () => control.mode !== "invalid" });
  },
  scoringRead: () => Promise.resolve(undefined),
  scoringWrite: () => {
    control.writes();
    if (control.mode === "write-stop") for (const stop of control.listeners) stop();
    return Promise.resolve();
  },
}));
vi.mock("../../../lib/pwa", () => ({
  registerServiceWorker: () => Promise.resolve({ active: {}, update: () => Promise.resolve() }),
  requestPersistentStorage: () => {
    if (control.mode === "persist-stop") for (const stop of control.listeners) stop();
    return Promise.resolve();
  },
}));

beforeEach(() => {
  control.mode = "purge";
  control.listeners.clear();
  control.writes.mockClear();
  vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve() } });
  vi.stubGlobal("caches", {
    open: () => Promise.resolve({ put: () => Promise.resolve() }),
    keys: () => Promise.resolve(["da-shell-test"]),
  });
});
afterEach(() => vi.unstubAllGlobals());

const fetcher: typeof fetch = (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "/score/shell")
    return Promise.resolve(
      new Response(
        `<meta name="ls1-build-assets" content="${encodeURIComponent(JSON.stringify(["/_next/static/test.js"]))}">`,
      ),
    );
  if (url === "/_next/static/test.js") {
    const response = new Response("asset", { headers: { "cache-control": "immutable" } });
    Object.defineProperty(response, "type", { value: "basic" });
    return Promise.resolve(response);
  }
  return Promise.resolve(
    Response.json({
      attempt: null,
      preparation: "unstarted",
      lastSeq: 0,
      events: [],
      bootstrap: {
        actorId: "B",
        names: { players: {}, teams: {} },
        setup: {},
        language: "en",
        sharePath: "/m/token",
        nextMatch: null,
      },
    }),
  );
};

describe("preparation binding and final persistence cancellation", () => {
  it("a valid intentional actor purge permits the fresh prepared snapshot", async () => {
    expect((await prepareMatch("fixture", fetcher)).bootstrap.actorId).toBe("B");
    expect(control.writes).toHaveBeenCalledTimes(1);
    expect(control.listeners.size).toBe(0);
  });
  it("an invalid binding receipt cannot warm or publish readiness", async () => {
    control.mode = "invalid";
    await expect(prepareMatch("fixture", fetcher)).rejects.toThrow("account storage changed");
    expect(control.writes).not.toHaveBeenCalled();
  });
  for (const mode of ["write-stop", "persist-stop"] as const)
    it(`a stop during ${mode} prevents a ready result`, async () => {
      control.mode = mode;
      await expect(prepareMatch("fixture", fetcher)).rejects.toThrow("stopped after sign-out");
      expect(control.listeners.size).toBe(0);
    });
});
