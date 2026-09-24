"use client";

import { formatAmount, paise, type MoneyUnit } from "@desiauction/core";

/**
 * THE ANIMATED POSTER.
 *
 * WHY IT IS BUILT THIS WAY. The founder asked for an animated version to share
 * on WhatsApp and Instagram. There were three ways to get one:
 *
 *  1. Render video on the server (ffmpeg / a headless browser). A new heavy
 *     dependency, minutes of CPU per poster, and a queue to build around it.
 *  2. Re-draw the poster a second time in canvas and animate THAT. It needs a
 *     second implementation of every layout — and a preview that can disagree
 *     with the PNG people download is worse than no preview at all.
 *  3. Render the poster ONCE, in bands, and animate the bands. That is this.
 *
 * The route draws the same poster once per motion band into one tall sprite
 * (`renderSpriteBands` in `poster-card.tsx`, stitched by `posterResponse`),
 * and this module composites the bands
 * back together over time. The last frame is the poster, pixel for pixel,
 * because it IS the poster; there is no second renderer to drift.
 *
 * Nothing here knows the layout. Each tile in the `items` band is found by its
 * own opaque region in the sprite, so faces slide in one by one whatever grid
 * the layout chose — and a new poster kind gets its animation for free.
 *
 * LIMITS, stated so nobody rediscovers them: recording is real time (a six
 * second film takes six seconds), `requestAnimationFrame` stops in a hidden
 * tab so the tab must stay visible while it records, and the container format
 * is whatever the browser's MediaRecorder offers — MP4 on Safari and recent
 * Chrome, WebM elsewhere, which WhatsApp and Instagram re-encode anyway.
 */

export interface MotionFacts {
  readonly layers: readonly string[];
  readonly height: number;
  /** Integer paise — the number the price band counts up to. */
  readonly pricePaise?: number;
}

export interface Sprite {
  readonly bitmap: ImageBitmap;
  readonly facts: MotionFacts;
  readonly width: number;
  readonly height: number;
}

/** Fetch the layered sprite and the facts the picture cannot carry. */
export async function loadSprite(url: string, signal?: AbortSignal): Promise<Sprite> {
  const response = await fetch(url, signal === undefined ? {} : { signal });
  if (!response.ok) {
    throw new Error(`Poster ${String(response.status)}`);
  }
  const header = response.headers.get("x-poster-motion");
  const facts = (
    header === null ? { layers: ["base"], height: 0 } : JSON.parse(header)
  ) as MotionFacts;
  const bitmap = await createImageBitmap(await response.blob());
  const height = facts.height > 0 ? facts.height : bitmap.height;
  return { bitmap, facts, width: bitmap.width, height };
}

// --- Taking the sprite apart ------------------------------------------------

interface Band {
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
  /** Opaque regions: one per tile for `items`, one for everything else. */
  readonly parts: readonly Rect[];
  readonly ink: string | null;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Scene {
  readonly width: number;
  readonly height: number;
  readonly bands: readonly Band[];
  readonly ground: string;
  readonly pricePaise: number | null;
  /** The season's unit — the count-up reads "₹…" or "… pts" like the band it lands on. */
  readonly unit: MoneyUnit;
  readonly duration: number;
}

/** Everything opaque in a band, as ONE box. */
function boundsOf(data: Uint8ClampedArray, w: number, h: number, scale: number): Rect | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if ((data[(y * w + x) * 4 + 3] ?? 0) > 16) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return maxX < 0
    ? null
    : {
        x: minX * scale,
        y: minY * scale,
        w: (maxX - minX + 1) * scale,
        h: (maxY - minY + 1) * scale,
      };
}

/**
 * The tiles in a band, found by their own pixels.
 *
 * A coarse alpha mask is flood-filled into connected regions: each face card,
 * each ranked row and each squad panel is one region because the layout puts a
 * gap between them. The mask is dilated by one cell first so the letters of a
 * name join the card they sit under instead of animating in one glyph at a time.
 */
function regionsOf(canvas: HTMLCanvasElement, scale: number): Rect[] {
  const w = Math.max(1, Math.floor(canvas.width / scale));
  const h = Math.max(1, Math.floor(canvas.height / scale));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (ctx === null) {
    return [];
  }
  ctx.drawImage(canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    if ((data[i * 4 + 3] ?? 0) > 16) {
      mask[i] = 1;
    }
  }
  // Dilate by one cell: glyphs join their card, cards stay apart.
  const grown = new Uint8Array(mask);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x] !== 1) {
        continue;
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
            grown[ny * w + nx] = 1;
          }
        }
      }
    }
  }
  const seen = new Uint8Array(w * h);
  const out: Rect[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (grown[start] !== 1 || seen[start] === 1) {
      continue;
    }
    const stack = [start];
    seen[start] = 1;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      const x = index % w;
      const y = (index - x) / w;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && grown[next] === 1 && seen[next] === 0) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    out.push({
      x: minX * scale,
      y: minY * scale,
      w: (maxX - minX + 1) * scale,
      h: (maxY - minY + 1) * scale,
    });
  }
  // Reading order, and never so many that the stagger outlasts the film.
  return out
    .filter((rect) => rect.w > scale * 3 && rect.h > scale * 3)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 40);
}

/** The strongest colour in a band — what the counting price is drawn in. */
function inkOf(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) {
    return null;
  }
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) > 230) {
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
      n += 1;
    }
  }
  return n === 0
    ? null
    : `rgb(${String(Math.round(r / n))}, ${String(Math.round(g / n))}, ${String(Math.round(b / n))})`;
}

const STAGGER = 0.07;
const ITEM_IN = 0.42;

/** When each band starts and how long it runs, in seconds. */
function timing(name: string, index: number, items: number): { start: number; length: number } {
  if (name === "base") {
    return { start: 0, length: 0.55 };
  }
  if (name === "hero") {
    return { start: 0.32, length: 0.6 };
  }
  if (name === "items") {
    return { start: 0.62, length: ITEM_IN + STAGGER * Math.max(0, items - 1) };
  }
  if (name === "stamp") {
    return { start: 0.95, length: 0.5 };
  }
  if (name === "price") {
    return { start: 1.35, length: 1.15 };
  }
  return { start: 0.4 + index * 0.3, length: 0.5 };
}

export function buildScene(sprite: Sprite, unit: MoneyUnit): Scene {
  const { width, height, facts } = sprite;
  const bands: Band[] = facts.layers.map((name, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx?.drawImage(sprite.bitmap, 0, index * height, width, height, 0, 0, width, height);
    const small = document.createElement("canvas");
    const scale = 8;
    small.width = Math.floor(width / scale);
    small.height = Math.floor(height / scale);
    const smallCtx = small.getContext("2d", { willReadFrequently: true });
    smallCtx?.drawImage(canvas, 0, 0, small.width, small.height);
    const data = smallCtx?.getImageData(0, 0, small.width, small.height).data;
    const whole = data === undefined ? null : boundsOf(data, small.width, small.height, scale);
    return {
      name,
      canvas,
      parts: name === "items" ? regionsOf(canvas, scale) : whole === null ? [] : [whole],
      ink: name === "price" ? inkOf(canvas) : null,
    };
  });
  const items = bands.find((band) => band.name === "items")?.parts.length ?? 0;
  const last = bands.reduce((end, band, index) => {
    const { start, length } = timing(band.name, index, items);
    return Math.max(end, start + length);
  }, 0);
  const ground = groundColour(bands[0]?.canvas);
  return {
    width,
    height,
    bands,
    ground,
    pricePaise: facts.pricePaise ?? null,
    unit,
    // A beat to look at the finished poster before the loop (or the file) ends.
    duration: last + 1.4,
  };
}

function groundColour(canvas: HTMLCanvasElement | undefined): string {
  const ctx = canvas?.getContext("2d", { willReadFrequently: true });
  const pixel = ctx?.getImageData(2, 2, 1, 1).data;
  return pixel === undefined
    ? "#0B1018"
    : `rgb(${String(pixel[0])}, ${String(pixel[1])}, ${String(pixel[2])})`;
}

// --- Drawing ----------------------------------------------------------------

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Overshoot and settle — the gavel landing, not a fade. */
function easeBack(t: number): number {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function progress(now: number, start: number, length: number): number {
  return Math.max(0, Math.min(1, (now - start) / length));
}

let countFont: Promise<void> | null = null;

/**
 * The poster's own figure face — the v3 price is Archivo SemiCondensed — so the
 * counting number crossfades into the rendered one without changing font.
 */
export async function loadCountFont(): Promise<void> {
  countFont ??= (async () => {
    try {
      const face = new FontFace("PosterCount", "url(/fonts/poster/archivo-semicondensed-700.woff)");
      await face.load();
      document.fonts.add(face);
    } catch {
      // A system face counts just as high.
    }
  })();
  return countFont;
}

/**
 * One frame of the film.
 *
 * Every band is drawn from the SAME sprite the poster came from, so the final
 * frame is the poster exactly. Only the price is ever drawn by this module,
 * and only while it is still counting — it crossfades into the rendered band
 * before the film ends.
 */
export function drawFrame(target: CanvasRenderingContext2D, scene: Scene, now: number): void {
  const { width, height } = scene;
  target.save();
  target.clearRect(0, 0, width, height);
  target.fillStyle = scene.ground;
  target.fillRect(0, 0, width, height);

  const items = scene.bands.find((band) => band.name === "items")?.parts.length ?? 0;
  scene.bands.forEach((band, index) => {
    const { start, length } = timing(band.name, index, items);
    if (now < start) {
      return;
    }
    if (band.name === "base") {
      const t = easeOut(progress(now, start, length));
      target.save();
      target.globalAlpha = t;
      const scale = 1 + 0.03 * (1 - t);
      target.translate(width / 2, height / 2);
      target.scale(scale, scale);
      target.drawImage(band.canvas, -width / 2, -height / 2);
      target.restore();
      return;
    }
    if (band.name === "hero") {
      const t = easeOut(progress(now, start, length));
      target.save();
      target.globalAlpha = t;
      target.translate(0, 40 * (1 - t));
      target.drawImage(band.canvas, 0, 0);
      target.restore();
      return;
    }
    if (band.name === "items") {
      band.parts.forEach((rect, order) => {
        const t = easeOut(progress(now, start + order * STAGGER, ITEM_IN));
        if (t <= 0) {
          return;
        }
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const scale = 0.92 + 0.08 * t;
        target.save();
        target.globalAlpha = t;
        target.translate(cx, cy + 34 * (1 - t));
        target.scale(scale, scale);
        target.drawImage(
          band.canvas,
          rect.x,
          rect.y,
          rect.w,
          rect.h,
          -rect.w / 2,
          -rect.h / 2,
          rect.w,
          rect.h,
        );
        target.restore();
      });
      return;
    }
    if (band.name === "stamp") {
      const raw = progress(now, start, length);
      const t = easeBack(raw);
      const rect = band.parts[0];
      target.save();
      target.globalAlpha = Math.min(1, raw * 2.2);
      if (rect !== undefined) {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const scale = 2.1 - 1.1 * t;
        target.translate(cx, cy);
        target.rotate(((-9 + 9 * t) * Math.PI) / 180);
        target.scale(scale, scale);
        target.translate(-cx, -cy);
      }
      target.drawImage(band.canvas, 0, 0);
      target.restore();
      // The hammer's flash, on the frame it lands.
      const flash = 1 - progress(now, start + length * 0.75, 0.3);
      if (flash > 0 && raw > 0.7) {
        target.save();
        target.globalAlpha = 0.18 * flash;
        target.fillStyle = "#FFFFFF";
        target.fillRect(0, 0, width, height);
        target.restore();
      }
      return;
    }
    if (band.name === "price") {
      const rect = band.parts[0];
      const t = progress(now, start, length);
      // The last fifth is a crossfade into the rendered band, so the film ends
      // on the poster and not on an impression of it.
      const settle = progress(now, start + length * 0.8, length * 0.2);
      if (scene.pricePaise !== null && rect !== undefined && settle < 1) {
        /*
         * Whole RUPEES (or points) on the way up. A fraction of the target is a number of
         * paise, and `formatAmount` prints those honestly — so the counter
         * spent a second reading "₹59,854.56", which is not a price anybody
         * ever bid. The final frame is the exact stored value either way,
         * because the rendered band takes over before the film ends.
         */
        const raw = scene.pricePaise * easeOut(Math.min(1, t / 0.85));
        const value = Math.min(scene.pricePaise, Math.round(raw / 100) * 100);
        const size = Math.round(rect.h / 0.74);
        target.save();
        target.globalAlpha = 1 - settle;
        target.fillStyle = band.ink ?? "#FFFFFF";
        target.font = `700 ${String(size)}px PosterCount, sans-serif`;
        target.textAlign = "right";
        target.textBaseline = "alphabetic";
        target.fillText(
          formatAmount(paise(value), scene.unit),
          rect.x + rect.w,
          rect.y + rect.h * 0.96,
        );
        target.restore();
      }
      target.save();
      target.globalAlpha = scene.pricePaise === null ? easeOut(t) : settle;
      target.drawImage(band.canvas, 0, 0);
      target.restore();
      return;
    }
    target.drawImage(band.canvas, 0, 0);
  });

  // A slow gold sweep across the finished poster — the one flourish that is not
  // in the PNG, and the reason the animated version feels like a film.
  const sheenStart = scene.duration - 1.2;
  const sheen = progress(now, sheenStart, 0.9);
  if (sheen > 0 && sheen < 1) {
    const x = -width + sheen * width * 2.2;
    const gradient = target.createLinearGradient(x, 0, x + width * 0.55, height);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.5, "rgba(255, 233, 176, 0.14)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    target.save();
    target.globalCompositeOperation = "lighter";
    target.fillStyle = gradient;
    target.fillRect(0, 0, width, height);
    target.restore();
  }
  target.restore();
}

// --- Playing and recording --------------------------------------------------

export interface Player {
  stop: () => void;
}

/** Play the film on a canvas, looping, until `stop()`. */
export function playScene(canvas: HTMLCanvasElement, scene: Scene, loop = true): Player {
  const ctx = canvas.getContext("2d");
  let raf = 0;
  let stopped = false;
  const began = performance.now();
  const tick = (now: number) => {
    if (stopped || ctx === null) {
      return;
    }
    const elapsed = (now - began) / 1000;
    const t = loop ? elapsed % scene.duration : Math.min(elapsed, scene.duration);
    drawFrame(ctx, scene, t);
    if (loop || elapsed < scene.duration) {
      raf = requestAnimationFrame(tick);
    }
  };
  raf = requestAnimationFrame(tick);
  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}

/** MP4 where the browser can, WebM where it cannot. Both upload fine. */
export function pickRecordingType(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  const candidates: [string, string][] = [
    ["video/mp4;codecs=avc1.42E01E", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mimeType, extension] of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType, extension };
    }
  }
  return null;
}

/**
 * Record the film to a file.
 *
 * Real time, by necessity: `captureStream` samples the canvas as it is drawn,
 * so a six-second poster takes six seconds and the tab has to stay visible
 * (`requestAnimationFrame` is throttled to nothing in a hidden one). The studio
 * says so before it starts rather than leaving somebody watching a dead button.
 */
export async function recordScene(
  scene: Scene,
  onProgress?: (fraction: number) => void,
): Promise<{ blob: Blob; extension: string }> {
  const type = pickRecordingType();
  if (type === null) {
    throw new Error("This browser cannot record video.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("This browser cannot record video.");
  }
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, {
    mimeType: type.mimeType,
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      resolve();
    };
  });
  // One frame before the first capture, so the film never opens on a blank
  // canvas while the encoder is warming up.
  drawFrame(ctx, scene, 0);
  recorder.start();
  const began = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const elapsed = (now - began) / 1000;
      drawFrame(ctx, scene, Math.min(elapsed, scene.duration));
      onProgress?.(Math.min(1, elapsed / scene.duration));
      if (elapsed >= scene.duration) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  await done;
  stream.getTracks().forEach((track) => {
    track.stop();
  });
  return { blob: new Blob(chunks, { type: type.mimeType }), extension: type.extension };
}

// --- MP4, frame by frame ----------------------------------------------------

/**
 * THE STATUS FILE: H.264 IN MP4, ENCODED FRAME BY FRAME.
 *
 * `recordScene` samples a canvas in real time through MediaRecorder, which
 * gives whatever container the browser prefers — WebM on Firefox and older
 * Chrome, which WhatsApp on an iPhone will not take as a Status — takes the
 * full six seconds, stalls in a hidden tab and drops frames under load.
 *
 * WebCodecs removes all four: each frame is drawn by `drawFrame` at an exact
 * time, handed to the browser's own H.264 encoder, and packed into an MP4 with
 * `mp4-muxer` (MIT, loaded only when a film is made). Faster than real time,
 * frame-exact, visible or not, and the one format every phone plays.
 *
 * Level 4.0 fits a 1080×1920 Status (8,160 macroblocks against 8,192). High
 * profile first, then Main, then Baseline — whichever this browser encodes.
 */
const FPS = 30;
const H264_CODECS = ["avc1.640028", "avc1.4d0028", "avc1.42e028"] as const;

export async function h264ConfigFor(
  width: number,
  height: number,
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    return null;
  }
  for (const codec of H264_CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: 8_000_000,
      framerate: FPS,
      avc: { format: "avc" },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported === true) {
        return config;
      }
    } catch {
      // A codec string this browser does not know — try the next profile.
    }
  }
  return null;
}

/** How this browser will make the film: an MP4 encode, a live recording, or neither. */
export async function videoExportMode(
  width: number,
  height: number,
): Promise<"mp4" | "recorder" | null> {
  if ((await h264ConfigFor(width, height)) !== null) {
    return "mp4";
  }
  return pickRecordingType() === null ? null : "recorder";
}

/** Encode the film as H.264 MP4, frame by frame. Throws when the browser cannot. */
export async function encodeSceneMp4(
  scene: Scene,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const config = await h264ConfigFor(scene.width, scene.height);
  if (config === null) {
    throw new Error("This browser cannot encode H.264.");
  }
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: scene.width, height: scene.height, frameRate: FPS },
    // The index at the front, so a phone starts playing before the file ends.
    fastStart: "in-memory",
  });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (error) => {
      failure = error;
    },
  });
  encoder.configure(config);

  const canvas = document.createElement("canvas");
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("This browser cannot draw the film.");
  }
  // The film, then one still second on the finished poster: a Status that
  // ends the instant the price lands reads as cut off.
  const frames = Math.ceil((scene.duration + 1) * FPS);
  const step = 1_000_000 / FPS;
  for (let index = 0; index < frames; index += 1) {
    if (failure !== null) {
      break;
    }
    drawFrame(ctx, scene, Math.min(index / FPS, scene.duration));
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(index * step),
      duration: Math.round(step),
    });
    // A keyframe every two seconds keeps a scrubbed Status sharp.
    encoder.encode(frame, { keyFrame: index % (FPS * 2) === 0 });
    frame.close();
    // Let the encoder drain rather than queue a whole film in memory.
    while (encoder.encodeQueueSize > 8) {
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    onProgress?.((index + 1) / frames);
  }
  await encoder.flush();
  encoder.close();
  if (failure !== null) {
    throw failure instanceof Error ? failure : new Error("The encoder stopped.");
  }
  muxer.finalize();
  return new Blob([target.buffer], { type: "video/mp4" });
}

/**
 * The film as a file: MP4 frame by frame where the browser can encode H.264,
 * else the real-time recording `recordScene` has always made.
 */
export async function exportSceneVideo(
  scene: Scene,
  onProgress?: (fraction: number) => void,
): Promise<{ blob: Blob; extension: string }> {
  if ((await h264ConfigFor(scene.width, scene.height)) !== null) {
    return { blob: await encodeSceneMp4(scene, onProgress), extension: "mp4" };
  }
  return recordScene(scene, onProgress);
}
