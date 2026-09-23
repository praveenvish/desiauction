import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import { renderNotificationEmail, type NotificationMail } from "./notification-email";
import { REASON_HI } from "./whatsapp";

/**
 * THE PERSONAL MOMENTS — what a player and an owner are told.
 *
 * Every builder takes plain facts and the reader's language, and hands the
 * words to the template registry (notification-email.ts): the subject, the
 * paragraphs and the button labels are the published wording, or the code
 * default in packages/messaging (email-template-defaults.ts). What stays here
 * is what the CODE owns: which kind and variant, the button's URL, the facts
 * table, and the sentences whose grammar depends on the data — "Cup Kings,
 * Tigers and Falcons all bid for you" — written once per language and handed
 * over as variables. The data is gathered elsewhere (auction/outcome-mail.ts,
 * competition/appointments.ts), so the gallery and the tests render exactly
 * what is sent.
 *
 * The voice: warm, specific, never generic. "Cup Kings bought you for
 * ₹75,000 — three times your base" is the product's reason to exist, said to
 * the one person it matters most to.
 */

export type ComposedMail = NotificationMail;

export interface SquadLine {
  readonly name: string;
  /** "Captain", "Icon", "₹75,000", … — the one fact worth a second column. */
  readonly note: string;
}

/**
 * The squad notes are written in English where the facts are gathered
 * ("Captain · ₹25,000", "Arjun (you)"); a Hindi reader gets them in Hindi. Only
 * the closed set of words the gatherers use is translated — a name never is.
 */
const NOTE_HI: Readonly<Record<string, string>> = {
  Captain: "कप्तान",
  "Vice-captain": "उप-कप्तान",
  Icon: "आइकन",
  Retained: "रिटेन",
  Signed: "साइन",
  Player: "खिलाड़ी",
};

function localLine(line: SquadLine, language: MessageLanguage): readonly [string, string] {
  if (language === "en") return [line.name, line.note];
  const name = line.name.endsWith(" (you)") ? `${line.name.slice(0, -6)} (आप)` : line.name;
  const note = line.note
    .split(" · ")
    .map((part) => NOTE_HI[part] ?? part)
    .join(" · ");
  return [name, note];
}

function listWords(items: readonly string[], language: MessageLanguage = "en"): string {
  if (items.length <= 1) return items.join("");
  const and = language === "hi" ? "और" : "and";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1] ?? ""}`;
}

function seasonUrl(): string {
  return `${env.PUBLIC_BASE_URL}/home`;
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
  /** "You were the most expensive buy of the night", … */
  readonly highlight: string | null;
  /** The squad so far, the player included. */
  readonly squad: readonly SquadLine[];
  /** Their shareable player page, when the season is public and they are not a minor. */
  readonly cardUrl: string | null;
}

/** "Cup Kings, Tigers and Falcons all bid for you — 7 bids …" */
export function bidStory(facts: SoldFacts, language: MessageLanguage = "en"): string {
  const rivals = facts.bidders.filter((team) => team !== facts.teamName);
  const count = String(facts.bidCount);
  if (language === "hi") {
    if (rivals.length === 0) {
      return facts.bidCount <= 1
        ? `${facts.teamName} ने आपके बेस प्राइस ${facts.basePrice} पर बोली लगाई।`
        : `${facts.teamName} ने आप पर ${count} बार बोली लगाई और आपको ${facts.price} में जीता।`;
    }
    return `${listWords(facts.bidders, "hi")} — सबने आप पर बोली लगाई। कुल ${count} बोलियाँ लगीं, ${facts.basePrice} से ${facts.price} तक। ${facts.teamName} जीती।`;
  }
  if (rivals.length === 0) {
    return facts.bidCount <= 1
      ? `${facts.teamName} bid for you at your base price of ${facts.basePrice}.`
      : `${facts.teamName} bid for you ${count} times and won you at ${facts.price}.`;
  }
  const all = listWords(facts.bidders);
  return `${all} all bid for you — ${count} bids in all, from ${facts.basePrice} to ${facts.price}. ${facts.teamName} won.`;
}

/** The highlights the auction writes (auction/outcome-mail.ts), in Hindi. */
const HIGHLIGHT_HI: Readonly<Record<string, string>> = {
  "You were the most expensive buy of the night": "आप इस रात की सबसे महंगी खरीद रहे",
};

function multipleNote(multiple: number | null, language: MessageLanguage): string {
  if (multiple === null || multiple < 1.5) return "";
  const times = String(Math.round(multiple * 10) / 10);
  if (language === "hi") {
    return multiple >= 2
      ? ` — आपके बेस प्राइस का ${times} गुना`
      : " — आपके बेस प्राइस से कहीं ज़्यादा";
  }
  return ` — ${multiple >= 2 ? `${times} times` : "well above"} your base`;
}

export function soldMail(
  facts: SoldFacts,
  language: MessageLanguage = "en",
): Promise<ComposedMail> {
  const highlight =
    facts.highlight === null
      ? ""
      : language === "hi"
        ? (HIGHLIGHT_HI[facts.highlight] ?? facts.highlight)
        : facts.highlight;
  return renderNotificationEmail(
    "auction.sold",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      teamName: facts.teamName,
      price: facts.price,
      basePrice: facts.basePrice,
      multipleNote: multipleNote(facts.multiple, language),
      bidStory: bidStory(facts, language),
      highlight,
    },
    {
      details: facts.squad.map((line) => localLine(line, language)),
      action:
        facts.cardUrl === null
          ? { id: "season", url: seasonUrl() }
          : { id: "card", url: facts.cardUrl },
    },
  );
}

// --- Not picked -------------------------------------------------------------

export function unsoldMail(
  facts: {
    readonly name: string;
    readonly season: string;
    readonly orgName: string;
  },
  language: MessageLanguage = "en",
): Promise<ComposedMail> {
  // Said plainly and kindly. Never by SMS (founder decision): a text that
  // just says "unsold" lands too hard.
  return renderNotificationEmail(
    "auction.unsold",
    language,
    { name: facts.name, season: facts.season, orgName: facts.orgName },
    { action: { id: "season", url: seasonUrl() } },
  );
}

// --- Appointments ------------------------------------------------------------

export type AppointedRole = "captain" | "vice_captain" | "icon" | "retained";

/** Captain first: the order a person would say their own roles in. */
const ROLE_ORDER: readonly AppointedRole[] = ["captain", "vice_captain", "icon", "retained"];

const ROLE_WORDS: Record<
  MessageLanguage,
  Record<AppointedRole, { title: string; line: string }>
> = {
  en: {
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
  },
  hi: {
    captain: {
      title: "कप्तान",
      line: "आप टीम की अगुवाई करेंगे — माहौल बनाएँगे, टीम का हौसला बढ़ाएँगे, और करीबी मुकाबलों में जीत दिलाने वाले फ़ैसले लेंगे।",
    },
    vice_captain: {
      title: "उप-कप्तान",
      line: "आप कप्तान का साथ देंगे, और जब वे न हों तब टीम की अगुवाई करेंगे।",
    },
    icon: {
      title: "आइकन खिलाड़ी",
      line: "आइकन खिलाड़ी वे बड़े नाम होते हैं जिनके इर्द-गिर्द टीम बनाई जाती है।",
    },
    retained: {
      title: "रिटेन किए गए खिलाड़ी",
      line: "आपकी टीम ने आपको पिछले सीज़न से अपने साथ बनाए रखा है।",
    },
  },
};

/** The three marks that sign a player to a team without the auction. */
const PRE_SIGNING: ReadonlySet<AppointedRole> = new Set(["captain", "icon", "retained"]);

/** "captain", "captain and icon player", "captain, icon player and retained player". */
export function rolesTitle(
  roles: readonly AppointedRole[],
  language: MessageLanguage = "en",
): string {
  const titles = ROLE_ORDER.filter((role) => roles.includes(role)).map(
    (role) => ROLE_WORDS[language][role].title,
  );
  if (titles.length <= 1) return titles[0] ?? "";
  return listWords(titles, language);
}

/**
 * The roles as they fit ONE DLT variable (30 characters, templates.ts). The
 * full words first ("captain and icon player"); past the cap, the short words
 * ("vice-captain, icon and retained"); past that, the first role alone —
 * never a truncated phrase. English: the registered SMS text is English.
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
  return short.length <= max ? short : ROLE_WORDS.en[ordered[0] ?? "captain"].title;
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

export function appointmentMail(
  facts: AppointmentFacts,
  language: MessageLanguage = "en",
): Promise<ComposedMail> {
  const roles = ROLE_ORDER.filter((role) => facts.roles.includes(role));
  const signedDirect = !facts.bought && roles.some((role) => PRE_SIGNING.has(role));
  return renderNotificationEmail(
    "team.appointed",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      teamName: facts.teamName,
      roleTitle: rolesTitle(roles, language),
      roleLines: roles.map((role) => ROLE_WORDS[language][role].line),
      ifSignedDirect: signedDirect,
    },
    { action: { id: "season", url: seasonUrl() } },
  );
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
export function squadSheetMail(
  facts: SquadSheetFacts,
  language: MessageLanguage = "en",
): Promise<ComposedMail> {
  const coachClause =
    facts.coach === null
      ? ""
      : language === "hi"
        ? `, कोच ${facts.coach}`
        : `, coached by ${facts.coach}`;
  return renderNotificationEmail(
    "team.squad_sheet",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      teamName: facts.teamName,
      playerCount: String(facts.squad.length),
      coachClause,
      firstMatch: facts.firstMatch ?? "",
      ifNoFirstMatch: facts.firstMatch === null,
    },
    {
      details: [
        ...facts.squad.map((line) => localLine(line, language)),
        ...(facts.coach === null
          ? []
          : [[language === "hi" ? "कोच" : "Coach", facts.coach] as const]),
      ],
      action: { id: "season", url: seasonUrl() },
    },
  );
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
export function lineupMail(
  facts: LineupFacts,
  language: MessageLanguage = "en",
): Promise<ComposedMail> {
  const placeClause =
    facts.where === null ? "" : language === "hi" ? `, ${facts.where} में` : ` at ${facts.where}`;
  return renderNotificationEmail(
    "lineup.announced",
    language,
    {
      name: facts.name,
      season: facts.season,
      teamName: facts.teamName,
      opponent: facts.opponent,
      when: facts.when,
      placeClause,
    },
    {
      details: facts.lineup.map((line) => localLine(line, language)),
      action: { id: "season", url: seasonUrl() },
    },
  );
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

export function ownerSummaryMail(
  facts: OwnerSummaryFacts,
  language: MessageLanguage = "en",
): Promise<ComposedMail> {
  const short = facts.squadSize < facts.squadMin;
  const size = String(facts.squadSize);
  const range = `${String(facts.squadMin)}–${String(facts.squadMax)}`;
  const hi = language === "hi";
  return renderNotificationEmail(
    "auction.owner_summary",
    language,
    {
      name: facts.name,
      season: facts.season,
      teamName: facts.teamName,
      squadSize: size,
      spent: facts.spent,
      purseLeft: facts.purseLeft,
      squadMin: String(facts.squadMin),
      shortBy: short ? String(facts.squadMin - facts.squadSize) : "",
    },
    {
      details: [
        ...facts.squad.map((line) => localLine(line, language)),
        [hi ? "खर्च" : "Spent", facts.spent],
        [hi ? "बचा हुआ पर्स" : "Purse left", facts.purseLeft],
        [hi ? "टीम" : "Squad", hi ? `${range} में से ${size}` : `${size} of ${range}`],
      ],
      action: { id: "team", url: facts.teamUrl },
    },
  );
}

// --- Registration decisions -----------------------------------------------------

/** The five decisions a registrant is told about (competition/registration-notify.ts). */
export type RegistrationDecision = "approve" | "waitlist" | "reject" | "withdraw" | "restore";

const DECISION_KIND = {
  approve: "registration.approved",
  waitlist: "registration.waitlisted",
  reject: "registration.rejected",
  withdraw: "registration.withdrawn",
  restore: "registration.restored",
} as const;

export interface RegistrationDecisionFacts {
  readonly name: string;
  readonly season: string;
  readonly decision: RegistrationDecision;
  /** The rejection's reason in the player's words (REASON_TO_PLAYER), for `reject`. */
  readonly reason?: string;
}

/**
 * The decision by email — the same five moments the text carries, for the
 * person with a verified address. Until SMS is registered this IS the notice
 * for anybody who has not opted in to WhatsApp, so it says the decision in the
 * subject line: most people read that and nothing else.
 */
export function registrationDecisionMail(
  facts: RegistrationDecisionFacts,
  language: MessageLanguage = "en",
): Promise<ComposedMail> {
  const reason = facts.reason ?? "no reason was given";
  return renderNotificationEmail(
    DECISION_KIND[facts.decision],
    language,
    {
      name: facts.name,
      season: facts.season,
      reason: language === "hi" ? (REASON_HI[reason] ?? reason) : reason,
    },
    { action: { id: "registration", url: seasonUrl() } },
  );
}
