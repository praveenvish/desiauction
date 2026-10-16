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
    // null: report latency without gating on it (a shared CI runner hosts the
    // server, the browser and all 500 viewers; its numbers measure the runner).
    p95BudgetMs = 300,
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
    (p95BudgetMs === null || p95Ms < p95BudgetMs) &&
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
    p95BudgetMs,
    ratio304,
    passed,
  };
}

/**
 * apps/live under room load (F05): `rooms` fixtures × `perRoom` sockets, each
 * subscribing like the browser does. Measures open → first live frame, and
 * that every socket stays open and keeps receiving the same room's releases.
 */
export async function socketLoad(
  target,
  {
    fixtures,
    perRoom = 300,
    gate = {},
    origin,
    durationSeconds = 30,
    staggerMs = 2000,
    timeoutMs = 10000,
    // One load host is one client to the per-client cap (20). Behind a trusted
    // proxy hop (TRUSTED_PROXY_COUNT >= 1) each socket can name its own client.
    distinctClients = false,
  } = {},
) {
  const url = new URL(target);
  if (!["ws:", "wss:"].includes(url.protocol)) throw new Error("Use a WebSocket target");
  if (!Array.isArray(fixtures) || !fixtures.length) throw new Error("Name at least one fixture");
  if (!origin) throw new Error("An allowed Origin is required");
  for (const value of [perRoom, durationSeconds, staggerMs, timeoutMs])
    if (!Number.isFinite(value) || value <= 0) throw new Error("Load settings must be positive");
  const sockets = fixtures.length * perRoom;
  const started = performance.now();
  const firstFrame = [];
  const closes = {};
  let opened = 0,
    framed = 0,
    frames = 0,
    failures = 0;
  await Promise.all(
    fixtures.flatMap((fixtureId, room) =>
      Array.from({ length: perRoom }, async (_, index) => {
        await wait(((room * perRoom + index) * staggerMs) / sockets);
        const before = performance.now();
        await new Promise((resolve) => {
          let first = true;
          let settled = false;
          const n = room * perRoom + index;
          const ws = new WebSocket(url, {
            headers: {
              origin,
              ...(distinctClients
                ? {
                    "x-forwarded-for": `10.${String(n >> 16)}.${String((n >> 8) & 255)}.${String(n & 255)}`,
                  }
                : {}),
            },
          });
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(firstTimer);
            clearTimeout(endTimer);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
              ws.close();
            resolve();
          };
          const firstTimer = setTimeout(() => {
            if (first) {
              failures += 1;
              finish();
            }
          }, timeoutMs);
          const endTimer = setTimeout(
            finish,
            Math.max(0, started + durationSeconds * 1000 - before),
          );
          ws.onopen = () => {
            opened += 1;
            ws.send(JSON.stringify({ t: "sub", fixtureId, gate }));
          };
          ws.onmessage = (message) => {
            frames += 1;
            let body;
            try {
              body = JSON.parse(String(message.data));
            } catch {
              body = null;
            }
            if (body?.t !== "live") return;
            if (first) {
              first = false;
              framed += 1;
              firstFrame.push(performance.now() - before);
            }
          };
          ws.onerror = () => {};
          ws.onclose = (event) => {
            if (!settled) {
              closes[event.code] = (closes[event.code] ?? 0) + 1;
              if (first) failures += 1;
              finish();
            }
          };
        });
      }),
    ),
  );
  const p50Ms = percentile(firstFrame, 0.5),
    p95Ms = percentile(firstFrame, 0.95);
  return {
    kind: "apps/live sockets: rooms × sockets, open → first live frame",
    target: `${url.origin}${url.pathname}`,
    rooms: fixtures.length,
    perRoom,
    sockets,
    durationSeconds,
    opened,
    framed,
    frames,
    failures,
    earlyCloses: closes,
    p50Ms,
    p95Ms,
    passed:
      opened === sockets &&
      framed === sockets &&
      failures === 0 &&
      Object.keys(closes).length === 0 &&
      p95Ms !== null &&
      p95Ms < 1000,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const target = args.shift();
    if (!target)
      throw new Error(
        "Usage: node scripts/live-load.mjs URL [--viewers N] [--duration-seconds N]\n" +
          "       node scripts/live-load.mjs ws://HOST/live/ws --fixtures A,B --per-room N --slug S --origin O",
      );
    const settings = {};
    while (args.length) {
      const flag = args.shift(),
        raw = args.shift() ?? "",
        value = Number(raw);
      if (flag === "--viewers") settings.viewers = value;
      else if (flag === "--duration-seconds") settings.durationSeconds = value;
      else if (flag === "--p95-budget-ms") settings.p95BudgetMs = raw === "none" ? null : value;
      else if (flag === "--per-room") settings.perRoom = value;
      else if (flag === "--fixtures") settings.fixtures = raw.split(",").filter(Boolean);
      else if (flag === "--slug") settings.gate = { s: raw };
      else if (flag === "--origin") settings.origin = raw;
      else if (flag === "--distinct-clients") {
        settings.distinctClients = true;
        if (raw) args.unshift(raw);
      } else throw new Error(`Unknown option: ${flag}`);
    }
    const result = /^wss?:/.test(target)
      ? await socketLoad(target, settings)
      : await liveLoad(target, settings);
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Load run failed");
    process.exitCode = 1;
  }
}
