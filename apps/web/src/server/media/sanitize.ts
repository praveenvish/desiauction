import { MAX_IMAGE_BYTES, bytesMatchImageType, type AllowedImageType } from "@desiauction/core";

/**
 * THE UPLOAD SANITIZER — every image is re-encoded by us before anyone sees it
 * (go-live gate P0-6).
 *
 * In production the browser PUTs straight to the bucket on a presigned URL
 * (s3-signer.ts). That URL pins the content TYPE, never the bytes: the payload
 * is UNSIGNED, and the 5 MB check at presign reads a number the client typed.
 * So what landed in the bucket was whatever the client chose to send — a text
 * file wearing `.jpg`, a 40 MB panorama, and, for every honest phone photo,
 * the EXIF block with the GPS fix of where it was taken. The bucket is
 * anonymous-read, and some of those faces are children's.
 *
 * `attachMedia` / `attachOwnPhoto` therefore read the object back (capped),
 * hand the bytes here, and store only what comes out:
 *
 *   · magic bytes must match the declared type (a renamed text file is refused);
 *   · decode with a pixel ceiling, so a small file cannot claim a gigapixel
 *     canvas (decompression bomb) and take the web tier's memory with it;
 *   · `.rotate()` applies the EXIF orientation to the pixels, because the tag
 *     that carried it is about to be dropped;
 *   · resize inside 2048px — no public surface draws a player larger;
 *   · re-encode. sharp strips ALL metadata by default (EXIF, GPS, XMP, IPTC,
 *     ICC → sRGB). `withMetadata` / `keepExif` must never be added here.
 *
 * Output is JPEG, or PNG when the image has an alpha channel (a crest with a
 * transparent background). Never WebP: the poster/share-card rasterizer
 * decodes PNG and JPEG only (posters.ts `inlineStoredImage`), so normalising
 * here also gives every reader a format it can draw.
 */

/** Pixels, not bytes: ~40 MP covers any phone camera and refuses bombs. */
export const MAX_INPUT_PIXELS = 40_000_000;
/** The longest edge anything is stored at. */
export const MAX_STORED_EDGE = 2048;

export type SanitizedImage =
  | { ok: true; bytes: Buffer; contentType: Extract<AllowedImageType, "image/jpeg" | "image/png"> }
  | { ok: false; error: string };

const NOT_AN_IMAGE = "That file is not a JPEG, PNG or WebP image.";

export async function sanitizeImage(
  bytes: Buffer,
  declaredType: AllowedImageType,
): Promise<SanitizedImage> {
  if (bytes.byteLength === 0) {
    return { ok: false, error: "The file is empty." };
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }
  // The key's extension came from the type declared at presign; the bytes are
  // the file's own. They must agree before a decoder is pointed at them.
  if (!bytesMatchImageType(declaredType, bytes)) {
    return { ok: false, error: NOT_AN_IMAGE };
  }
  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch {
    // Fail CLOSED: without the encoder there is no way to strip the metadata,
    // and an unsanitized photo must not be attached.
    return { ok: false, error: "Image processing is unavailable. Please try again later." };
  }
  try {
    const options = {
      limitInputPixels: MAX_INPUT_PIXELS,
      // Truncated phone JPEGs raise warnings and still decode fine; a file the
      // decoder cannot make sense of is an error, and is refused.
      failOn: "error",
      // Animated WebP/PNG: the first frame is the picture (the default, stated).
      pages: 1,
    } as const;
    const { hasAlpha } = await sharp(bytes, options).metadata();
    const pipeline = sharp(bytes, options).rotate().resize({
      width: MAX_STORED_EDGE,
      height: MAX_STORED_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });
    const out = hasAlpha
      ? await pipeline.png({ compressionLevel: 9, palette: false }).toBuffer()
      : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    if (out.byteLength > MAX_IMAGE_BYTES) {
      // Only a pathological 2048px PNG gets here; readers cap at the same size.
      return { ok: false, error: "Image must be 5 MB or smaller." };
    }
    return { ok: true, bytes: out, contentType: hasAlpha ? "image/png" : "image/jpeg" };
  } catch {
    // Pixel ceiling exceeded, corrupt data, or a polyglot that only LOOKS like
    // an image in its first twelve bytes.
    return { ok: false, error: NOT_AN_IMAGE };
  }
}

/** The declared type a stored key was minted for (`deriveMediaKey`'s extension). */
export function imageTypeOfKey(key: string): AllowedImageType | null {
  if (key.endsWith(".jpg")) {
    return "image/jpeg";
  }
  if (key.endsWith(".png")) {
    return "image/png";
  }
  return key.endsWith(".webp") ? "image/webp" : null;
}
