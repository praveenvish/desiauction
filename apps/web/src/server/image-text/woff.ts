import { inflateSync } from "node:zlib";

/**
 * A WOFF 1.0 file back to the plain OpenType file it wraps.
 *
 * The poster faces ship as WOFF, which Satori reads. HarfBuzz does not: it
 * shapes from the raw tables. WOFF 1.0 is only those tables, each one
 * zlib-compressed when that made it smaller, behind a header — so unwrapping
 * is rebuilding the plain table directory and inflating each table into place.
 * Checksums are carried over as stored; nothing that reads this checks them.
 */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.readUInt32BE(0) !== 0x774f4646) {
    // "wOFF". Anything else is already a plain font (or not a font at all,
    // which the face constructor will reject).
    return woff;
  }
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = Array.from({ length: numTables }, (_, index) => {
    const at = 44 + index * 20;
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const raw = woff.subarray(offset, offset + compLength);
    return {
      tag: woff.readUInt32BE(at),
      checksum: woff.readUInt32BE(at + 16),
      data: compLength < origLength ? inflateSync(raw) : raw,
    };
  });

  const directoryEnd = 12 + numTables * 16;
  const padded = (length: number) => (length + 3) & ~3;
  const out = Buffer.alloc(
    tables.reduce((size, table) => size + padded(table.data.length), directoryEnd),
  );
  let power = 0;
  while (1 << (power + 1) <= numTables) {
    power++;
  }
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE((1 << power) * 16, 6);
  out.writeUInt16BE(power, 8);
  out.writeUInt16BE(numTables * 16 - (1 << power) * 16, 10);
  let offset = directoryEnd;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    out.writeUInt32BE(table.tag, record);
    out.writeUInt32BE(table.checksum, record + 4);
    out.writeUInt32BE(offset, record + 8);
    out.writeUInt32BE(table.data.length, record + 12);
    table.data.copy(out, offset);
    offset += padded(table.data.length);
  });
  return out;
}
