import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { withDb } from "./lib";
import { readFileSync } from "node:fs";
const { slug } = JSON.parse(readFileSync("rehearsal/artifacts/season.json", "utf8"));

function crc32(buf: Buffer): number {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ (buf[n] as number)) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A real, valid 8×8 RGB PNG in the given colour. */
function png(r: number, g: number, b: number): Buffer {
  const w = 8,
    h = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  mkdirSync("rehearsal/artifacts/photos", { recursive: true });
  const rows = await withDb(
    async (h) => h.sql`
    select r.registration_number as num, pe.phone, pe.name
    from registrations r
    join people pe on pe.id = r.person_id
    join competitions c on c.id = r.competition_id
    where c.slug = ${slug} order by pe.phone limit 14`,
  );
  let i = 0;
  const manifest: string[] = [];
  for (const row of rows as any[]) {
    let fname: string;
    if (i < 5)
      fname = `${row.num}.png`; // by registration number
    else if (i < 10)
      fname = `${String(row.phone).replace("+91", "")}.png`; // by phone
    else fname = `${String(row.name).replace(/[^A-Za-z ]/g, "")}.png`; // by name
    writeFileSync(`rehearsal/artifacts/photos/${fname}`, png((i * 37) % 256, (i * 91) % 256, 200));
    manifest.push(fname);
    i++;
  }
  // one file that matches nobody, one that is not an image
  writeFileSync("rehearsal/artifacts/photos/ZZZNOBODY.png", png(1, 2, 3));
  writeFileSync("rehearsal/artifacts/photos/notes.txt", Buffer.from("not an image"));
  console.log(JSON.stringify(manifest, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
