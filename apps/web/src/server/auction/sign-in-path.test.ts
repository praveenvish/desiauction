import { describe, expect, it } from "vitest";

import { safeNext } from "../auth/redirect";
import { signInPathFor } from "./sign-in-path";

describe("where a signed-out bidder is sent back to", () => {
  it("returns to the season's auction, through a value the login page accepts", () => {
    const path = signInPathFor("demo-premier-league");
    expect(path).toBe("/login?next=%2Fseasons%2Fdemo-premier-league%2Fauction");
    const next = new URL(path, "https://desiauction.in").searchParams.get("next") ?? undefined;
    // The login page runs every `next` through this; a value it would replace
    // with /home is a round trip that lands in the wrong place.
    expect(safeNext(next)).toBe("/seasons/demo-premier-league/auction");
  });

  it("gives the plain door to anything that is not shaped like a slug", () => {
    for (const slug of [
      "",
      "../admin",
      "a/b",
      "x?next=//evil.example",
      "UPPER",
      "sp ace",
      "%2F%2Fevil.example",
      "-leading-dash",
      "a".repeat(101),
    ]) {
      expect(signInPathFor(slug), slug).toBe("/login");
    }
  });
});
