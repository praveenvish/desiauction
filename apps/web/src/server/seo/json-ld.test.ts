// PERMANENT PX-11 SECURITY REGRESSION — JSON-LD output encoding (finding F2).
//
// Proves a stored-XSS breakout is structurally impossible: organizer-controlled
// text serialized for a <script type="application/ld+json"> block can never
// close the tag or open a new one.
import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "./json-ld";

describe("PX-11 · serializeJsonLd", () => {
  it("escapes a </script> breakout in a name", () => {
    const hostile = { name: "</script><script>alert(document.cookie)</script>" };
    const out = serializeJsonLd(hostile);
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    // The escaped form is still valid JSON that round-trips to the original.
    expect(JSON.parse(out)).toEqual(hostile);
  });

  it("escapes < > & wherever they appear", () => {
    const out = serializeJsonLd({ a: "<", b: ">", c: "&", d: "a<b>c&d" });
    expect(out).not.toMatch(/[<>&]/);
    expect(JSON.parse(out)).toEqual({ a: "<", b: ">", c: "&", d: "a<b>c&d" });
  });

  it("escapes the U+2028/U+2029 line separators", () => {
    const ls = String.fromCharCode(0x2028);
    const ps = String.fromCharCode(0x2029);
    const out = serializeJsonLd({ name: `a${ls}b${ps}c` });
    expect(out).not.toContain(ls);
    expect(out).not.toContain(ps);
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
  });

  it("leaves a benign payload as parseable JSON", () => {
    const payload = { "@type": "SportsEvent", name: "Malad Premier League 2026" };
    expect(JSON.parse(serializeJsonLd(payload))).toEqual(payload);
  });
});
