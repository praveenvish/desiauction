import { newId } from "@desiauction/db";
import { describe, expect, it } from "vitest";

import { pickHandleFor, requestIdFromHandle, tokenForRequest } from "./demo-booking";

/**
 * Only a handle this server signed may name a demo request. The bare id used to
 * be enough, and booking against it returned the booking's management token.
 */
describe("the demo pick handle", () => {
  const id = newId();

  it("round-trips the handle the requester is given", () => {
    expect(requestIdFromHandle(pickHandleFor(id))).toBe(id);
  });

  it("refuses the bare id that used to be accepted", () => {
    expect(requestIdFromHandle(id)).toBeNull();
  });

  it("refuses a handle whose signature was edited or borrowed", () => {
    const handle = pickHandleFor(id);
    const tampered = `${handle.slice(0, -1)}${handle.endsWith("A") ? "B" : "A"}`;
    expect(requestIdFromHandle(tampered)).toBeNull();
    // Another request's signature does not transfer.
    const other = pickHandleFor(newId());
    expect(requestIdFromHandle(`${id}.${other.split(".")[1] ?? ""}`)).toBeNull();
  });

  it("is a different secret from the booking token, so neither stands in for the other", () => {
    expect(pickHandleFor(id).split(".")[1]).not.toBe(tokenForRequest(id).slice(0, 22));
  });

  it("refuses anything that is not a string", () => {
    expect(requestIdFromHandle(undefined)).toBeNull();
    expect(requestIdFromHandle(42)).toBeNull();
  });
});
