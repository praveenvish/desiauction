/**
 * Deterministic filename → player matching for bulk photo import. Pure — no IO,
 * no storage, no ambient time. The organizer drops a folder of images; this
 * decides which registration each file belongs to BEFORE a single byte is
 * uploaded, so the review table they approve is the whole truth of what will
 * happen (same "validate the batch, then commit" discipline as the CSV import).
 *
 * Three rules, most-specific first — registration number, then phone, then name.
 * A file that matches two players by the same rule is NOT guessed at; it is
 * reported unmatched. One player takes at most one file per batch.
 */

export interface PhotoTarget {
  registrationId: string;
  /** Human-quotable reference, e.g. "R7K2M9". */
  number: string;
  name: string | null;
  /** E.164; matching keys off the last 10 digits (the mobile itself). */
  phone: string;
  /** Already has a consented photo — matched, but flagged as a replacement. */
  hasPhoto: boolean;
}

export type PhotoMatchRule = "number" | "phone" | "name";

export type PhotoMatch =
  | { file: string; ok: true; rule: PhotoMatchRule; target: PhotoTarget }
  | { file: string; ok: false; reason: string };

/** Filename minus its extension, lowercased. "Rohit Sharma.JPG" → "rohit sharma". */
export function fileStem(fileName: string): string {
  const cut = fileName.lastIndexOf(".");
  return (cut > 0 ? fileName.slice(0, cut) : fileName).trim().toLowerCase();
}

/** Collapse to comparable words in any script: "rohit_sharma-2" → "rohit sharma 2". */
function nameToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The mobile itself, without country code — the stable key across formats. */
function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-10);
}

/**
 * Candidate mobiles inside a filename. Separators are dropped first, because a
 * gallery export writes the same number as "9876543210", "+91 98765 43210" or
 * "919876543210-1"; every 10-digit window that could BE an Indian mobile (first
 * digit 6-9) is then offered. A window only ever becomes a match by equalling a
 * phone actually registered in this competition, so casting wide costs nothing.
 */
function phoneCandidates(stem: string): string[] {
  const digits = stem.replace(/\D/g, "");
  const candidates = new Set<string>();
  for (let i = 0; i + 10 <= digits.length; i++) {
    const window = digits.slice(i, i + 10);
    if (/^[6-9]/.test(window)) {
      candidates.add(window);
    }
  }
  return [...candidates];
}

/** One entry per registration — two windows of one filename are not two players. */
function distinct(targets: readonly PhotoTarget[]): PhotoTarget[] {
  const seen = new Map<string, PhotoTarget>();
  for (const target of targets) {
    if (!seen.has(target.registrationId)) {
      seen.set(target.registrationId, target);
    }
  }
  return [...seen.values()];
}

function only<T>(matches: readonly T[]): T | "ambiguous" | null {
  if (matches.length === 1) {
    return matches[0] as T;
  }
  return matches.length === 0 ? null : "ambiguous";
}

/**
 * Match a batch of filenames against this competition's registrations.
 * Deterministic and order-stable: the result has one entry per input file, in
 * the order given. Duplicate claims on one player resolve to the first file.
 */
export function matchPhotoFiles(
  fileNames: readonly string[],
  targets: readonly PhotoTarget[],
): PhotoMatch[] {
  const byNumber = new Map<string, PhotoTarget[]>();
  const byPhone = new Map<string, PhotoTarget[]>();
  const byName = new Map<string, PhotoTarget[]>();
  const push = (map: Map<string, PhotoTarget[]>, key: string, target: PhotoTarget): void => {
    if (key === "") {
      return;
    }
    const bucket = map.get(key);
    if (bucket === undefined) {
      map.set(key, [target]);
    } else {
      bucket.push(target);
    }
  };
  for (const target of targets) {
    push(byNumber, target.number.toLowerCase(), target);
    push(byPhone, phoneKey(target.phone), target);
    push(byName, nameToken(target.name ?? ""), target);
  }

  const claimed = new Map<string, string>(); // registrationId → the file that won it
  return fileNames.map((file) => {
    const stem = fileStem(file);
    if (stem === "") {
      return { file, ok: false as const, reason: "unnamed file" };
    }

    const numberHit = only(byNumber.get(stem) ?? []);
    const phoneHit =
      numberHit === null
        ? only(distinct(phoneCandidates(stem).flatMap((candidate) => byPhone.get(candidate) ?? [])))
        : null;
    const nameHit =
      numberHit === null && phoneHit === null ? only(byName.get(nameToken(stem)) ?? []) : null;

    const hit = numberHit ?? phoneHit ?? nameHit;
    const rule: PhotoMatchRule =
      numberHit !== null ? "number" : phoneHit !== null ? "phone" : "name";
    if (hit === null) {
      return {
        file,
        ok: false as const,
        reason:
          "no player matched — name the file after the player's registration number, mobile, or full name",
      };
    }
    if (hit === "ambiguous") {
      return {
        file,
        ok: false as const,
        reason: `matches more than one player by ${rule} — rename it to the registration number`,
      };
    }
    const priorFile = claimed.get(hit.registrationId);
    if (priorFile !== undefined) {
      return { file, ok: false as const, reason: `“${priorFile}” already matched this player` };
    }
    claimed.set(hit.registrationId, file);
    return { file, ok: true as const, rule, target: hit };
  });
}
