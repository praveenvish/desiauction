import { performance } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

/** Each viewer owns its validator and waits after a response, just like LivePoll. */
export async function liveLoad(
  target,
  {
    viewers = 500,
    durationSeconds = 60,
    intervalMs = 2000,
    staggerMs = 2000,
    timeoutMs = 10000,
  } = {},
) {
  const url = new URL(target);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an HTTP target");
  for (const value of [viewers, durationSeconds, intervalMs, staggerMs, timeoutMs])
    if (!Number.isFinite(value) || value <= 0) throw new Error("Load settings must be positive");
  if (!Number.isInteger(viewers)) throw new Error("Viewer count must be an integer");
  const started = performance.now();
  const deadline = started + durationSeconds * 1000;
  const statuses = { 200: 0, 304: 0, other: 0 };
  const otherStatuses = {};
  const latencies = [];
  const sequences = new Set();
  let attempts = 0,
    failures = 0,
    timeouts = 0,
    missingValidators = 0,
    nonLiveResponses = 0;
  await Promise.all(
    Array.from({ length: viewers }, async (_, index) => {
      await wait((index * staggerMs) / viewers);
      let validator;
      while (performance.now() < deadline) {
        attempts += 1;
        const before = performance.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: validator ? { "If-None-Match": validator } : {},
            cache: "no-store",
            redirect: "error",
          });
          if (response.status === 200 || response.status === 304) {
            statuses[response.status] += 1;
            const nextValidator = response.headers.get("etag");
            if (!nextValidator) missingValidators += 1;
            else validator = nextValidator;
            if (response.status === 200) {
              const body = await response.json();
              const state = body.live ?? body;
              if (state.phase !== "live" || !Number.isSafeInteger(state.seq)) nonLiveResponses += 1;
              else sequences.add(state.seq);
            }
          } else {
            statuses.other += 1;
            otherStatuses[response.status] = (otherStatuses[response.status] ?? 0) + 1;
            await response.arrayBuffer();
          }
        } catch {
          failures += 1;
          if (controller.signal.aborted) timeouts += 1;
        } finally {
          clearTimeout(timer);
          latencies.push(performance.now() - before);
        }
        const remaining = deadline - performance.now();
        if (remaining > 0) await wait(Math.min(intervalMs, remaining));
      }
    }),
  );
  const elapsedSeconds = (performance.now() - started) / 1000;
  const p50Ms = percentile(latencies, 0.5),
    p95Ms = percentile(latencies, 0.95);
  const ratio304 = attempts ? statuses[304] / attempts : 0;
  const passed =
    attempts > 0 &&
    p95Ms !== null &&
    p95Ms < 300 &&
    ratio304 > 0.8 &&
    statuses.other === 0 &&
    failures === 0 &&
    missingValidators === 0 &&
    nonLiveResponses === 0 &&
    sequences.size === 1;
  return {
    kind: "steady-score polling; no simultaneous delivery/append load",
    target: `${url.origin}${url.pathname}`,
    viewers,
    durationSeconds,
    elapsedSeconds,
    intervalMs,
    staggerMs,
    timeoutMs,
    attempts,
    statuses,
    otherStatuses,
    failures,
    timeouts,
    missingValidators,
    nonLiveResponses,
    eligibleSequences: [...sequences],
    requestsPerSecond: attempts / elapsedSeconds,
    p50Ms,
    p95Ms,
    ratio304,
    passed,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const target = args.shift();
    if (!target)
      throw new Error("Usage: node scripts/live-load.mjs URL [--viewers N] [--duration-seconds N]");
    const settings = {};
    while (args.length) {
      const flag = args.shift(),
        value = Number(args.shift());
      if (flag === "--viewers") settings.viewers = value;
      else if (flag === "--duration-seconds") settings.durationSeconds = value;
      else throw new Error(`Unknown option: ${flag}`);
    }
    const result = await liveLoad(target, settings);
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Load run failed");
    process.exitCode = 1;
  }
}
