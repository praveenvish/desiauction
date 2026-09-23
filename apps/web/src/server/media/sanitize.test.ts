import { MAX_IMAGE_BYTES } from "@desiauction/core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { MAX_STORED_EDGE, imageTypeOfKey, sanitizeImage } from "./sanitize";

/**
 * P0-6: the attach stores OUR re-encode, never the client's bytes. These run
 * the real encoder over real files — a photo with a GPS fix in its EXIF is
 * exactly the thing that must not reach the anonymous-read bucket.
 */

/** A small, real JPEG carrying the metadata a phone camera writes. */
async function phonePhoto(options: { width?: number; height?: number; orientation?: number } = {}) {
  return sharp({
    create: {
      width: options.width ?? 64,
      height: options.height ?? 32,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  })
    .jpeg()
    .withExif({
      IFD0: { Make: "PhoneCo", Model: "Camera 9" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "18/1 31/1 12/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "73/1 51/1 24/1",
      },
    })
    .withMetadata(options.orientation === undefined ? {} : { orientation: options.orientation })
    .toBuffer();
}

describe("sanitizeImage (P0-6)", () => {
  it("the fixture really does carry GPS EXIF — otherwise the next test proves nothing", async () => {
    const input = await phonePhoto();
    const meta = await sharp(input).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.exif?.toString("latin1")).toContain("PhoneCo");
  });

  it("strips every byte of EXIF (GPS included) from a phone JPEG", async () => {
    const result = await sanitizeImage(await phonePhoto(), "image/jpeg");
    if (!result.ok) throw new Error(result.error);
    expect(result.contentType).toBe("image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(result.bytes.includes(Buffer.from("PhoneCo"))).toBe(false);
  });

  it("applies the EXIF orientation to the pixels before the tag is dropped", async () => {
    // Orientation 6 = rotate 90° clockwise to display: a 64x32 sensor image is
    // a 32x64 photo. Dropping the tag without rotating would lay it sideways.
    const result = await sanitizeImage(await phonePhoto({ orientation: 6 }), "image/jpeg");
    if (!result.ok) throw new Error(result.error);
    const meta = await sharp(result.bytes).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 32, height: 64 });
    expect(meta.orientation).toBeUndefined();
  });

  it("shrinks anything larger than the stored edge, keeping the aspect ratio", async () => {
    const big = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: "#123456" },
    })
      .jpeg()
      .toBuffer();
    const result = await sanitizeImage(big, "image/jpeg");
    if (!result.ok) throw new Error(result.error);
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(MAX_STORED_EDGE);
    expect(meta.height).toBe(MAX_STORED_EDGE / 2);
  });

  it("keeps transparency as PNG and turns an opaque WebP into JPEG", async () => {
    const crest = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const png = await sanitizeImage(crest, "image/png");
    expect(png.ok && png.contentType).toBe("image/png");

    const webp = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#ff0000" },
    })
      .webp()
      .toBuffer();
    const fromWebp = await sanitizeImage(webp, "image/webp");
    if (!fromWebp.ok) throw new Error(fromWebp.error);
    // The poster rasterizer cannot draw WebP; what we store, it can.
    expect(fromWebp.contentType).toBe("image/jpeg");
    expect((await sharp(fromWebp.bytes).metadata()).format).toBe("jpeg");
  });

  it("refuses a text file renamed .jpg", async () => {
    const text = Buffer.from("<script>alert(1)</script> definitely a photo, honest\n".repeat(4));
    const result = await sanitizeImage(text, "image/jpeg");
    expect(result).toEqual({ ok: false, error: "That file is not a JPEG, PNG or WebP image." });
  });

  it("refuses a file whose first bytes lie about the rest (JPEG magic, garbage body)", async () => {
    const polyglot = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x41)]);
    const result = await sanitizeImage(polyglot, "image/jpeg");
    expect(result.ok).toBe(false);
  });

  it("refuses a real image of the WRONG declared type", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#00ff00" },
    })
      .png()
      .toBuffer();
    expect((await sanitizeImage(png, "image/jpeg")).ok).toBe(false);
  });

  it("refuses a decompression bomb — a small file claiming a huge canvas", async () => {
    // 8000x8000 = 64 MP of one colour compresses to a few KB.
    const bomb = await sharp({
      create: { width: 8000, height: 8000, channels: 3, background: "#000000" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.byteLength).toBeLessThan(MAX_IMAGE_BYTES);
    expect((await sanitizeImage(bomb, "image/png")).ok).toBe(false);
  });

  it("refuses bytes past the upload cap and an empty file", async () => {
    const huge = Buffer.concat([await phonePhoto(), Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(await sanitizeImage(huge, "image/jpeg")).toEqual({
      ok: false,
      error: "Image must be 5 MB or smaller.",
    });
    expect((await sanitizeImage(Buffer.alloc(0), "image/jpeg")).ok).toBe(false);
  });
});

describe("imageTypeOfKey", () => {
  it("reads the type a key was minted for from its extension", () => {
    expect(imageTypeOfKey("org/a/player/b/c.jpg")).toBe("image/jpeg");
    expect(imageTypeOfKey("org/a/player/b/c.png")).toBe("image/png");
    expect(imageTypeOfKey("org/a/player/b/c.webp")).toBe("image/webp");
    expect(imageTypeOfKey("org/a/player/b/c.gif")).toBeNull();
  });
});
