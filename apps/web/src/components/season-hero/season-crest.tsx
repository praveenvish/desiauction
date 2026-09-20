"use client";

import { useState } from "react";

import { monogram } from "./monogram";

/**
 * The season's crest where the organizer set one; its initials where not —
 * AND where the stored file fails to load. A broken-image glyph in the middle
 * of a hero is the loudest thing on the page, so a failed load falls back to
 * the monogram exactly like a missing one.
 */
export function SeasonCrest({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (logoUrl !== null && failedUrl !== logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="sh-crest-img"
        onError={() => {
          setFailedUrl(logoUrl);
        }}
      />
    );
  }
  return (
    <span className="sh-crest-mono" aria-hidden>
      {monogram(name)}
    </span>
  );
}
