import { env } from "../../env";
import { renderEmail } from "./email-layout";

/**
 * THE PERSONAL MOMENTS — what a player and an owner are told, in words.
 *
 * Pure: every builder takes plain facts and returns a subject, the HTML and the
 * plain-text part (email-layout.ts). The data is gathered elsewhere
 * (auction/outcome-mail.ts, competition/appointments.ts), so the gallery and
 * the tests render exactly what is sent without a database.
 *
 * The voice: warm, specific, never generic. "Cup Kings bought you for
 * ₹75,000 — three times your base" is the product's reason to exist, said to
 * the one person it matters most to.
 */

export interface ComposedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface SquadLine {
  readonly name: string;
  /** "Captain", "Icon", "₹75,000", … — the one fact worth a second column. */
  readonly note: string;
}

// --- The sale ---------------------------------------------------------------

export interface SoldFacts {
  readonly name: string;
  readonly season: string;
  readonly orgName: string;
  readonly teamName: string;
  /** Rupee strings, already formatted (₹75,000). */
  readonly price: string;
  readonly basePrice: string;
  /** Final ÷ base, when it is a story worth telling (≥ 1.5×). */
  readonly multiple: number | null;
  /** Teams that bid, first bidder first; includes the winner. */
  readonly bidders: readonly string[];
  readonly bidCount: number;
  /** "Most expensive buy of the night", "First player sold", … */
  readonly highlight: string | null;
  /** The squad so far, the player included. */
  readonly squad: readonly SquadLine[];
  /** Their shareable player page, when the season is public and they are not a minor. */
  readonly cardUrl: string | null;
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/** "Cup Kings, Tigers and Falcons all bid for you — 7 bids …" */
export function bidStory(facts: SoldFacts): string {
  const rivals = facts.bidders.filter((team) => team !== facts.teamName);
  if (rivals.length === 0) {
    return facts.bidCount <= 1
      ? `${facts.teamName} bid for you at your base price of ${facts.basePrice}.`
      : `${facts.teamName} bid for you ${String(facts.bidCount)} times and won you at ${facts.price}.`;
  }
  const all = listWords(facts.bidders);
  return `${all} all bid for you — ${String(facts.bidCount)} bids in all, from ${facts.basePrice} to ${facts.price}. ${facts.teamName} won.`;
}

export function soldMail(facts: SoldFacts): ComposedMail {
  const multiple =
    facts.multiple !== null && facts.multiple >= 1.5
      ? ` — ${facts.multiple >= 2 ? `${String(Math.round(facts.multiple * 10) / 10)} times` : "well above"} your base`
      : "";
  return {
    subject: `Congratulations — ${facts.teamName} bought you for ${facts.price}`,
    ...renderEmail({
      preheader: `${facts.teamName} bought you in the ${facts.season} auction.`,
      heading: `You're a ${facts.teamName} player`,
      paragraphs: [
        `Congratulations, ${facts.name}!`,
        `${facts.teamName} bought you for ${facts.price} in the ${facts.season} auction${multiple}.`,
        bidStory(facts),
        ...(facts.highlight === null ? [] : [`${facts.highlight}.`]),
      ],
      details: facts.squad.map((line) => [line.name, line.note] as const),
      after: [
        `That is your squad so far at ${facts.teamName}. Your organizer, ${facts.orgName}, will share fixtures next.`,
      ],
      action:
        facts.cardUrl === null
          ? { label: "See your season", url: `${env.PUBLIC_BASE_URL}/home` }
          : { label: "See your player card", url: facts.cardUrl },
      footnote: `You received this because you played in the ${facts.season} auction. Switch off "Auction updates" in your account to stop these.`,
    }),
  };
}

// --- Not picked -------------------------------------------------------------

export function unsoldMail(facts: {
  readonly name: string;
  readonly season: string;
  readonly orgName: string;
}): ComposedMail {
  return {
    // Said plainly and kindly. Never by SMS (founder decision): a text that
    // just says "unsold" lands too hard.
    subject: `Your ${facts.season} auction`,
    ...renderEmail({
      preheader: "You weren't picked this time — you're still registered.",
      heading: "Not this time",
      paragraphs: [
        `Hi ${facts.name},`,
        `The ${facts.season} auction has finished, and you weren't picked this time. That happens to good players on every auction night — squads fill up fast and teams plan around a few names.`,
        `You're still registered with ${facts.orgName}, and organizers often bring players in as replacements during the season.`,
      ],
      action: { label: "See your season", url: `${env.PUBLIC_BASE_URL}/home` },
      footnote: `You received this because you registered for ${facts.season}. Switch off "Auction updates" in your account to stop these.`,
    }),
  };
}

// --- Appointments ------------------------------------------------------------

export type AppointedRole = "captain" | "vice_captain" | "icon" | "retained";

const ROLE_WORDS: Record<AppointedRole, { title: string; line: string }> = {
  captain: {
    title: "captain",
    line: "You'll lead the side — setting the tone, rallying the team, and making the calls that win close games.",
  },
  vice_captain: {
    title: "vice-captain",
    line: "You'll back up the captain and lead the side whenever they can't.",
  },
  icon: {
    title: "icon player",
    line: "Icon players are the marquee names a team is built around. You're signed to the team before the auction — you won't go under the hammer.",
  },
  retained: {
    title: "retained player",
    line: "Your team kept you from last season. You're signed before the auction — you won't go under the hammer.",
  },
};

export function appointmentMail(facts: {
  readonly name: string;
  readonly season: string;
  readonly orgName: string;
  readonly teamName: string;
  readonly role: AppointedRole;
}): ComposedMail {
  const words = ROLE_WORDS[facts.role];
  return {
    subject: `You're the ${words.title} of ${facts.teamName}`,
    ...renderEmail({
      preheader: `${facts.orgName} named you ${words.title} of ${facts.teamName} for ${facts.season}.`,
      heading: `You're the ${words.title} of ${facts.teamName}`,
      paragraphs: [
        `Congratulations, ${facts.name}!`,
        `${facts.orgName} has named you ${words.title} of ${facts.teamName} for ${facts.season}.`,
        words.line,
      ],
      action: { label: "See your season", url: `${env.PUBLIC_BASE_URL}/home` },
      footnote: `You received this because ${facts.orgName} named you in ${facts.season}. Switch off "Auction updates" in your account to stop these.`,
    }),
  };
}

// --- The owner's night ---------------------------------------------------------

export interface OwnerSummaryFacts {
  readonly name: string;
  readonly season: string;
  readonly teamName: string;
  readonly squad: readonly SquadLine[];
  readonly spent: string;
  readonly purseLeft: string;
  readonly squadSize: number;
  readonly squadMin: number;
  readonly squadMax: number;
  readonly teamUrl: string;
}

export function ownerSummaryMail(facts: OwnerSummaryFacts): ComposedMail {
  const short = facts.squadSize < facts.squadMin;
  return {
    subject: `${facts.teamName}: your squad from the ${facts.season} auction`,
    ...renderEmail({
      preheader: `${String(facts.squadSize)} players · ${facts.spent} spent · ${facts.purseLeft} left.`,
      heading: `Your ${facts.teamName} squad`,
      paragraphs: [
        `Hi ${facts.name},`,
        `The ${facts.season} auction is done. Here is the squad you built, with what you paid for each player.`,
      ],
      details: [
        ...facts.squad.map((line) => [line.name, line.note] as const),
        ["Spent", facts.spent],
        ["Purse left", facts.purseLeft],
        [
          "Squad",
          `${String(facts.squadSize)} of ${String(facts.squadMin)}–${String(facts.squadMax)}`,
        ],
      ],
      after: short
        ? [
            `Your squad is ${String(facts.squadMin - facts.squadSize)} short of the minimum of ${String(facts.squadMin)}. Your organizer will tell you how the gap is filled.`,
          ]
        : [],
      action: { label: "Open your team", url: facts.teamUrl },
      footnote: `You received this because you own ${facts.teamName} in ${facts.season}.`,
    }),
  };
}
