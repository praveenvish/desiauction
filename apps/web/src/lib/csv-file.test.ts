import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { readCsvFile, zipEntries } from "./csv-file";

/**
 * A zip in the shape Google Forms downloads: one deflated CSV, the
 * data-descriptor flag set, so the LOCAL header's sizes are zero and only the
 * central directory knows where the data ends.
 */
function googleStyleZip(name: string, text: string): Uint8Array<ArrayBuffer> {
  const nameBytes = new TextEncoder().encode(name);
  const raw = new TextEncoder().encode(text);
  const data = deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0x0808, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(nameBytes.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(data.length, 8);
  descriptor.writeUInt32LE(raw.length, 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0808, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralAt = 30 + nameBytes.length + data.length + 16;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameBytes.length, 12);
  eocd.writeUInt32LE(centralAt, 16);
  return new Uint8Array(
    Buffer.concat([local, nameBytes, data, descriptor, central, nameBytes, eocd]),
  );
}

const CSV =
  '"Timestamp","Name","Mobile","Player Type"\n"2026/02/05","Rohit Sharma","9876543210","🏏 Batsman"\n';

describe("readCsvFile", () => {
  it("opens a Google Forms .csv.zip straight from the picker", async () => {
    const zip = googleStyleZip("Cricket Registration Form.csv", CSV);
    expect(zipEntries(zip)?.map((entry) => entry.name)).toEqual(["Cricket Registration Form.csv"]);
    const file = new File([zip], "Cricket Registration Form.csv.zip");
    await expect(readCsvFile(file)).resolves.toBe(CSV);
  });

  it("passes a plain CSV through untouched", async () => {
    await expect(readCsvFile(new File([CSV], "players.csv"))).resolves.toBe(CSV);
  });

  it("refuses a zip with no CSV inside, by name", async () => {
    const file = new File([googleStyleZip("photo.jpg", "x")], "photos.zip");
    await expect(readCsvFile(file)).rejects.toThrow("no CSV inside");
  });
});
