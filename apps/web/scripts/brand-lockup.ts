/**
 * Re-cut `public/brand/lockup.png` from the FINAL lockup (the guest header):
 * the DA mark, "DesiAuction", and the tagline. The old file still said
 * "BID. BUILD. WIN." and it is what WhatsApp shows as the media fallback on an
 * outcome message (server/auction/outcome-mail.ts), so it was the one place a
 * player met retired branding.
 *
 *   node --env-file-if-exists=../../.env.local node_modules/tsx/dist/cli.mjs \
 *     scripts/brand-lockup.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

const root = process.cwd();
const fontDir = join(root, "public", "fonts", "poster");
const [regular, semibold] = await Promise.all([
  readFile(join(fontDir, "geist-sans-400.woff")),
  readFile(join(fontDir, "geist-sans-600.woff")),
]);
const mark = await readFile(join(root, "public", "brand", "mark.svg"), "utf8");
const markSrc = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;

const response = new ImageResponse(
  {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 40,
        background: "linear-gradient(135deg, #0B1120 0%, #111A2E 55%, #1A1406 100%)",
        fontFamily: "Geist",
      },
      children: [
        {
          type: "img",
          props: { src: markSrc, width: 180, height: 180, style: { borderRadius: 36 } },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column" },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: 92,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                  },
                  children: [
                    { type: "span", props: { style: { color: "#FFFFFF" }, children: "Desi" } },
                    { type: "span", props: { style: { color: "#E6B24A" }, children: "Auction" } },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    marginTop: 14,
                    fontSize: 26,
                    letterSpacing: "0.34em",
                    color: "rgba(248,250,252,0.72)",
                  },
                  children: "THE GAME STARTS HERE",
                },
              },
            ],
          },
        },
      ],
    },
  } as never,
  {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Geist", data: regular.buffer as ArrayBuffer, weight: 400, style: "normal" },
      { name: "Geist", data: semibold.buffer as ArrayBuffer, weight: 600, style: "normal" },
    ],
  },
);
const png = Buffer.from(await response.arrayBuffer());
const out = join(root, "public", "brand", "lockup.png");
await writeFile(out, png);
console.log(`wrote ${out} (${String(png.length)} bytes)`);
