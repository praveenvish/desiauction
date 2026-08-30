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

/**
 * WHAT A DRIVE FOLDER ACTUALLY NAMES ITS FILES.
 *
 * A Google Form file-upload question does not store "Rohit Sharma.jpg". It
 * stores the answer with the QUESTION appended and a copy counter when a name
 * repeats: "Rohit Sharma - Upload your photo.jpg", "Rohit Sharma (1).jpg",
 * "Rohit Sharma - Player Photo(2).jpg". Downloading that folder and dropping it
 * into the importer matched almost nothing, because the stem was compared
 * whole and every one of those stems is longer than the player's name.
 *
 * A copy counter is dropped, and a " - " separated name is offered from BOTH
 * sides: "Rohit Sharma - Upload your photo" hides the player in front of the
 * separator, while "12 - Rohit Sharma" — a numbered roster — hides them behind
 * it. Offering both costs nothing, because a candidate only ever becomes a
 * match by EQUALLING a player already registered here; it cannot invent one.
 *
 * The whole stem is always tried first, so a file named exactly after a player
 * can never be beaten by a shortened form of somebody else. Ambiguity still
 * refuses, and anything this cannot reduce is reported unmatched.
 */
export function strippedStems(stem: string): string[] {
  const out: string[] = [stem];
  const add = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed !== "" && !out.includes(trimmed)) {
      out.push(trimmed);
    }
  };
  // "rohit sharma (1)" / "rohit sharma(2)" — a copy counter, not a player.
  const noCounter = stem.replace(/\s*\(\d+\)\s*$/, "");
  add(noCounter);
  // Spaces around the hyphen are required, so a hyphenated name ("Jean-Paul")
  // is never split. Both sides are offered — see the note above.
  for (const candidate of [noCounter, stem]) {
    const cut = candidate.lastIndexOf(" - ");
    if (cut > 0) {
      add(candidate.slice(0, cut));
      add(candidate.slice(cut + 3));
    }
  }
  return out;
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

    /*
     * Each rule is tried against the filename as written FIRST, then against
     * the shortened forms a Drive export produces. Order matters: the exact
     * stem must win, so a file genuinely named after one player can never be
     * beaten by a stripped form of another.
     */
    const stems = strippedStems(stem);
    const firstHit = <T>(pick: (candidate: string) => T | "ambiguous" | null): T | "ambiguous" | null => {
      let sawAmbiguous = false;
      for (const candidate of stems) {
        const hit = pick(candidate);
        if (hit === "ambiguous") {
          sawAmbiguous = true;
          continue;
        }
        if (hit !== null) {
          return hit;
        }
      }
      return sawAmbiguous ? "ambiguous" : null;
    };

    const numberHit = firstHit((candidate) => only(byNumber.get(candidate) ?? []));
    const phoneHit =
      numberHit === null
        ? firstHit((candidate) =>
            only(distinct(phoneCandidates(candidate).flatMap((c) => byPhone.get(c) ?? []))),
          )
        : null;
    const nameHit =
      numberHit === null && phoneHit === null
        ? firstHit((candidate) => only(byName.get(nameToken(candidate)) ?? []))
        : null;

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
