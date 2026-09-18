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
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return null;
  }
  if (request.body === null) {
    return "";
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
  return new TextDecoder().decode(Buffer.concat(chunks));
}
