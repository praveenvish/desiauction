import { ImageResponse } from "next/og";

import { PRICING } from "../../content/marketing";
import { SHARE_IMAGE_SIZE, renderPricingCard } from "../c/[slug]/share-image-card";

// Social share card for `/pricing`. The page emitted ZERO og:/twitter: tags
// while `/` and `/c` each emitted seven, so the one link an organizer actually
// forwards — "here's what it costs" — previewed in WhatsApp as a bare URL.
//
// Reuses the share-card PLATFORM rather than starting a second one:
// `renderPricingCard` lives beside the competition and player renderers, on the
// same palette and the same floodlight wash, because those links land in the
// same group chat. Every string is read from PRICING, so this card cannot drift
// from the page it advertises — including the price, which is deliberately not
// on the card at all while no price is published.
//
// Static content, so no database and no per-request work: unlike the
// competition card this needs no visibility gate, because there is nothing here
// that is not already on a public page.

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "DesiAuction pricing — one pass per tournament";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    renderPricingCard({
      chip: "Public beta · everything free",
      title: PRICING.h1,
      // The em dash clause of PRICING.sub is the whole pitch; the card drops the
      // lead-in so the line fits one row at 30px.
      subtitle: "No subscriptions, no seats, no “contact sales”.",
      promise: PRICING.betaHeadline,
      // NO RUPEE SIGN. The first stat was `PRICING.tiers[0].price` ("₹0") and it
      // rasterised as a tofu box: Satori has no access to the app's webfonts and
      // its fallback sans has no U+20B9 glyph. A missing-character box on the
      // most-forwarded image the product makes is worse than dropping the
      // symbol, so the Free tier is named rather than priced — which says the
      // same thing in characters the renderer actually has. Mirrors
      // PRICING.tiers[0] (₹0 / "always"); the other two restate PRICING.sub.
      stats: [
        { value: "Free", label: `tier, ${PRICING.tiers[0]?.cadence ?? "always"}` },
        { value: "0", label: "subscriptions" },
        { value: "1", label: "pass per tournament" },
      ],
    }),
    { ...size },
  );
}
