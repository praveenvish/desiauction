/**
 * READING A ZIP IN THE BROWSER, WITHOUT A DEPENDENCY.
 *
 * Google hands organizers zips twice: Forms' "Download responses (.csv)" and
 * Drive's "Download" on a folder of uploaded photos. Both are read here from
 * the central directory — a Google export sets the data-descriptor flag, so
 * the local header's sizes are zero and cannot be trusted — and inflated with
 * the browser's own DecompressionStream.
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

export async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A zip starts "PK". Anything else is read as the file it claims to be. */
export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** One entry's bytes, or an Error naming why they cannot be read. */
export async function readZipEntry(
  bytes: Uint8Array<ArrayBuffer>,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const data = bytes.subarray(entry.start, entry.end);
  if (entry.method === 0) {
    return data;
  }
  if (entry.method !== 8) {
    throw new Error(
      "That zip is compressed in a way we can't open — unzip it and choose the files.",
    );
  }
  return inflate(data);
}

/** The last path segment: Drive nests files under the folder's own name. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Entries a person put there, not the archiver. A zip made on a Mac carries
 * "__MACOSX/" shadows and "._name" resource forks alongside every real file —
 * each would otherwise show up as an unreadable "photo".
 */
export function isRealEntry(entry: ZipEntry): boolean {
  const name = baseName(entry.name);
  return (
    name !== "" &&
    !entry.name.startsWith("__MACOSX/") &&
    !name.startsWith("._") &&
    !entry.name.endsWith("/")
  );
}
