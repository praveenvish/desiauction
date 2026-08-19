// PERMANENT PX-11 SECURITY REGRESSION — open-redirect guard (finding F1).
//
// The `next` param rides on the login URL and is attacker-controlled. safeNext
// must admit only genuine local paths and fold everything else to /home, so a
// crafted login link can never bounce a victim to an external phishing origin.
import { describe, expect, it } from "vitest";

import { safeNext } from "./redirect";

describe("PX-11 · safeNext (open-redirect guard)", () => {
  it("admits legitimate local paths unchanged", () => {
    for (const path of [
      "/home",
      "/seasons/malad-premier-league-2026/register",
      "/join/01JABCDEF0123456789ABCDEFG",
      "/owner-join/01JXYZ",
      "/money",
      "/account",
      "/inbox",
      "/c/some-slug",
      "/search?q=receipt",
    ]) {
      expect(safeNext(path)).toBe(path);
    }
  });

  it("rejects the backslash protocol-relative bypass", () => {
    // A browser folds `\` to `/`, so `/\evil.com` becomes `//evil.com`.
    expect(safeNext("/\\evil.com")).toBe("/home");
    expect(safeNext("/\\/evil.com")).toBe("/home");
    expect(safeNext("\\\\evil.com")).toBe("/home");
  });

  it("rejects protocol-relative and absolute external URLs", () => {
    expect(safeNext("//evil.com")).toBe("/home");
    expect(safeNext("https://evil.com")).toBe("/home");
    expect(safeNext("http://evil.com")).toBe("/home");
    expect(safeNext("javascript:alert(1)")).toBe("/home");
    expect(safeNext("data:text/html,<script>alert(1)</script>")).toBe("/home");
  });

  it("rejects whitespace, control-character and empty bypasses", () => {
    expect(safeNext(undefined)).toBe("/home");
    expect(safeNext("")).toBe("/home");
    expect(safeNext(" //evil.com")).toBe("/home");
    expect(safeNext("/\t/evil.com")).toBe("/home");
    expect(safeNext("/\n//evil.com")).toBe("/home");
    expect(safeNext("not-a-path")).toBe("/home");
  });
});

describe("dot segments (audit P3-8)", () => {
  it("refuses paths whose dot segments the browser would resolve after the check", () => {
    // Same-origin either way — the point is that the string we approved and the
    // string the browser navigates to must be the same one.
    expect(safeNext("/./evil")).toBe("/home");
    expect(safeNext("/../evil")).toBe("/home");
    expect(safeNext("/org/./secret")).toBe("/home");
    expect(safeNext("/org/../../etc")).toBe("/home");
  });

  it("still allows ordinary paths containing dots", () => {
    expect(safeNext("/help/what.is-this")).toBe("/help/what.is-this");
    expect(safeNext("/seasons/spring-2026")).toBe("/seasons/spring-2026");
  });
});
