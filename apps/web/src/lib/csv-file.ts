/**
 * READ THE FILE A GOOGLE FORM ACTUALLY HANDS YOU.
 *
 * Forms → Responses → "Download responses (.csv)" downloads
 * `Form Name.csv.zip`, not a CSV. The import picker accepted `.csv` only, so
 * the organizer's first step was to find the zip, unzip it, and go back — and
 * on a phone there is often no way to unzip at all.
 *
 * The zip itself is read by `./zip`. Only the first `.csv` entry is read;
 * a zip with none is refused by name.
 */

import { isRealEntry, isZipBytes, readZipEntry, zipEntries } from "./zip";

/** The CSV text inside a chosen file — plain CSV, or a Google Forms zip. */
export async function readCsvFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZipBytes(bytes)) {
    return new TextDecoder().decode(bytes);
  }
  const entry = zipEntries(bytes)?.find(
    (candidate) => isRealEntry(candidate) && /\.csv$/i.test(candidate.name),
  );
  if (entry === undefined) {
    throw new Error("That zip has no CSV inside it.");
  }
  return new TextDecoder().decode(await readZipEntry(bytes, entry));
}
