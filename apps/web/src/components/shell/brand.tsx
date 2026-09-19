import Image from "next/image";

// The DesiAuction vector identity. It lives in the app (not @desiauction/ui) so the
// UI package stays asset-free — the shells take the mark as a `glyph` prop and
// fall back to their built-in vector glyph when nothing is passed.

/** The sport-neutral DA monogram. Vector artwork stays sharp at every shell size. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/brand/mark.svg"
      alt=""
      width={size}
      height={size}
      // The chip is already `aria-hidden`; the wordmark text carries the name.
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      priority
    />
  );
}

/** The same vector identity in a larger, accessible lockup. */
export function BrandLockup({ width = 320 }: { width?: number }) {
  return (
    <div
      role="img"
      aria-label="DesiAuction — the game starts here"
      style={{ width, maxWidth: "100%", display: "flex", alignItems: "center", gap: 14 }}
    >
      <span style={{ width: "21%", flexShrink: 0 }}>
        <BrandMark size={72} />
      </span>
      <span
        style={{
          fontFamily: "var(--font-text)",
          color: "var(--text-heading)",
          fontWeight: 600,
          fontSize: "clamp(20px, 4vw, 32px)",
          letterSpacing: "-.015em",
          lineHeight: 1.15,
        }}
      >
        Desi<span style={{ color: "var(--text-accent)" }}>Auction</span>
        <span
          style={{
            display: "block",
            marginTop: 8,
            fontFamily: "var(--font-text)",
            fontSize: 8,
            letterSpacing: ".17em",
            fontWeight: 500,
            color: "var(--text-secondary)",
          }}
        >
          THE GAME STARTS HERE
        </span>
      </span>
    </div>
  );
}
