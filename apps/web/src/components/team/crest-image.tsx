"use client";

import { useState, type ImgHTMLAttributes, type ReactNode } from "react";

/**
 * A TEAM'S UPLOADED CREST, OR ITS INITIALS WHEN THE FILE DOES NOT ARRIVE.
 *
 * Five screens draw a team's badge, each in its own size and treatment — the
 * projector board, the 30px purse chip, the Teams card, the season tabs, the
 * public squad card — and those differences are deliberate. What must NOT
 * differ is what happens when the stored object cannot be served (an expired
 * signed URL, a deleted file, a bucket blip): two of them fell back to the
 * team's initials and three printed the browser's broken-image glyph beside the
 * franchise's name. Every renderer now puts its image through here, so the
 * fallback is one behaviour, and each keeps its own look for both halves.
 *
 * Always decorative (`alt=""`): every caller prints the team's name beside it.
 * Width and height are required so the box is reserved before the file loads.
 */
export function CrestImage({
  src,
  fallback,
  width,
  height,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "onError" | "width" | "height"> & {
  src: string;
  /** What the renderer draws when there is no crest — shown if this one fails. */
  fallback: ReactNode;
  width: number;
  height: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  // Keyed by the URL: a NEW upload gets its chance even after the old one broke.
  if (failed === src) {
    return <>{fallback}</>;
  }
  return (
    <img
      {...rest}
      src={src}
      alt=""
      width={width}
      height={height}
      decoding="async"
      onError={() => {
        setFailed(src);
      }}
    />
  );
}
