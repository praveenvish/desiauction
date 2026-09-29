import { describe, expect, it } from "vitest";

import { lostRequest } from "./lost-request";

describe("recognising a request that never came back", () => {
  it("knows each browser's words for a dropped connection", () => {
    for (const message of [
      "Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      "fetch failed",
      "Connection closed.",
    ]) {
      expect(lostRequest(new TypeError(message)), message).toBe("network");
    }
  });

  it("knows a page that is older than the server it is talking to", () => {
    expect(
      lostRequest(
        new Error(
          'Failed to find Server Action "40a1b2". This request might be from an older or newer deployment.',
        ),
      ),
    ).toBe("stale-page");
    expect(lostRequest(new Error("An unexpected response was received from the server."))).toBe(
      "stale-page",
    );
  });

  it("says nothing about errors it does not understand", () => {
    for (const reason of [
      new Error("Cannot read properties of undefined (reading 'id')"),
      new Error(""),
      "some string",
      null,
      undefined,
      42,
      {},
      { message: 7 },
    ]) {
      expect(lostRequest(reason)).toBeNull();
    }
  });
});
