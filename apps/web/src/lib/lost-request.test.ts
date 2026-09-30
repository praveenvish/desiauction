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
    // Exactly what Next 15.5's client throws when the server has no such
    // action (server-action-reducer.js), name and all.
    const fromNext = new Error(
      'Server Action "40a1b2c3" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action',
    );
    fromNext.name = "UnrecognizedActionError";
    expect(lostRequest(fromNext)).toBe("stale-page");
    // The name alone, and the message alone, are each enough.
    const renamed = new Error("something else entirely");
    renamed.name = "UnrecognizedActionError";
    expect(lostRequest(renamed)).toBe("stale-page");
    expect(lostRequest(new Error('Server Action "40a1b2c3" was not found on the server.'))).toBe(
      "stale-page",
    );
    expect(
      lostRequest(
        new Error(
          'Failed to find Server Action "40a1b2". This request might be from an older or newer deployment.',
        ),
      ),
    ).toBe("stale-page");
  });

  it("an answer that was not an action result is a dropped request, not a stale page", () => {
    // A 502 page from the proxy while the server restarts: reloading lands on
    // the same 502. Waiting and trying again is what works.
    expect(lostRequest(new Error("An unexpected response was received from the server."))).toBe(
      "network",
    );
  });

  it("a redirect thrown by an action is not a failure", () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/login;307;",
    });
    expect(lostRequest(redirect)).toBeNull();
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
