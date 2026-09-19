import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BRAND_MARK_SVG } from "./share-image-card";

describe("share cards carry the real brand mark", () => {
  it("is byte-identical to public/brand/mark.svg", () => {
    // Inlined because the card layer does no IO. If the mark is redrawn, this
    // is where the share cards find out — not on somebody's WhatsApp preview.
    const file = readFileSync(resolve(__dirname, "../../../../public/brand/mark.svg"), "utf8");
    expect(BRAND_MARK_SVG).toBe(file);
  });
});
