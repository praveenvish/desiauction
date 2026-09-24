/**
 * THE PHOTOS AN ORGANIZER ACTUALLY HAS.
 *
 * A Google Form's uploads live in Drive, and Drive's "Download" on that folder
 * produces a .zip — split into several once it passes a couple of gigabytes.
 * The photo importer took loose images only, so the organizer had to unzip
 * first; now any mixture of images and zips is accepted, and each zip is
 * opened in the browser with nothing uploaded until the review is approved.
 */

import { baseName, isRealEntry, isZipBytes, readZipEntry, zipEntries } from "./zip";

/** Extension → media type, for files that come out of a zip with no type. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export function imageTypeOf(name: string): string | null {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_TYPES[ext] ?? null;
}

export interface ExpandedPhotos {
  files: File[];
  /** Entries inside a zip that were not images — named, so nothing vanishes. */
  skipped: string[];
}

/** Loose images pass through; every zip is replaced by the images inside it. */
export async function expandPhotoFiles(chosen: readonly File[]): Promise<ExpandedPhotos> {
  const files: File[] = [];
  const skipped: string[] = [];
  for (const file of chosen) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isZipBytes(bytes)) {
      files.push(file);
      continue;
    }
    const entries = zipEntries(bytes);
    if (entries === null) {
      throw new Error(`${file.name} could not be opened as a zip.`);
    }
    for (const entry of entries.filter(isRealEntry)) {
      const name = baseName(entry.name);
      const type = imageTypeOf(name);
      if (type === null) {
        skipped.push(name);
        continue;
      }
      const data = await readZipEntry(bytes, entry);
      files.push(new File([new Uint8Array(data)], name, { type }));
    }
  }
  return { files, skipped };
}
