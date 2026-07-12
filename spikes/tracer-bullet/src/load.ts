// THROWAWAY load driver (IP-0_DESIGN §32). Pre-registered measurements:
//   M1 append->ack p99 <= 20ms engine-internal over 10k sequential commands
//   M2 replay of 10k events < 10s
//   M3 200 concurrent WS subscribers receive a published event p95 < 500ms (RC-5)
//   M4 client->ack RTT (observational, reported not gated)
import { WebSocket } from "ws";

import { env } from "./env.js";

const TARGET = env.TARGET_URL;
const AUCTION = `spike_${String(Date.now())}`;
const COMMANDS = 10_000;
const SUBSCRIBERS = 200;
const FANOUT_ROUNDS = 20;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return NaN;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? NaN;
}

function summarize(label: string, samples: number[]): { p50: number; p95: number; p99: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const stats = {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
  console.log(
    `${label}: n=${String(samples.length)} p50=${stats.p50.toFixed(2)}ms p95=${stats.p95.toFixed(2)}ms p99=${stats.p99.toFixed(2)}ms max=${(sorted[sorted.length - 1] ?? NaN).toFixed(2)}ms`,
  );
  return stats;
}

async function postCmd(amountPaise: number): Promise<{ internalMs: number; rttMs: number }> {
  const started = performance.now();
  const response = await fetch(`${TARGET}/cmd`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ auctionId: AUCTION, type: "bid", amountPaise }),
  });
  if (!response.ok) {
    throw new Error(`cmd failed: ${String(response.status)}`);
  }
  const body = (await response.json()) as { internalMs: number };
  return { internalMs: body.internalMs, rttMs: performance.now() - started };
}

async function m1AndM4(): Promise<void> {
  const internal: number[] = [];
  const rtt: number[] = [];
  for (let i = 1; i <= COMMANDS; i++) {
    const result = await postCmd(i * 100);
    internal.push(result.internalMs);
    rtt.push(result.rttMs);
    if (i % 2000 === 0) {
      console.log(`  ...${String(i)}/${String(COMMANDS)} commands`);
    }
  }
  const m1 = summarize("M1 append->ack (engine-internal)", internal);
  summarize("M4 client->ack RTT (observational)", rtt);
  console.log(
    `M1 VERDICT: p99=${m1.p99.toFixed(2)}ms target<=20ms -> ${m1.p99 <= 20 ? "PASS" : "FAIL"}`,
  );
}

async function m2(): Promise<void> {
  const response = await fetch(`${TARGET}/replay/${AUCTION}`);
  const body = (await response.json()) as { events: number; ms: number };
  console.log(`M2 replay: events=${String(body.events)} ms=${body.ms.toFixed(0)}`);
  console.log(
    `M2 VERDICT: ${body.ms.toFixed(0)}ms target<10000ms -> ${body.ms < 10_000 ? "PASS" : "FAIL"}`,
  );
}

async function m3(): Promise<void> {
  const wsUrl = `${TARGET.replace("http", "ws")}/sub?auction=${AUCTION}`;
  const sockets: WebSocket[] = [];
  const deliveries: number[] = [];
  await Promise.all(
    Array.from({ length: SUBSCRIBERS }, () => {
      const ws = new WebSocket(wsUrl);
      sockets.push(ws);
      ws.on("message", (data) => {
        const message = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : "") as {
          publishedAtMs: number;
        };
        deliveries.push(Date.now() - message.publishedAtMs);
      });
      return new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          resolve();
        });
        ws.on("error", reject);
      });
    }),
  );
  console.log(`  ${String(SUBSCRIBERS)} subscribers connected`);
  for (let round = 0; round < FANOUT_ROUNDS; round++) {
    await postCmd(10_000_000 + round);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (const ws of sockets) {
    ws.close();
  }
  const expected = SUBSCRIBERS * FANOUT_ROUNDS;
  const m3Stats = summarize("M3 fan-out delivery", deliveries);
  const received = deliveries.length;
  console.log(
    `M3 VERDICT: received=${String(received)}/${String(expected)} p95=${m3Stats.p95.toFixed(2)}ms target<500ms -> ${received === expected && m3Stats.p95 < 500 ? "PASS" : "FAIL"}`,
  );
}

console.log(`tracer-bullet load driver -> ${TARGET} auction=${AUCTION}`);
console.log(`M1/M4: ${String(COMMANDS)} sequential commands...`);
await m1AndM4();
console.log("M2: replay...");
await m2();
console.log(
  `M3: fan-out to ${String(SUBSCRIBERS)} subscribers x ${String(FANOUT_ROUNDS)} rounds...`,
);
await m3();
process.exit(0);
