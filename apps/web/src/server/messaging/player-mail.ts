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

/** Captain first: the order a person would say their own roles in. */
const ROLE_ORDER: readonly AppointedRole[] = ["captain", "vice_captain", "icon", "retained"];

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
    line: "Icon players are the marquee names a team is built around.",
  },
  retained: {
    title: "retained player",
    line: "Your team kept you from last season.",
  },
};

/** The three marks that sign a player to a team without the auction. */
const PRE_SIGNING: ReadonlySet<AppointedRole> = new Set(["captain", "icon", "retained"]);

/** "captain", "captain and icon player", "captain, icon player and retained player". */
export function rolesTitle(roles: readonly AppointedRole[]): string {
  const titles = ROLE_ORDER.filter((role) => roles.includes(role)).map(
    (role) => ROLE_WORDS[role].title,
  );
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1] ?? ""}`;
}

/**
 * The roles as they fit ONE DLT variable (30 characters, templates.ts). The
 * full words first ("captain and icon player"); past the cap, the short words
 * ("vice-captain, icon and retained"); past that, the first role alone —
 * never a truncated phrase.
 */
export function smsRolePhrase(roles: readonly AppointedRole[], max = 30): string {
  const ordered = ROLE_ORDER.filter((role) => roles.includes(role));
  const full = rolesTitle(ordered);
  if (full.length <= max) return full;
  const SHORT: Record<AppointedRole, string> = {
    captain: "captain",
    vice_captain: "vice-captain",
    icon: "icon",
    retained: "retained",
  };
  const words = ordered.map((role) => SHORT[role]);
  const short =
    words.length <= 1
      ? (words[0] ?? "")
      : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
  return short.length <= max ? short : ROLE_WORDS[ordered[0] ?? "captain"].title;
}

export interface AppointmentFacts {
  readonly name: string;
  readonly season: string;
  readonly orgName: string;
  readonly teamName: string;
  /** Every role being announced now — one email, however many roles. */
  readonly roles: readonly AppointedRole[];
  /**
   * True when a sale in this season's auction put them on the team. Captain,
   * icon and retained sign a player DIRECTLY — but a captain named after being
   * bought went through the auction, and must not be told they skipped it.
   */
  readonly bought: boolean;
}

export function appointmentMail(facts: AppointmentFacts): ComposedMail {
  const roles = ROLE_ORDER.filter((role) => facts.roles.includes(role));
  const title = rolesTitle(roles);
  const signedDirect = !facts.bought && roles.some((role) => PRE_SIGNING.has(role));
  return {
    subject: `You're the ${title} of ${facts.teamName}`,
    ...renderEmail({
      preheader: `${facts.orgName} named you ${title} of ${facts.teamName} for ${facts.season}.`,
      heading: `You're the ${title} of ${facts.teamName}`,
      paragraphs: [
        `Congratulations, ${facts.name}!`,
        `${facts.orgName} has named you ${title} of ${facts.teamName} for ${facts.season}.`,
        ...roles.map((role) => ROLE_WORDS[role].line),
        ...(signedDirect
          ? [`You join ${facts.teamName} directly, without going through the auction.`]
          : []),
      ],
      action: { label: "See your season", url: `${env.PUBLIC_BASE_URL}/home` },
      footnote: `You received this because ${facts.orgName} named you in ${facts.season}. Switch off "Auction updates" in your account to stop these.`,
    }),
  };
}

// --- The squad sheet -----------------------------------------------------------

export interface SquadSheetFacts {
  readonly name: string;
  readonly season: string;
  readonly orgName: string;
  readonly teamName: string;
  /** The whole squad, the reader marked "(you)", roles as the note. */
  readonly squad: readonly SquadLine[];
  readonly coach: string | null;
  /** "vs Tigers · Sun, 4 Oct 2026, 7:30 am · Malad Ground", or null. */
  readonly firstMatch: string | null;
}

/**
 * "Meet your squad" — the whole team, the captain and coach named, the first
 * match. Sent when the organizer presses Send, after the auction: the one mail
 * every squad member gets, including the captain and icons, who never had a
 * sale to be told about.
 */
export function squadSheetMail(facts: SquadSheetFacts): ComposedMail {
  const count = facts.squad.length;
  return {
    subject: `Meet your ${facts.teamName} squad`,
    ...renderEmail({
      preheader: `${String(count)} players${facts.coach === null ? "" : `, coached by ${facts.coach}`} — the ${facts.teamName} squad for ${facts.season}.`,
      heading: `Meet your ${facts.teamName} squad`,
      paragraphs: [
        `Hi ${facts.name},`,
        `${facts.orgName} has set the ${facts.teamName} squad for ${facts.season}. Here is who you'll be playing with.`,
      ],
      details: [
        ...facts.squad.map((line) => [line.name, line.note] as const),
        ...(facts.coach === null ? [] : [["Coach", facts.coach] as const]),
      ],
      after: [
        facts.firstMatch === null
          ? `${facts.orgName} will share the fixtures soon.`
          : `Your first match: ${facts.firstMatch}.`,
      ],
      action: { label: "See your season", url: `${env.PUBLIC_BASE_URL}/home` },
      footnote: `You received this because you play for ${facts.teamName} in ${facts.season}. Switch off "Auction updates" in your account to stop these.`,
    }),
  };
}

// --- The lineup ------------------------------------------------------------------

export interface LineupFacts {
  readonly name: string;
  readonly season: string;
  readonly teamName: string;
  readonly opponent: string;
  /** "Sun, 4 Oct 2026, 7:30 pm" */
  readonly when: string;
  /** The ground, when the fixture has one. */
  readonly where: string | null;
  /** The whole lineup, the reader marked "(you)". */
  readonly lineup: readonly SquadLine[];
}

/** "You're in the Cup Kings lineup vs Tigers" — sent on the organizer's Announce. */
export function lineupMail(facts: LineupFacts): ComposedMail {
  const place = facts.where === null ? "" : ` at ${facts.where}`;
  return {
    subject: `You're in the ${facts.teamName} lineup vs ${facts.opponent}`,
    ...renderEmail({
      preheader: `${facts.when}${place} — ${facts.season}.`,
      heading: `You're in the ${facts.teamName} lineup`,
      paragraphs: [
        `Hi ${facts.name},`,
        `You're playing for ${facts.teamName} against ${facts.opponent} on ${facts.when}${place}. Here's the lineup.`,
      ],
      details: facts.lineup.map((line) => [line.name, line.note] as const),
      after: ["Good luck!"],
      action: { label: "See your season", url: `${env.PUBLIC_BASE_URL}/home` },
      footnote: `You received this because you play for ${facts.teamName} in ${facts.season}. Switch off "Auction updates" in your account to stop these.`,
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
