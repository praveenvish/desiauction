import { afterEach, describe, expect, it, vi } from "vitest";

import { withViewTransition } from "./view-transition";

/**
 * The only properties worth pinning here are the ones that FAIL OPEN. A view
 * transition is decoration; the state change it wraps is not. Every path below
 * asks the same question: did the update still happen?
 */
type Stub = { startViewTransition?: unknown };

function install(options: { supported: boolean; reduced?: boolean; throws?: boolean }): {
  calls: () => number;
} {
  let calls = 0;
  const doc: Stub = options.supported
    ? {
        startViewTransition: (cb: () => void) => {
          calls += 1;
          if (options.throws === true) {
            throw new Error("browser said no");
          }
          cb();
          return {};
        },
      }
    : {};
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: options.reduced === true }),
  });
  return { calls: () => calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("withViewTransition — decoration may never cost a state change", () => {
  it("runs the transition when it is supported and motion is welcome", () => {
    const probe = install({ supported: true });
    let updated = false;
    withViewTransition(() => {
      updated = true;
    });
    expect(probe.calls()).toBe(1);
    expect(updated).toBe(true);
  });

  it("skips the transition under REDUCED MOTION but still updates", () => {
    // Measured on a production build, not only asserted here: the poster studio
    // started 2 transitions with motion allowed and 0 with it reduced.
    const probe = install({ supported: true, reduced: true });
    let updated = false;
    withViewTransition(() => {
      updated = true;
    });
    expect(probe.calls()).toBe(0);
    expect(updated).toBe(true);
  });

  it("updates in a browser with no view transitions at all (Firefox today)", () => {
    install({ supported: false });
    let updated = false;
    withViewTransition(() => {
      updated = true;
    });
    expect(updated).toBe(true);
  });

  it("updates even when a browser advertises the API and then throws", () => {
    const probe = install({ supported: true, throws: true });
    let updated = false;
    withViewTransition(() => {
      updated = true;
    });
    expect(probe.calls()).toBe(1);
    expect(updated).toBe(true);
  });
});
