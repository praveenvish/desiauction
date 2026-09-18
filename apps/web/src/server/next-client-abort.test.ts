/**
 * A CLIENT THAT HANGS UP IS NOT A CRASH (patches/next@15.5.25.patch).
 *
 * Our middleware runs on the Node runtime, so for every request with a body —
 * every server action — Next clones the body for it and then `finalize()`s the
 * request, and `replaceRequestBody` copies a PassThrough's `_events` over the
 * request's. That silently dropped the router's `req.on('error', noop)`. When
 * the browser then disconnected mid-response (it stops reading a server
 * action's redirect; a tab closes), Node destroyed the request with
 * "aborted"/ECONNRESET and nothing handled it: one uncaughtException per
 * abort, which Sentry records as FATAL — and after its first, Sentry's handler
 * stops reporting uncaught exceptions for the life of the process.
 *
 * This drives Next's own module the way the server does. It fails on an
 * unpatched Next; if an upgrade fixes the bug upstream it keeps passing.
 */
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Next ships this module as CJS only.
const { getCloneableBody } = require("next/dist/server/body-streams") as {
  getCloneableBody: (
    readable: NodeJS.ReadableStream,
    limit?: number,
  ) => { cloneBodyStream: () => NodeJS.ReadableStream; finalize: () => Promise<void> };
};

const uncaught: unknown[] = [];
const record = (error: unknown) => {
  uncaught.push(error);
};

afterEach(() => {
  process.removeListener("uncaughtException", record);
  uncaught.length = 0;
});

describe("Next's middleware body clone", () => {
  it("keeps the request's error handled after finalize, so a client abort stays quiet", async () => {
    // Stand-in for the IncomingMessage: the router guards it exactly like this.
    const request = new PassThrough();
    request.on("error", () => {});

    const body = getCloneableBody(request);
    const forMiddleware = body.cloneBodyStream();
    forMiddleware.resume();
    request.end("form-data");
    await new Promise((resolve) => setImmediate(resolve));
    await body.finalize();

    // Vitest installs its own uncaughtException handling; count ours only.
    process.prependListener("uncaughtException", record);
    let emittedUnhandled = false;
    try {
      request.emit("error", Object.assign(new Error("aborted"), { code: "ECONNRESET" }));
    } catch {
      // EventEmitter throws synchronously when "error" has no listener.
      emittedUnhandled = true;
    }
    expect(emittedUnhandled, "the request lost every error listener in finalize()").toBe(false);
    expect(request.listenerCount("error")).toBeGreaterThan(0);
    expect(uncaught).toEqual([]);
  });
});
