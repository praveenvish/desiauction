import Image from "next/image";

import { BrandStrike } from "./brand-strike";
import "./brand.css";

// The DesiAuction vector identity. It lives in the app (not @desiauction/ui) so the
// UI package stays asset-free — the shells take the mark as a `glyph` prop and
// fall back to their built-in vector glyph when nothing is passed.
//
// ONE LOCKUP (founder, 2026-09-20): "the guest page one is final, with tagline."
// The public header's lockup — the DA mark, "Desi" + gold "Auction", and the
// tracked "THE GAME STARTS HERE" under it — is the only brand the product draws.
// Every surface (public header, console rail, live strip, onboarding, the big
// screen, the stream overlay) renders `BrandWordmark` / `BrandLockup` in one of
// the tones below, so a change to the brand is a change to this file.

/** The brand's one line. The console rail used to say "Bid · Build · Win". */
export const BRAND_TAGLINE = "THE GAME STARTS HERE";

/**
 * Where the lockup sits — each tone only sets the scale and the ink the surface
 * needs; the artwork, the words and their proportions never change.
 *
 * - `header`: the public site header (inherits the header's size).
 * - `rail`: the console's navy/warm sidebar.
 * - `bar`: the console's top bar on a phone (the same lockup as the rail, in heading ink).
 * - `footer`: the site footer — the console lockup's scale, in heading ink.
 * - `live`: the dark live-room strip (live, cockpit, spectate).
 * - `board`: the projected big screen — read from the back of a hall.
 * - `bug`: a small "powered by" corner on the broadcast overlay.
 * - `page`: a bare page with no shell (onboarding).
 */
export type BrandTone = "header" | "rail" | "bar" | "footer" | "live" | "board" | "bug" | "page";

/** The DA monogram. Vector artwork stays sharp at every shell size. */
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

/**
 * The words half of the lockup. Its accessible text is exactly "DesiAuction":
 * the tagline is `aria-hidden` (it is a brand line, not information), which is
 * what keeps a brand LINK named after where it goes — the axe `link-name` fix
 * in AppShell depends on these words staying in the DOM.
 */
export function BrandWordmark({ tone = "header" }: { tone?: BrandTone }) {
  return (
    <span className={`da-wordmark da-wordmark--${tone}`}>
      Desi<span className="da-wordmark-accent">Auction</span>
      <small className="da-wordmark-tagline" aria-hidden="true">
        {BRAND_TAGLINE}
      </small>
    </span>
  );
}

/**
 * Mark + words, for surfaces that have no shell chip to put the mark in (the
 * big screen, the overlay, onboarding). The mark is decorative; the words name
 * the product.
 */
export function BrandLockup({
  tone = "page",
  strike = "none",
}: {
  tone?: BrandTone;
  /**
   * The motion logo (brand-strike.tsx), for surfaces that open a night — the
   * board and the stream overlay. `once` strikes on mount; `sound` also
   * replays it with the sting when the person switches sound on.
   */
  strike?: "none" | "once" | "sound";
}) {
  return (
    <span className={`da-lockup da-lockup--${tone}`} data-testid="brand-lockup">
      <span className="da-lockup-mark" aria-hidden="true">
        {strike === "none" ? (
          <BrandMark size={64} />
        ) : (
          <BrandStrike replayOnSound={strike === "sound"} />
        )}
      </span>
      <BrandWordmark tone={tone} />
    </span>
  );
}
