import { describe, expect, it } from "vitest";

import { containsPattern, escapeLike } from "./like-pattern";

describe("search terms are literal in a LIKE pattern", () => {
  it("escapes both wildcards and the escape character itself", () => {
    expect(escapeLike("u_19")).toBe("u\\_19");
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("wraps the escaped term for a contains-search", () => {
    expect(containsPattern("%")).toBe("%\\%%");
    expect(containsPattern("Cup Kings")).toBe("%Cup Kings%");
  });
});
