/**
 * Read a request body as text, refusing past `maxBytes` WHILE reading.
 *
 * `request.text()` buffers the whole body first, and a `content-length` check
 * in front of it only covers requests that declare one — a chunked POST
 * declares nothing and streams for as long as the sender likes. On an
 * unauthenticated route that is a memory budget handed to anyone. This stops
 * at the cap and returns null, which callers answer the same way they answer
 * any other malformed request.
 */
export async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  const bytes = await readCappedBytes(request, maxBytes);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/**
 * The same read, returning the bytes exactly as they arrived.
 *
 * For a caller that verifies a signature over the body: an HMAC is over BYTES,
 * and decoding to text first quietly replaces anything that is not valid UTF-8
 * — the digest then no longer describes what the sender signed.
 */
export async function readCappedBytes(request: Request, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return null;
  }
  if (request.body === null) {
    return Buffer.alloc(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
