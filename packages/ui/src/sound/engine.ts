import { scheduleCue, type SoundCue } from "./cues";

/**
 * THE SOUND ENGINE — one AudioContext per page, created late and on purpose.
 *
 * Browsers refuse to start audio until the person has touched the page, and
 * a context created before that sits suspended forever. So the engine does
 * nothing until `unlock()` is called from inside a real gesture — a tap on
 * the "Big screen" switch, a press of the gavel — and every `play()` before
 * that is dropped, not queued. A cue that arrives late is worse than none.
 *
 * `enabled` is the person's choice (see use-sound.ts); `unlocked` is the
 * browser's. Both must be true for a cue to sound.
 */
export interface SoundEngine {
  readonly enabled: boolean;
  readonly unlocked: boolean;
  /** Must be called from a user gesture. Resolves true once audio can play. */
  unlock(): Promise<boolean>;
  setEnabled(enabled: boolean): void;
  play(cue: SoundCue): void;
  /** Tears the context down; the next unlock starts fresh. */
  dispose(): void;
}

type ContextFactory = () => AudioContext;

const MASTER_GAIN = 0.55;

function defaultFactory(): AudioContext {
  return new AudioContext();
}

export function createSoundEngine(factory: ContextFactory = defaultFactory): SoundEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let enabled = false;

  const running = () => ctx !== null && ctx.state === "running";

  return {
    get enabled() {
      return enabled;
    },
    get unlocked() {
      return running();
    },
    async unlock() {
      if (typeof window === "undefined") return false;
      try {
        if (ctx === null) {
          ctx = factory();
          master = ctx.createGain();
          master.gain.value = MASTER_GAIN;
          master.connect(ctx.destination);
        }
        if (ctx.state !== "running") {
          await ctx.resume();
        }
        return running();
      } catch {
        // No audio on this device or the gesture did not count — stay silent.
        return false;
      }
    },
    setEnabled(next) {
      enabled = next;
    },
    play(cue) {
      if (!enabled || ctx === null || master === null || !running()) return;
      scheduleCue(ctx, master, cue, ctx.currentTime);
    },
    dispose() {
      if (ctx !== null) {
        void ctx.close().catch(() => undefined);
      }
      ctx = null;
      master = null;
    },
  };
}
