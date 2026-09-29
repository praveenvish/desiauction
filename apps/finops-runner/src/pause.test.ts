import { describe, expect, it } from "vitest";

import { createPause } from "./pause";

describe("the wait between ticks", () => {
  it("runs its full length when nothing interrupts it", async () => {
    const pause = createPause();
    const started = Date.now();
    await pause.wait(60);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it("ends at once when woken — a stop does not wait out the tick", async () => {
    const pause = createPause();
    const started = Date.now();
    const waiting = pause.wait(15_000);
    setTimeout(() => {
      pause.wake();
    }, 20);
    await waiting;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("is safe to wake with nothing waiting, and twice", async () => {
    const pause = createPause();
    pause.wake();
    pause.wake();
    const waiting = pause.wait(15_000);
    pause.wake();
    pause.wake();
    await waiting;
    // A wake that arrived BEFORE the wait does not cancel the next one.
    const started = Date.now();
    await pause.wait(40);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  it("once closed, no wait happens at all — the stop that lands during a tick", async () => {
    const pause = createPause();
    // SIGTERM arrives while the tick is running: nothing is waiting yet.
    pause.close();
    const started = Date.now();
    await pause.wait(15_000);
    await pause.wait(15_000);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("closing ends the wait in hand too", async () => {
    const pause = createPause();
    const started = Date.now();
    const waiting = pause.wait(15_000);
    pause.close();
    await waiting;
    expect(Date.now() - started).toBeLessThan(500);
  });
});
