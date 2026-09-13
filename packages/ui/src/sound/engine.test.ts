import { describe, expect, it, vi } from "vitest";

import { SOUND_CUES } from "./cues";
import { createSoundEngine } from "./engine";

/**
 * A fake AudioContext that records what was started. The cues are pure
 * scheduling against this interface, so the test can prove every cue makes
 * sound and that the gates hold, without a speaker.
 */
function fakeContext() {
  const started: string[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = (kind: string) => ({
    type: "sine",
    frequency: param(),
    gain: param(),
    Q: param(),
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(() => started.push(kind)),
    stop: vi.fn(),
  });
  const ctx = {
    state: "suspended" as AudioContextState,
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    createGain: () => node("gain"),
    createOscillator: () => node("osc"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("noise"),
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    resume: vi.fn(() => {
      ctx.state = "running";
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  return { ctx: ctx as unknown as AudioContext, started };
}

describe("sound engine", () => {
  it("is silent until both the person and the browser have said yes", async () => {
    const { ctx, started } = fakeContext();
    const engine = createSoundEngine(() => ctx);
    engine.play("sold");
    expect(started).toEqual([]);

    engine.setEnabled(true);
    engine.play("sold");
    expect(started).toEqual([]); // enabled, but not unlocked

    expect(await engine.unlock()).toBe(true);
    engine.play("sold");
    expect(started.length).toBeGreaterThan(0);
  });

  it("every cue schedules at least one voice, and the gavel has wood in it", async () => {
    const { ctx, started } = fakeContext();
    const engine = createSoundEngine(() => ctx);
    engine.setEnabled(true);
    await engine.unlock();
    for (const cue of SOUND_CUES) {
      started.length = 0;
      engine.play(cue);
      expect(started.length, cue).toBeGreaterThan(0);
      if (cue === "sold") expect(started).toContain("noise");
    }
  });

  it("turning sound off mid-night stops the next cue, and unlock survives a refusal", async () => {
    const { ctx, started } = fakeContext();
    const engine = createSoundEngine(() => ctx);
    engine.setEnabled(true);
    await engine.unlock();
    engine.setEnabled(false);
    engine.play("bid");
    expect(started).toEqual([]);

    const refusing = createSoundEngine(() => {
      throw new Error("no audio here");
    });
    refusing.setEnabled(true);
    expect(await refusing.unlock()).toBe(false);
    expect(refusing.unlocked).toBe(false);
  });
});
