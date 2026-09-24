/**
 * READ THE FILE A GOOGLE FORM ACTUALLY HANDS YOU.
 *
 * Forms → Responses → "Download responses (.csv)" downloads
 * `Form Name.csv.zip`, not a CSV. The import picker accepted `.csv` only, so
 * the organizer's first step was to find the zip, unzip it, and go back — and
 * on a phone there is often no way to unzip at all.
 *
 * No dependency: the zip is read from its central directory (a Google export
 * sets the data-descriptor flag, so the local header's sizes are zero and
 * cannot be trusted) and inflated with the browser's own DecompressionStream.
 * Only the first `.csv` entry is read; anything else is refused by name.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  /** Byte range of the compressed data inside the archive. */
  start: number;
  end: number;
}

/** Every entry in a zip, from its central directory. Null when it is not a zip. */
export function zipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is 22 bytes plus a comment of up to 64K.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      return null;
    }
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
      return null;
    }
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.push({ name, method, start, end: start + size });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The CSV text inside a chosen file — plain CSV, or a Google Forms zip. */
export async function readCsvFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    return new TextDecoder().decode(bytes);
  }
  const entry = zipEntries(bytes)?.find((candidate) => /\.csv$/i.test(candidate.name));
  if (entry === undefined) {
    throw new Error("That zip has no CSV inside it.");
  }
  const data = bytes.subarray(entry.start, entry.end);
  if (entry.method === 0) {
    return new TextDecoder().decode(data);
  }
  if (entry.method !== 8) {
    throw new Error("That zip is compressed in a way we can't open — unzip it and choose the CSV.");
  }
  return new TextDecoder().decode(await inflate(data));
}
