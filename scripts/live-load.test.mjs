import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { liveLoad, percentile } from "./live-load.mjs";

async function serverRun(handler, run) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await run(`http://127.0.0.1:${server.address().port}/live?proof=valid`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("independent viewers each fetch a live snapshot before using their own ETag", async () => {
  const result = await serverRun(
    (request, response) => {
      assert.equal(request.url, "/live?proof=valid");
      response.setHeader("ETag", '"15"');
      if (request.headers["if-none-match"] === '"15"') {
        response.writeHead(304).end();
      } else {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ seq: 15, phase: "live" }));
      }
    },
    (url) => liveLoad(url, { viewers: 3, durationSeconds: 0.4, intervalMs: 20, staggerMs: 20 }),
  );
  assert.equal(result.statuses[200], 3);
  assert.ok(result.statuses[304] > 20);
  assert.equal(result.attempts, result.statuses[200] + result.statuses[304]);
  assert.equal(result.ratio304, result.statuses[304] / result.attempts);
  assert.equal(result.failures, 0);
  assert.deepEqual(result.eligibleSequences, [15]);
  assert.equal(result.passed, true);
  assert.ok(result.elapsedSeconds >= 0.4);
});

test("HTTP errors stay in the all-attempt denominator and fail the load gate", async () => {
  const result = await serverRun(
    (_request, response) => response.writeHead(500).end("unavailable"),
    (url) => liveLoad(url, { viewers: 2, durationSeconds: 0.08, intervalMs: 10, staggerMs: 1 }),
  );
  assert.ok(result.attempts > 0);
  assert.equal(result.statuses.other, result.attempts);
  assert.equal(result.otherStatuses[500], result.attempts);
  assert.equal(result.ratio304, 0);
  assert.equal(result.passed, false);
});

test("timeouts are counted with their elapsed latency rather than discarded", async () => {
  const result = await serverRun(
    () => {},
    (url) =>
      liveLoad(url, {
        viewers: 2,
        durationSeconds: 0.08,
        intervalMs: 10,
        staggerMs: 1,
        timeoutMs: 20,
      }),
  );
  assert.ok(result.attempts > 0);
  assert.equal(result.timeouts, result.attempts);
  assert.equal(result.failures, result.attempts);
  assert.ok(result.p50Ms >= 15);
  assert.equal(result.ratio304, 0);
  assert.equal(result.passed, false);
});

test("percentiles use nearest rank including slow-tail samples", () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([2, 1, 500], 0.95), 500);
});
