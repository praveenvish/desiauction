import { MAX_IMAGE_BYTES, isValidMediaKey, mediaKeyBelongsTo } from "@desiauction/core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ingestUpload } from "./ingest";
import { BucketStorage, type StoragePort, type StoredObject } from "./storage-port";

// Keys obey the real grammar (26-char ULID-shaped segments), so the in-memory
// port exercises the same validation the real adapters do.
const ORG = "01ORG0000000000000000000AA";
const SUBJECT = "01REG0000000000000000000BB";
const RAW = `org/${ORG}/player/${SUBJECT}/01RAW0000000000000000000CC.jpg`;
const TOKEN = "01NEW0000000000000000000DD";
const TARGET = { orgId: ORG, subject: "player" as const, subjectId: SUBJECT };

class MemoryPort implements StoragePort {
  readonly objects = new Map<string, { type: string; bytes: Buffer }>();
  readonly deleted: string[] = [];
  presignUpload(): never {
    throw new Error("unused");
  }
  readUrl(key: string): string {
    return `/m/${key}`;
  }
  delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
  readObject(key: string, maxBytes: number): Promise<StoredObject> {
    const found = this.objects.get(key);
    if (found === undefined) return Promise.resolve({ status: "missing" });
    return Promise.resolve(
      found.bytes.byteLength > maxBytes
        ? { status: "too_large" }
        : { status: "ok", bytes: found.bytes },
    );
  }
  writeObject(key: string, type: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, { type, bytes });
    return Promise.resolve();
  }
}

async function gpsJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: "#884422" } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "18/1 31/1 12/1" } })
    .toBuffer();
}

describe("ingestUpload (P0-6) — the attach stores our bytes, never the client's", () => {
  it("writes a sanitized copy under a FRESH key bound to the same subject", async () => {
    const port = new MemoryPort();
    port.objects.set(RAW, { type: "image/jpeg", bytes: await gpsJpeg() });
    const result = await ingestUpload(port, RAW, TARGET, TOKEN);
    if (!result.ok) throw new Error(result.error);

    expect(result.rawKey).toBe(RAW);
    expect(result.key).not.toBe(RAW);
    expect(isValidMediaKey(result.key)).toBe(true);
    expect(mediaKeyBelongsTo(result.key, TARGET)).toBe(true);
    const stored = port.objects.get(result.key);
    expect(stored?.type).toBe("image/jpeg");
    expect((await sharp(stored?.bytes).metadata()).exif).toBeUndefined();
    // The raw object is left for the caller to delete AFTER the row commits.
    expect(port.deleted).toEqual([]);
  });

  it("refuses and deletes a text file uploaded under a .jpg key", async () => {
    const port = new MemoryPort();
    port.objects.set(RAW, { type: "image/jpeg", bytes: Buffer.from("just some text ".repeat(8)) });
    const result = await ingestUpload(port, RAW, TARGET, TOKEN);
    expect(result.ok).toBe(false);
    expect(port.deleted).toEqual([RAW]);
    expect(port.objects.size).toBe(0);
  });

  it("refuses and deletes an object past the 5 MB cap without sanitizing it", async () => {
    const port = new MemoryPort();
    port.objects.set(RAW, { type: "image/jpeg", bytes: Buffer.alloc(MAX_IMAGE_BYTES + 1) });
    expect(await ingestUpload(port, RAW, TARGET, TOKEN)).toEqual({
      ok: false,
      error: "Image must be 5 MB or smaller.",
    });
    expect(port.deleted).toEqual([RAW]);
  });

  it("reports a PUT that never arrived", async () => {
    const result = await ingestUpload(new MemoryPort(), RAW, TARGET, TOKEN);
    expect(result).toEqual({ ok: false, error: "The upload did not arrive. Please try again." });
  });
});

describe("BucketStorage.readObject — a capped read of the client's object", () => {
  const port = (body: Buffer, headers: Record<string, string> = {}, status = 200) =>
    new BucketStorage({
      publicBase: "https://cdn.example",
      sign: ({ method, key }) => `https://bucket.example/${key}?m=${method}`,
      transport: () =>
        Promise.resolve({
          status,
          headers: { get: (name: string) => headers[name] ?? null },
          body: (async function* () {
            // Chunked, like a real stream, so the cap is counted as it goes.
            for (let at = 0; at < body.byteLength; at += 1024) {
              await Promise.resolve();
              yield body.subarray(at, at + 1024);
            }
          })(),
        }),
    });

  it("refuses on a declared length past the cap", async () => {
    const read = await port(Buffer.alloc(10), { "content-length": "999999999" }).readObject(
      RAW,
      4096,
    );
    expect(read).toEqual({ status: "too_large" });
  });

  it("stops counting at the cap when no length is declared", async () => {
    expect(await port(Buffer.alloc(8192)).readObject(RAW, 4096)).toEqual({ status: "too_large" });
    const ok = await port(Buffer.alloc(2048, 7)).readObject(RAW, 4096);
    expect(ok.status === "ok" && ok.bytes.byteLength).toBe(2048);
  });

  it("treats a missing key as missing, and refuses to read a malformed one", async () => {
    expect(await port(Buffer.alloc(0), {}, 404).readObject(RAW, 4096)).toEqual({
      status: "missing",
    });
    await expect(port(Buffer.alloc(0)).readObject("../etc/passwd", 4096)).rejects.toThrow();
  });
});
