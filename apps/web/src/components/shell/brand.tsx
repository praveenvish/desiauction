import Image from "next/image";

// The real DesiAuction artwork. It lives in the app (not @desiauction/ui) so the
// UI package stays asset-free — the shells take the mark as a `glyph` prop and
// fall back to their built-in vector glyph when nothing is passed.

/** The square DA mark. Fills its parent chip, which supplies size + radius. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/brand/mark.png"
      alt=""
      width={size}
      height={size}
      // The chip is already `aria-hidden`; the wordmark text carries the name.
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      priority
    />
  );
}

/** The full lockup (mark + "DESI AUCTION" + tagline), for large brand moments. */
export function BrandLockup({ width = 320 }: { width?: number }) {
  return (
    <Image
      src="/brand/lockup.png"
      alt="DesiAuction — bid, build, win"
      width={width}
      height={Math.round((width * 475) / 688)}
      style={{ width: "100%", height: "auto" }}
      priority
    />
  );
}
