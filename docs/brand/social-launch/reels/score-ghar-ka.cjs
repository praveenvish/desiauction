// score-ghar-ka.cjs — the original score for reel 02, synthesised here so we
// own every sample (no library track, nothing to be muted or claimed).
//
// A dhol-style bhangra groove (dagga + tilli + shaker, 3-3-2 chaal at 120 BPM)
// from the first frame, a harmonium-ish hook, a bell per bid that climbs in
// pitch with the price, a comic "wah-wah" for Beta's lost tie, a heartbeat and
// riser while Dadi waits, a big hit when she bids, gavel knocks on SOLD.
//
// makeScore({ beats, footLen, total, out }) — beats: [{ id, start, secs, sound }].

const fs = require("fs");

const SR = 48000;

function makeScore({ beats, footLen, total, out }) {
  const n = Math.ceil(total * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
  const add = (t0, len, fn, gain = 1, pan = 0) => {
    const i0 = Math.max(0, Math.round(t0 * SR));
    const m = Math.min(n - i0, Math.round(len * SR));
    const gl = gain * Math.min(1, 1 - pan);
    const gr = gain * Math.min(1, 1 + pan);
    for (let i = 0; i < m; i++) {
      const v = fn(i / SR);
      L[i0 + i] += v * gl;
      R[i0 + i] += v * gr;
    }
  };

  // --- instruments ---------------------------------------------------------
  const dagga = (t) => {
    const f = 55 + 70 * Math.exp(-t * 30);
    return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) + rnd() * 0.15 * Math.exp(-t * 80);
  };
  let hp = 0;
  const tilli = (t) => {
    const x = rnd();
    hp = 0.6 * hp + 0.4 * x; // crude high-pass via difference below
    return ((x - hp) * 0.9 + Math.sin(2 * Math.PI * 760 * t) * 0.5) * Math.exp(-t * 38);
  };
  const shaker = (t) => rnd() * Math.exp(-t * 90) * (t < 0.04 ? t / 0.04 : 1);
  const harmonium = (f) => (t) => {
    let v = 0;
    for (let k = 1; k <= 6; k++) v += Math.sin(2 * Math.PI * f * k * t + k) / k;
    const env = Math.min(1, t / 0.02) * Math.exp(-t * 3.2);
    return v * 0.35 * env * (1 + 0.04 * Math.sin(2 * Math.PI * 5.5 * t));
  };
  const bell = (f) => (t) =>
    (Math.sin(2 * Math.PI * f * t) +
      0.45 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 4) +
      0.2 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 8)) *
    Math.exp(-t * 2.6);
  const gavel = (t) =>
    (Math.sin(2 * Math.PI * 190 * t) * 0.8 + Math.sin(2 * Math.PI * 520 * t) * 0.3 + rnd() * 0.5 * Math.exp(-t * 200)) *
    Math.exp(-t * 28);
  const boom = (t) =>
    Math.sin(2 * Math.PI * (38 + 60 * Math.exp(-t * 12)) * t) * Math.exp(-t * 2.2) + rnd() * 0.6 * Math.exp(-t * 45);
  const heartbeat = (t) => Math.sin(2 * Math.PI * (48 + 20 * Math.exp(-t * 25)) * t) * Math.exp(-t * 14);
  const riser = (len) => {
    let y = 0;
    return (t) => {
      const p = t / len;
      const a = 0.02 + 0.5 * p * p; // the "filter" opens as it rises
      y += a * (rnd() - y);
      return y * p * p * 1.4 + Math.sin(2 * Math.PI * (200 + 900 * p * p) * t) * 0.12 * p;
    };
  };
  const whoosh = (t) => {
    const p = Math.min(1, t / 0.35);
    return rnd() * Math.sin(Math.PI * p) * 0.6;
  };
  // Descending "wah-wah": three short falls and a long wobble.
  const wah = (t) => {
    const notes = [
      [0, 0.22, 196],
      [0.24, 0.22, 185],
      [0.48, 0.22, 175],
      [0.72, 0.9, 165],
    ];
    let v = 0;
    for (const [s, d, f] of notes) {
      if (t >= s && t < s + d) {
        const u = t - s;
        const vib = s > 0.7 ? 6 * Math.sin(2 * Math.PI * 6 * u) : 0;
        const ph = 2 * Math.PI * (f + vib - (s > 0.7 ? 18 * u : 0)) * u;
        const tri = (2 / Math.PI) * Math.asin(Math.sin(ph));
        v += tri * Math.min(1, u / 0.015) * Math.min(1, (s + d - t) / 0.05) * (1 - 0.6 * Math.min(1, u / d));
      }
    }
    return v * 0.55;
  };

  // --- arrangement ---------------------------------------------------------
  // Cues are found by what a beat DOES, so any reel can reuse the score.
  const bySound = (sound) => beats.find((b) => b.sound === sound);
  const quietFrom = bySound("wait")?.start ?? Infinity; // the band stops
  const backAt = bySound("dadi")?.start ?? Infinity; // everything comes back
  const STEP = 0.125; // 16ths at 120 BPM
  const BASS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const TREB = [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1];
  const strikeAt = footLen;
  const level = (t) => {
    if (t >= quietFrom && t < backAt) return 0;
    if (t >= strikeAt && t < strikeAt + 2) return 0.35; // under the strike's own sting
    if (t >= strikeAt + 2) return 0.7 * Math.max(0, Math.min(1, (total - t) / 0.9));
    const wahBeat = bySound("wah");
    if (wahBeat && t >= wahBeat.start && t < wahBeat.start + wahBeat.secs) return 0.45; // let the wah-wah land
    return 1;
  };
  for (let k = 0; k * STEP < total; k++) {
    const t = k * STEP;
    const g = level(t);
    if (g === 0) continue;
    const s = k % 16;
    const big = t >= backAt ? 1.25 : 1; // after Dadi: harder
    if (BASS[s]) add(t, 0.5, dagga, 0.55 * g * big);
    if (TREB[s] || (t >= backAt && s % 2 === 1)) add(t, 0.15, tilli, 0.22 * g * big, 0.25);
    if (s % 2 === 0) add(t, 0.06, shaker, 0.05 * g, -0.35);
  }
  // The hook: C minor pentatonic, two bars, an octave up after Dadi.
  const HOOK = [261.6, 311.1, 349.2, 392.0, 466.2, 392.0, 349.2, 311.1];
  for (let k = 0; k * 0.5 < total; k++) {
    const t = k * 0.5;
    const g = level(t);
    if (g === 0 || t >= strikeAt) continue;
    const f = HOOK[k % 8] * (t >= backAt ? 2 : 1);
    add(t, 0.6, harmonium(f), 0.12 * g, 0.1);
  }

  // --- hits on the picture -------------------------------------------------
  add(0, 1.2, boom, 0.45); // a hit on frame one: stop the scroll
  for (const b of beats.filter((x) => x.sound === "gavel")) add(b.start + 0.1, 0.3, gavel, 0.5);
  const BELLS = [523.3, 587.3, 659.3, 698.5, 784.0, 880.0, 987.8]; // climbs with the price
  let bellIx = 0;
  for (const b of beats) {
    const hit = b.start + 0.22;
    if (b.sound === "bid") add(hit, 1.6, bell(BELLS[bellIx++]), 0.32);
    if (b.sound === "tie") {
      add(hit - 0.08, 0.4, whoosh, 0.35);
      add(hit, 1.6, bell(BELLS[bellIx]), 0.3, -0.5);
      add(hit + 0.07, 1.6, bell(BELLS[bellIx]), 0.3, 0.5);
      bellIx++;
    }
    if (b.sound === "wah") add(b.start + 0.25, 1.7, wah, 0.6);
    if (b.sound === "wait") {
      for (let h = 0; h < 3; h++) {
        add(b.start + 0.15 + h * 0.55, 0.4, heartbeat, 0.7);
        add(b.start + 0.33 + h * 0.55, 0.4, heartbeat, 0.45);
      }
      add(b.start, b.secs - 0.12, riser(b.secs - 0.12), 0.35);
    }
    if (b.sound === "dadi") {
      add(b.start, 2.0, boom, 0.9);
      add(b.start + 0.22, 2.2, bell(BELLS[BELLS.length - 1] * 2), 0.3);
    }
    if (b.sound === "sold") {
      add(b.start + 0.05, 0.3, gavel, 0.7);
      add(b.start + 0.3, 0.3, gavel, 0.7);
      add(b.start + 0.55, 0.4, gavel, 0.85);
    }
  }
  add(total - 0.55, 0.6, dagga, 0.7); // the last word

  // --- master: soft clip, 16-bit WAV -------------------------------------------
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.tanh(L[i] * 0.9) * 32000), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.tanh(R[i] * 0.9) * 32000), 46 + i * 4);
  }
  fs.writeFileSync(out, buf);
}

module.exports = { makeScore };
