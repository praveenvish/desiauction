/**
 * THE CUES — every sound the platform makes, synthesised.
 *
 * No audio files on purpose. A recorded gavel needs a licence, a CDN and a
 * fetch before the first strike; an oscillator needs none of those and weighs
 * nothing. Each cue is a few nodes scheduled on the context's clock, so it
 * lands at the moment it was asked for and never queues behind a download.
 *
 * Levels are deliberately low. A hall's speakers are loud; a phone in a hand
 * is close to an ear. Master gain lives in the engine; here every cue peaks
 * well under unity so a burst of bids never clips.
 *
 * UNSOLD has no cue. The design canon (doc 05, C-23) gives rejection of a
 * person dignified brevity: neutral ink, no red, no sound. That is a product
 * rule, not an omission.
 */

export type SoundCue = "opening" | "bid" | "extension" | "warning" | "sold" | "complete";

export const SOUND_CUES: readonly SoundCue[] = [
  "opening",
  "bid",
  "extension",
  "warning",
  "sold",
  "complete",
];

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  {
    type,
    freq,
    at,
    dur,
    peak,
    glideTo,
  }: {
    type: OscillatorType;
    freq: number;
    at: number;
    dur: number;
    peak: number;
    glideTo?: number;
  },
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  }
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** A short burst of filtered noise: the wood of the gavel. */
function knock(ctx: BaseAudioContext, out: AudioNode, at: number): void {
  const length = Math.floor(ctx.sampleRate * 0.08);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic noise — the same knock on every surface, no Math.random.
  let seed = 0x2f6e2b1;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1900;
  filter.Q.value = 0.9;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.9, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  source.start(at);
  source.stop(at + 0.1);
}

/** Schedules one cue on `ctx` into `out`, starting at `at` (context seconds). */
export function scheduleCue(
  ctx: BaseAudioContext,
  out: AudioNode,
  cue: SoundCue,
  at: number,
): void {
  switch (cue) {
    case "opening":
      // Two soft notes, a fifth apart: the lot is on the block.
      tone(ctx, out, { type: "sine", freq: 659.26, at, dur: 0.14, peak: 0.18 });
      tone(ctx, out, { type: "sine", freq: 987.77, at: at + 0.12, dur: 0.22, peak: 0.16 });
      return;
    case "bid":
      // One tick. Short enough that twenty in a minute is a rhythm, not noise.
      tone(ctx, out, { type: "triangle", freq: 1320, at, dur: 0.05, peak: 0.14 });
      return;
    case "extension":
      // A rising sweep: the bid bought time.
      tone(ctx, out, { type: "sawtooth", freq: 320, at, dur: 0.32, peak: 0.08, glideTo: 880 });
      return;
    case "warning":
      // Two ticks at the threshold. Never a siren (doc 11: no manufactured panic).
      tone(ctx, out, { type: "sine", freq: 880, at, dur: 0.06, peak: 0.12 });
      tone(ctx, out, { type: "sine", freq: 880, at: at + 0.16, dur: 0.06, peak: 0.12 });
      return;
    case "sold":
      // The gavel: wood, then the weight of the strike, then a warm chord as
      // the gold stamp lands (doc 11 ceremony: 150–600ms is the stamp).
      knock(ctx, out, at);
      tone(ctx, out, { type: "sine", freq: 150, at, dur: 0.14, peak: 0.5, glideTo: 55 });
      tone(ctx, out, { type: "sine", freq: 220, at: at + 0.15, dur: 0.9, peak: 0.12 });
      tone(ctx, out, { type: "sine", freq: 277.18, at: at + 0.15, dur: 0.9, peak: 0.1 });
      tone(ctx, out, { type: "sine", freq: 329.63, at: at + 0.17, dur: 0.95, peak: 0.1 });
      return;
    case "complete":
      // A short rising figure: the night is done.
      tone(ctx, out, { type: "triangle", freq: 523.25, at, dur: 0.16, peak: 0.14 });
      tone(ctx, out, { type: "triangle", freq: 659.26, at: at + 0.12, dur: 0.16, peak: 0.14 });
      tone(ctx, out, { type: "triangle", freq: 783.99, at: at + 0.24, dur: 0.16, peak: 0.14 });
      tone(ctx, out, { type: "triangle", freq: 1046.5, at: at + 0.36, dur: 0.5, peak: 0.16 });
      return;
  }
}
