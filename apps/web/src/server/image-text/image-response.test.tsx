import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { imageResponse } from "./image-response";
import { shapeTree } from "./shape-tree";
import { devanagariShaper } from "./shaper";

/**
 * Glyph order the way a browser shapes these names. Recorded from HarfBuzz
 * with Anek Devanagari 600 and checked against Chrome; what matters is the
 * ORDER and the JOINS, not the ids themselves.
 */
const NAMES = ["कपिल", "ऋद्धि सिद्धि", "हार्दिक", "दिनेश", "ओम बना क्लब, बावरला"];

function card(names: readonly string[]) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: 24,
        gap: 8,
        background: "#0B1018",
        color: "#F5F1E6",
        fontSize: 40,
      }}
    >
      {names.map((name) => (
        <div key={name} style={{ display: "flex" }}>
          {name}
        </div>
      ))}
      <div
        style={{
          display: "flex",
          width: 160,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        रघुनाथपुरा इलेवन क्लब
      </div>
    </div>
  );
}

describe("Devanagari in server images", () => {
  it("shapes the vowel sign ि before its letter, as a browser does (कपिल)", async () => {
    const shaper = await devanagariShaper();
    const clusters = shaper.shape("कपिल");
    // क, then पि as ONE cluster (the sign drawn first, inside it), then ल.
    expect(clusters).toHaveLength(3);
    const pi = clusters[1];
    expect(pi?.key.split(" ")).toHaveLength(2);
  });

  it("joins द्ध into one glyph (ऋद्धि)", async () => {
    const shaper = await devanagariShaper();
    const clusters = shaper.shape("ऋद्धि");
    // ऋ, then द्धि: the conjunct and its vowel sign in one cluster.
    expect(clusters).toHaveLength(2);
  });

  it("rewrites only Devanagari, and only where it appears", async () => {
    const shaped = await shapeTree(
      <div style={{ display: "flex" }}>
        <span>Kapil</span>
        <span>कपिल 11</span>
      </div>,
      "Geist Sans",
    );
    expect(shaped.font).not.toBeNull();
    const html = JSON.stringify(shaped.node);
    expect(html).toContain("Kapil");
    expect(html).not.toContain("कपिल");
    expect(html).toContain(" 11");
    expect(html).toContain('Geist Sans, \\"DA Devanagari Shaped\\"');
  });

  it("leaves a Latin-only image untouched and builds no font", async () => {
    const node = <div style={{ display: "flex" }}>Kapil Sharma</div>;
    const shaped = await shapeTree(node, "Geist Sans");
    expect(shaped.font).toBeNull();
    expect(shaped.node).toBe(node);
  });

  it("rasterizes a card of Hindi names", async () => {
    const response = await imageResponse(card(NAMES), { width: 640, height: 420 });
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("is the only door: nothing else imports ImageResponse", () => {
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(path);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
          const source = readFileSync(path, "utf8");
          if (/from "(next\/og|@vercel\/og)"/.test(source)) {
            offenders.push(relative(root, path));
          }
        }
      }
    };
    visit(root);
    // A new image built with `new ImageResponse` would draw Hindi unshaped.
    expect(offenders).toEqual(["server/image-text/image-response.ts"]);
  });
});
