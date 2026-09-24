import type { PlayerPoster } from "@desiauction/core";

/**
 * THE MESSAGE THAT TRAVELS WITH THE LINK.
 *
 * A WhatsApp share is a sentence and a URL. The link preview carries the
 * picture; this carries the words a friend reads before they tap — and it is
 * the part a forwarded message keeps when the preview is stripped. So it says
 * the same thing the card says, in the same order: who, what happened, where.
 *
 * English and Hindi, because the group the card lands in chooses. No emoji: a
 * glyph that renders as a box on an older phone reads as a broken message.
 */

export type ShareLanguage = "en" | "hi";

const HI_PRESIGNED: Record<"icon" | "captain" | "retained", string> = {
  icon: "आइकन खिलाड़ी",
  captain: "कप्तान",
  retained: "रिटेन खिलाड़ी",
};

const EN_PRESIGNED: Record<"icon" | "captain" | "retained", string> = {
  icon: "Icon player",
  captain: "Captain",
  retained: "Retained",
};

export function playerShareMessage(model: PlayerPoster, language: ShareLanguage): string {
  const { name, competitionName: season, teamName: team } = model;
  if (language === "hi") {
    switch (model.outcome) {
      case "sold":
        return model.priceLabel !== null && team !== null
          ? `बिक गया! ${name} — ${team}, ${model.priceLabel} में। ${season}`
          : `बिक गया! ${name} — ${season}`;
      case "pool":
        return model.basePriceLabel !== null
          ? `${name} ${season} की नीलामी में है। बेस प्राइस ${model.basePriceLabel}। बोली लगाइए!`
          : `${name} ${season} की नीलामी में है। बोली लगाइए!`;
      case "icon":
      case "captain":
      case "retained":
        return team !== null
          ? `${name} — ${team} के ${HI_PRESIGNED[model.outcome]}। ${season}`
          : `${name} — ${HI_PRESIGNED[model.outcome]}। ${season}`;
      case "unsold":
        return `${name} — ${season}`;
    }
  }
  switch (model.outcome) {
    case "sold":
      return model.priceLabel !== null && team !== null
        ? `Sold! ${name} goes to ${team} for ${model.priceLabel}. ${season}`
        : `Sold! ${name}. ${season}`;
    case "pool":
      return model.basePriceLabel !== null
        ? `${name} is in the auction pool for ${season}. Base price ${model.basePriceLabel}. Bid for me!`
        : `${name} is in the auction pool for ${season}. Bid for me!`;
    case "icon":
    case "captain":
    case "retained":
      return team !== null
        ? `${name} — ${EN_PRESIGNED[model.outcome]}, ${team}. ${season}`
        : `${name} — ${EN_PRESIGNED[model.outcome]}. ${season}`;
    case "unsold":
      return `${name} — ${season}`;
  }
}

/**
 * Where a visit came from, stamped on the link it came through: `whatsapp` for
 * the message, `status` for the image, `link` for a copied address, `qr` for a
 * scanned poster. The public pages already carry `?ref` through to
 * registration, so the source reaches the one number that matters.
 */
export type ShareRef = "whatsapp" | "status" | "link" | "share" | "qr";

export function withRef(url: string, ref: ShareRef): string {
  if (url === "") {
    return "";
  }
  return `${url}${url.includes("?") ? "&" : "?"}ref=${ref}`;
}

/** A `wa.me` link that opens WhatsApp with the message and the link filled in. */
export function whatsappHref(message: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${message}\n${url}`)}`;
}

/** What a squad's share says — the facts on its card, in its order. */
export interface TeamShareFacts {
  readonly teamName: string;
  readonly competitionName: string;
  readonly playerCount: number;
  /** Formatted, or null when nothing was bought (a pre-signed-only squad). */
  readonly spentLabel: string | null;
  readonly topBuy: { readonly name: string; readonly priceLabel: string } | null;
}

export function teamShareMessage(facts: TeamShareFacts, language: ShareLanguage): string {
  const { teamName: team, competitionName: season, playerCount: n } = facts;
  if (n === 0) {
    return language === "hi"
      ? `${team} — ${season}। टीम नीलामी के बाद घोषित होगी।`
      : `${team} — ${season}. The squad is announced after the auction.`;
  }
  const top = facts.topBuy;
  if (language === "hi") {
    const spent = facts.spentLabel === null ? "" : `, ${facts.spentLabel} खर्च`;
    const lead = top === null ? "" : ` सबसे बड़ी खरीद: ${top.name}, ${top.priceLabel}।`;
    return `${team}: ${season} के लिए हमारी टीम — ${String(n)} खिलाड़ी${spent}।${lead}`;
  }
  const spent = facts.spentLabel === null ? "" : `, ${facts.spentLabel} spent`;
  const lead = top === null ? "" : ` Top buy: ${top.name} at ${top.priceLabel}.`;
  const players = n === 1 ? "1 player" : `${String(n)} players`;
  return `${team}: our squad for ${season} — ${players}${spent}.${lead}`;
}
