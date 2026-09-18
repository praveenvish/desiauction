import { describe, expect, it } from "vitest";

import { readCapped } from "./read-capped";

function chunked(parts: string[]): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
  // No content-length: the case a header check alone never catches.
  return new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
}

describe("readCapped", () => {
  it("returns a body under the cap", async () => {
    expect(await readCapped(chunked(["ab", "cd"]), 10)).toBe("abcd");
  });

  it("refuses a chunked body that grows past the cap, with no length declared", async () => {
    expect(await readCapped(chunked(["x".repeat(8), "y".repeat(8)]), 10)).toBeNull();
  });

  it("refuses a declared length past the cap without reading", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      body: "small",
      headers: { "content-length": "999999" },
    });
    expect(await readCapped(request, 10)).toBeNull();
  });
});
