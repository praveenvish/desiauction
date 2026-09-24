import { describe, expect, it } from "vitest";

import { financeDocumentMail, financeVariantFor } from "@desiauction/messaging/email-adapter";
import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { defaultContent } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import * as codes from "../auth/email-sender";
import type { CodeMailPurpose } from "../auth/email-sender";
import * as security from "../auth/email-changed-notice";
import * as booking from "../marketing/demo-booking-mail";
import type { BookingMailInput } from "../marketing/demo-booking-mail";
import { whenWords } from "../marketing/demo-booking-mail";
import * as demo from "../marketing/demo-mail";
import type { ValidDemoRequest } from "../marketing/demo-requests";
import * as reviews from "../reviews/review-mail";
import type { AskAudience } from "../reviews/review-mail";
import { REVIEW_LINK_TTL_MS, type ValidReview } from "../reviews/reviews";
import * as support from "../support/problem-report-mail";
import { CATEGORY_WORDS } from "../support/problem-report-mail";
import type { ValidProblemReport } from "../support/problem-reports";
import { SUPPORT_EMAIL, renderEmail } from "./email-layout";
import * as player from "./player-mail";
import type {
  AppointedRole,
  AppointmentFacts,
  LineupFacts,
  OwnerSummaryFacts,
  RegistrationDecision,
  RegistrationDecisionFacts,
  SoldFacts,
  SquadSheetFacts,
} from "./player-mail";

/**
 * PARITY: MOVING THE WORDS INTO THE TEMPLATE REGISTRY CHANGED NOTHING SENT.
 *
 * Phase 2 of the Notification Control Center lifted every email's English out
 * of the function that sent it and into packages/messaging
 * (email-template-defaults.ts), with `{{variable}}` placeholders and
 * conditional paragraphs. The claim is that, with nothing published, every
 * mail is byte-for-byte what it was. So the renderers as they stood before the
 * move are frozen below, VERBATIM (git show 42b7e29c), and each kind is
 * rendered both ways across its branches — card or no card, a coach or none,
 * every registration decision, every code purpose — and compared: subject,
 * plain text and HTML.
 *
 * The frozen copies are test code and never ship. When a DEFAULT is changed on
 * purpose, change the frozen copy with it, in the same commit, and say why.
 */

type ComposedMail = { subject: string; text: string; html: string };
const PUBLIC = env.PUBLIC_BASE_URL;

// ---------------------------------------------------------------------------
// The renderers as they were (frozen).
// ---------------------------------------------------------------------------

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

function bidStory(facts: SoldFacts): string {
  const rivals = facts.bidders.filter((team) => team !== facts.teamName);
  if (rivals.length === 0) {
    return facts.bidCount <= 1
      ? `${facts.teamName} bid for you at your base price of ${facts.basePrice}.`
      : `${facts.teamName} bid for you ${String(facts.bidCount)} times and won you at ${facts.price}.`;
  }
  const all = listWords(facts.bidders);
  return `${all} all bid for you — ${String(facts.bidCount)} bids in all, from ${facts.basePrice} to ${facts.price}. ${facts.teamName} won.`;
}

function soldMail(facts: SoldFacts): ComposedMail {
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
        // Changed on purpose (share nudges, 2026-09-24): a public card is
        // offered to SHARE on the night it was bought, not only to look at.
        ...(facts.cardUrl === null
          ? []
          : [
              "Your player card is ready. Share it with your groups or post it to your Status — the button below does both.",
            ]),
      ],
      details: facts.squad.map((line) => [line.name, line.note] as const),
      after: [
        `That is your squad so far at ${facts.teamName}. Your organizer, ${facts.orgName}, will share fixtures next.`,
      ],
      action:
        facts.cardUrl === null
          ? { label: "See your season", url: `${PUBLIC}/home` }
          : { label: "Share your player card", url: facts.cardUrl },
      footnote: `You received this because you played in the ${facts.season} auction. Switch off "Auction updates" in your account to stop these.`,
      whatsappNudge: true,
    }),
  };
}

function unsoldMail(facts: {
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
      action: { label: "See your season", url: `${PUBLIC}/home` },
      footnote: `You received this because you registered for ${facts.season}. Switch off "Auction updates" in your account to stop these.`,
    }),
  };
}

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

const PRE_SIGNING: ReadonlySet<AppointedRole> = new Set(["captain", "icon", "retained"]);

/** "captain", "captain and icon player", "captain, icon player and retained player". */
function rolesTitle(roles: readonly AppointedRole[]): string {
  const titles = ROLE_ORDER.filter((role) => roles.includes(role)).map(
    (role) => ROLE_WORDS[role].title,
  );
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1] ?? ""}`;
}

function appointmentMail(facts: AppointmentFacts): ComposedMail {
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
      action: { label: "See your season", url: `${PUBLIC}/home` },
      footnote: `You received this because ${facts.orgName} named you in ${facts.season}. Switch off "Auction updates" in your account to stop these.`,
      whatsappNudge: true,
    }),
  };
}

function squadSheetMail(facts: SquadSheetFacts): ComposedMail {
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
      action: { label: "See your season", url: `${PUBLIC}/home` },
      footnote: `You received this because you play for ${facts.teamName} in ${facts.season}. Switch off "Auction updates" in your account to stop these.`,
    }),
  };
}

function lineupMail(facts: LineupFacts): ComposedMail {
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
      action: { label: "See your season", url: `${PUBLIC}/home` },
      footnote: `You received this because you play for ${facts.teamName} in ${facts.season}. Switch off "Auction updates" in your account to stop these.`,
      whatsappNudge: true,
    }),
  };
}

function ownerSummaryMail(facts: OwnerSummaryFacts): ComposedMail {
  const short = facts.squadSize < facts.squadMin;
  return {
    subject: `${facts.teamName}: your squad from the ${facts.season} auction`,
    ...renderEmail({
      preheader: `${String(facts.squadSize)} players · ${facts.spent} spent · ${facts.purseLeft} left.`,
      heading: `Your ${facts.teamName} squad`,
      paragraphs: [
        `Hi ${facts.name},`,
        `The ${facts.season} auction is done. Here is the squad you built, with what you paid for each player.`,
        // Changed on purpose (share nudges, 2026-09-24): a public season's
        // owner is asked to share the squad page, and the button opens it.
        ...(facts.shareUrl === undefined || facts.shareUrl === null
          ? []
          : ["Your squad card is ready. Send it to your team group or post it to your Status."]),
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
      action:
        facts.shareUrl === undefined || facts.shareUrl === null
          ? { label: "Open your team", url: facts.teamUrl }
          : { label: "Share your squad", url: facts.shareUrl },
      footnote: `You received this because you own ${facts.teamName} in ${facts.season}.`,
    }),
  };
}

function registrationDecisionMail(facts: RegistrationDecisionFacts): ComposedMail {
  const { season } = facts;
  const copy: Record<
    RegistrationDecision,
    { subject: string; heading: string; lines: readonly string[] }
  > = {
    approve: {
      subject: `You're approved for ${season}`,
      heading: "You're in",
      lines: [
        `Your registration for ${season} is approved. You're in the player pool for auction day.`,
      ],
    },
    waitlist: {
      subject: `You're on the waitlist for ${season}`,
      heading: "You're on the waitlist",
      lines: [
        `Your registration for ${season} is on the waitlist. The organizer moves players up if a place opens, and we'll tell you if that happens.`,
      ],
    },
    reject: {
      subject: `Your registration for ${season} wasn't approved`,
      heading: "Your registration wasn't approved",
      lines: [
        `Your registration for ${season} was not approved.`,
        `The reason given: ${facts.reason ?? "no reason was given"}.`,
      ],
    },
    withdraw: {
      subject: `Your registration for ${season} was withdrawn`,
      heading: "Your registration was withdrawn",
      lines: [
        `Your registration for ${season} was withdrawn. You can register again while registration is open.`,
      ],
    },
    restore: {
      subject: `Your registration for ${season} is back under review`,
      heading: "Back under review",
      lines: [
        `Your registration for ${season} is back under review. We'll tell you what the organizer decides.`,
      ],
    },
  };
  const chosen = copy[facts.decision];
  return {
    subject: chosen.subject,
    ...renderEmail({
      preheader: chosen.lines[0] ?? chosen.heading,
      heading: chosen.heading,
      paragraphs: [`Hi ${facts.name},`, ...chosen.lines],
      action: { label: "See your registration", url: `${PUBLIC}/home` },
      footnote: `You received this because you registered for ${season}. Switch off "Registration decisions" in your account to stop these.`,
      whatsappNudge: true,
    }),
  };
}

function codeMailCopy(
  code: string,
  purpose: CodeMailPurpose,
): { subject: string; text: string; html: string } {
  if (purpose === "signup") {
    /*
     * A DIFFERENT PERSON IS READING THIS. "Sign-in code" to somebody who has no
     * account reads as a mistake or a breach, and the closing sentence of the
     * login copy — "your account is safe" — is about an account that does not
     * exist. Both halves have to change together.
     */
    return {
      subject: "Your DesiAuction sign-up code",
      ...renderEmail({
        preheader: `Your sign-up code is ${code}. It expires in 15 minutes.`,
        heading: "Welcome to DesiAuction",
        paragraphs: ["Your sign-up code is:"],
        code,
        after: [
          "It expires in 15 minutes. Entering it creates your account on this address.",
          "If you did not ask for this, ignore this message — nothing is created until the code is used.",
        ],
        footnote: "You received this because this address was entered on our sign-up page.",
        noLinks: true,
      }),
    };
  }
  if (purpose === "login") {
    return {
      subject: "Your DesiAuction sign-in code",
      ...renderEmail({
        preheader: `Your sign-in code is ${code}. It expires in 15 minutes.`,
        heading: "Your sign-in code",
        paragraphs: ["Your DesiAuction sign-in code is:"],
        code,
        after: [
          "It expires in 15 minutes.",
          "If you did not try to sign in, someone entered your address on our sign-in page. Your account is safe as long as you do not share this code.",
        ],
        footnote: "You received this because this address was entered on our sign-in page.",
        noLinks: true,
      }),
    };
  }
  return {
    subject: "Confirm your email for DesiAuction",
    ...renderEmail({
      preheader: `Your confirmation code is ${code}.`,
      heading: "Confirm your email",
      paragraphs: [`Your DesiAuction confirmation code is ${code}.`],
      code,
      after: [
        "Enter it on your account page to confirm this address. It expires in 15 minutes.",
        "If you did not ask for this, ignore this message.",
      ],
      footnote: "You received this because this address was added to a DesiAuction account.",
      noLinks: true,
    }),
  };
}

function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) {
    return "•••";
  }
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

function emailChangedCopy(newEmail: string): {
  subject: string;
  text: string;
  html: string;
} {
  const masked = maskEmail(newEmail);
  return {
    subject: "Your DesiAuction sign-in email was changed",
    ...renderEmail({
      preheader: `This account now signs in with ${masked}.`,
      heading: "Your sign-in email was changed",
      paragraphs: [
        `The DesiAuction account that used this address now signs in with ${masked}. Codes and account mail go there from now on, and every other device was signed out.`,
        "If that was you, there is nothing to do.",
      ],
      after: [
        `If it wasn't you, somebody may have reached your account. Write to ${SUPPORT_EMAIL} straight away from this address and we will help you get it back.`,
      ],
      action: { label: "Get help", url: `${PUBLIC}/support` },
      footnote:
        "You received this because this address was the sign-in email on a DesiAuction account until a moment ago.",
    }),
  };
}

function phoneChangedCopy(last4: string): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: "Your DesiAuction mobile number was changed",
    ...renderEmail({
      preheader: `This account's mobile number now ends ${last4}.`,
      heading: "Your mobile number was changed",
      paragraphs: [
        `The mobile number on your DesiAuction account was changed to one ending ${last4}. Sign-in codes and texts go there from now on, and every other device was signed out.`,
        "If that was you, there is nothing to do.",
      ],
      after: [
        `If it wasn't you, somebody may have reached your account. Write to ${SUPPORT_EMAIL} straight away from this address and we will help you get it back.`,
      ],
      action: { label: "Get help", url: `${PUBLIC}/support` },
      footnote:
        "You received this because this is the verified email on a DesiAuction account whose mobile number just changed.",
    }),
  };
}

const SIZE_WORDS: Record<string, string> = {
  "under-8": "under 8 teams",
  "8-16": "8–16 teams",
  "16-32": "16–32 teams",
  "over-32": "over 32 teams",
  unsure: "not sure yet",
};

const WINDOW_WORDS: Record<string, string> = {
  "weekday-evening": "weekday evenings",
  "weekend-morning": "weekend mornings",
  "weekend-evening": "weekend evenings",
  any: "any time",
};

function requesterAcknowledgement(request: ValidDemoRequest): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: "We've got your demo request — DesiAuction",
    ...renderEmail({
      preheader: "We'll get back to you within one working day to fix a time.",
      heading: "We've got your demo request",
      paragraphs: [
        "Hello,",
        "Thanks for asking about a demo of DesiAuction. We'll get back to you within one working day to fix a time.",
      ],
      details: [
        ["Tournament size", SIZE_WORDS[request.tournamentSize] ?? "not sure yet"],
        ["Auction date", request.auctionOn ?? "not fixed yet"],
        ["Best time to talk", WINDOW_WORDS[request.preferredWindow] ?? "any time"],
      ],
      after: [
        "The demo is a live walkthrough of a real auction — squads, the bidding, the gavel, and the money afterwards — on a tournament we've already run, so you see the whole night rather than an empty screen.",
        "In a hurry? You don't have to wait for us: every tournament gets the full platform free during beta.",
        "Didn't ask for this? Somebody typed your address into our demo form. You can ignore this email — we won't write again unless you reply.",
      ],
      action: { label: "Start free", url: `${PUBLIC}/login` },
      footnote: `You received this because this address was entered on our demo request form. Write to ${SUPPORT_EMAIL} if anything changes.`,
    }),
  };
}

function founderNotification(
  request: ValidDemoRequest,
  requestId: string,
): { subject: string; text: string } {
  return {
    subject: `Demo request — ${request.orgName} (${SIZE_WORDS[request.tournamentSize] ?? request.tournamentSize})`,
    text: [
      `${request.name} · ${request.phone}${request.email === null ? "" : ` · ${request.email}`}`,
      `${request.orgName} — ${SIZE_WORDS[request.tournamentSize] ?? request.tournamentSize}`,
      request.auctionOn === null ? "Auction: no date yet" : `Auction: ${request.auctionOn}`,
      `Prefers: ${WINDOW_WORDS[request.preferredWindow] ?? request.preferredWindow}`,
      `Came from: ${request.source}`,
      "",
      request.note === null ? "(no note)" : request.note,
      "",
      `${PUBLIC}/admin/demos#${requestId}`,
    ].join("\n"),
  };
}

function bookingUrl(token: string): string {
  return `${PUBLIC}/demo/${token}`;
}

function bookingConfirmationMail(input: BookingMailInput): ComposedMail {
  const when = whenWords(input.slotStart);
  return {
    subject: `Your DesiAuction demo — ${when}`,
    ...renderEmail({
      preheader: `You're booked in for ${when}. The calendar invite is attached.`,
      heading: "Your demo is booked",
      paragraphs: ["Hello,", `You're booked in for ${when}.`],
      details: [
        ["When", when],
        ["How", "We call the number you gave us"],
        ["Length", "About twenty minutes"],
      ],
      after: [
        "We'll walk through a real auction end to end — squads and purses, the bidding, the gavel, and the settlement afterwards. The calendar invite is attached.",
      ],
      action: { label: "Move or cancel", url: bookingUrl(input.token) },
      footnote: "You received this because you booked a DesiAuction demo.",
    }),
  };
}

function bookingCancellationMail(input: BookingMailInput): ComposedMail {
  const when = whenWords(input.slotStart);
  return {
    subject: `Cancelled: your DesiAuction demo — ${when}`,
    ...renderEmail({
      preheader: `The demo on ${when} is cancelled.`,
      heading: "Your demo is cancelled",
      paragraphs: ["Hello,", `The demo on ${when} is cancelled and nobody will call.`],
      action: { label: "Pick another time", url: `${PUBLIC}/schedule-demo` },
      footnote:
        "You received this because a DesiAuction demo booked with this address was cancelled.",
    }),
  };
}

function bookingReminderMail(input: BookingMailInput, hoursAhead: 24 | 1): ComposedMail {
  const when = whenWords(input.slotStart);
  return {
    subject:
      hoursAhead === 24
        ? `Tomorrow: your DesiAuction demo — ${when}`
        : `In an hour: your DesiAuction demo`,
    ...renderEmail({
      preheader: hoursAhead === 24 ? `We're speaking ${when}.` : `We're calling in about an hour.`,
      heading: hoursAhead === 24 ? "Your demo is tomorrow" : "Your demo is in an hour",
      paragraphs: [
        "Hello,",
        hoursAhead === 24
          ? `A reminder that we're speaking ${when}. We'll call the number you gave us.`
          : `We're calling in about an hour, at ${when}.`,
      ],
      action: { label: "Can't make it? Move or cancel", url: bookingUrl(input.token) },
      footnote: "You received this because you booked a DesiAuction demo.",
    }),
  };
}

const OPENING: Record<AskAudience, readonly string[]> = {
  organizer: [
    "You've run a tournament on DesiAuction, and we'd like to know how it went — what",
    "worked, and what got in your way. It takes two minutes:",
  ],
  owner: [
    "You bid for a team in an auction on DesiAuction, and we'd like to know how it went",
    "from your side of the room — what worked, and what got in your way. Two minutes:",
  ],
  general: [
    "You've used DesiAuction, and we'd like to know how it went — what worked, and what",
    "got in your way. It takes two minutes:",
  ],
};

function reviewAskMail(
  name: string | null,
  link: string,
  audience: AskAudience = "general",
): { subject: string; text: string; html: string } {
  const days = Math.round(REVIEW_LINK_TTL_MS / 86_400_000);
  return {
    subject: "How has DesiAuction worked for you?",
    ...renderEmail({
      preheader: "Two minutes on what worked and what got in your way.",
      heading: "How has DesiAuction worked for you?",
      paragraphs: [name === null ? "Hi," : `Hi ${name},`, OPENING[audience].join(" ")],
      action: { label: "Write your review", url: link },
      actionFirst: true,
      after: [
        `The link is yours and works for ${String(days)} days. Nothing you write is shown to anyone unless you tick the box that says we may quote it.`,
        `Don't want to be asked? Switch off "Feedback requests" in your account settings: ${PUBLIC}/account`,
      ],
      footnote: "You received this because you used DesiAuction recently.",
    }),
  };
}

function reviewArrivedMail(
  review: ValidReview,
  personName: string | null,
): { subject: string; text: string } {
  return {
    subject: `[Review] ${String(review.rating)}/5 from ${personName ?? "a customer"}`,
    text: [
      `${String(review.rating)}/5 — ${personName ?? "name not on file"}`,
      review.mayQuote
        ? `May quote, signed: ${review.displayName ?? ""}${review.displayOrg === null ? "" : `, ${review.displayOrg}`}`
        : "Not for quoting.",
      "",
      "What went well:",
      review.wentWell ?? "(nothing written)",
      "",
      "What to improve:",
      review.improve ?? "(nothing written)",
      "",
      `${PUBLIC}/admin/reviews`,
    ].join("\n"),
  };
}

function seasonAskMail(input: {
  name: string | null;
  seasonName: string;
  orgName: string;
  role: "player" | "owner";
  link: string;
}): { subject: string; text: string; html: string } {
  const days = Math.round(REVIEW_LINK_TTL_MS / 86_400_000);
  // Season and club names are organizer-typed; keep the subject to one line.
  const season = input.seasonName.replace(/[\r\n]+/g, " ").slice(0, 80);
  return {
    subject: `How was ${season}?`,
    ...renderEmail({
      preheader: `Two minutes on ${season} — for the players and owners deciding on next season.`,
      heading: `How was ${season}?`,
      paragraphs: [
        input.name === null ? "Hi," : `Hi ${input.name},`,
        input.role === "owner"
          ? `You bid for a team in ${season}, run by ${input.orgName}. How did it go? Other players and owners deciding whether to join next time would like to know.`
          : `You played in ${season}, run by ${input.orgName}. How did it go? Other players and owners deciding whether to join next time would like to know.`,
      ],
      action: { label: "Review the season", url: input.link },
      actionFirst: true,
      after: [
        `Once our team has read it, your review may appear on the season's public page. It carries your name only if you tick the box that says so; otherwise it says ${input.role === "owner" ? '"A team owner"' : '"A player"'}.`,
        `The link is yours and works for ${String(days)} days. Don't want to be asked? Switch off "Feedback requests" at ${PUBLIC}/account`,
      ],
      footnote: `You received this because you took part in ${season} on DesiAuction.`,
    }),
  };
}

function firstLine(text: string, limit = 70): string {
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

function supportNotification(
  report: ValidProblemReport,
  reportId: string,
  reporterLabel: string,
): { subject: string; text: string } {
  const contextLines = Object.entries(report.context).map(([key, value]) => `  ${key}: ${value}`);
  return {
    subject: `[Report] ${CATEGORY_WORDS[report.category]} — ${firstLine(report.description)}`,
    text: [
      `${CATEGORY_WORDS[report.category]}, from ${reporterLabel}`,
      report.replyEmail === null ? "No reply address given." : `Reply to: ${report.replyEmail}`,
      "",
      `Page: ${report.pageUrl}`,
      ...(contextLines.length > 0 ? ["", "Context:", ...contextLines] : []),
      "",
      report.description,
      "",
      report.screenshot === null ? "No screenshot." : "Screenshot attached.",
      "",
      `${PUBLIC}/admin/reports#${reportId}`,
    ].join("\n"),
  };
}

function reporterAcknowledgement(report: ValidProblemReport): {
  subject: string;
  text: string;
} {
  return {
    subject: "We've got your report — DesiAuction",
    text: [
      "Hi,",
      "",
      "Thanks for telling us. Your report has reached the team, with the page you were on",
      report.screenshot === null ? "so we can look at it." : "and the screenshot you sent.",
      "",
      // The description is NOT repeated here. This mail goes to an address the
      // form was given, and repeating what was typed turned the form into a
      // way to send any text, from us, to anyone ("your account is suspended,
      // verify at…"). The team has the words; the reporter wrote them.
      "We read every report. If we need more detail, or once it's fixed, we'll write back",
      "to this address.",
      "",
      `If it's urgent — an auction is live right now — write to ${SUPPORT_EMAIL} and say so`,
      "in the subject line.",
      "",
      "— DesiAuction",
    ].join("\n"),
  };
}

function subjectFor(templateId: string): string {
  const known: Record<string, string> = {
    "receipt.issued": "Your receipt from DesiAuction",
    "invoice.issued": "Your invoice from DesiAuction",
    "correction.issued": "A corrected document from DesiAuction",
  };
  return known[templateId] ?? "A document from DesiAuction";
}

// ---------------------------------------------------------------------------
// Both ways, across every branch.
// ---------------------------------------------------------------------------

function same(
  now: { subject: string; text: string; html?: string },
  before: { subject: string; text: string; html?: string },
): void {
  expect(now.subject).toBe(before.subject);
  expect(now.text).toBe(before.text);
  expect(now.html).toBe(before.html);
}

const squad = [
  { name: "Arjun Sharma", note: "₹75,000" },
  { name: "Vikram Patel", note: "Captain · ₹25,000" },
];

const sale: SoldFacts = {
  name: "Arjun",
  season: "Malad Premier League 2026",
  orgName: "Malad Cricket Club",
  teamName: "Cup Kings",
  price: "₹75,000",
  basePrice: "₹25,000",
  multiple: 3,
  bidders: ["Tigers", "Cup Kings", "Falcons"],
  bidCount: 7,
  highlight: "You were the most expensive buy of the night",
  squad,
  cardUrl: "https://desiauction.in/c/mpl/p/R8KQ2X1",
};

describe("the player's season renders exactly as before", () => {
  const sales: SoldFacts[] = [
    sale,
    { ...sale, cardUrl: null, highlight: null },
    { ...sale, multiple: 1.6, bidders: ["Cup Kings"], bidCount: 1 },
    { ...sale, multiple: null, bidders: ["Cup Kings"], bidCount: 4, squad: [] },
    // A name that looks like a placeholder is printed, never expanded.
    { ...sale, name: "{{price}} <b>&", teamName: "Tigers & Co" },
  ];
  it.each(sales.map((facts, i) => [i, facts] as const))("sold, case %i", async (_i, facts) => {
    same(await player.soldMail(facts), soldMail(facts));
  });

  it("unsold", async () => {
    const facts = { name: "Rohit", season: "MPL 2026", orgName: "Malad CC" };
    same(await player.unsoldMail(facts), unsoldMail(facts));
  });

  const appointments: AppointmentFacts[] = (
    [
      [["captain"], false],
      [["vice_captain"], false],
      [["icon", "captain"], false],
      [["captain"], true],
      [["retained", "icon", "captain", "vice_captain"], false],
    ] as const
  ).map(([roles, bought]) => ({
    name: "Arjun",
    season: "MPL 2026",
    orgName: "Malad CC",
    teamName: "Cup Kings",
    roles: roles as readonly AppointedRole[],
    bought,
  }));
  it.each(appointments.map((facts) => [facts.roles.join("+"), facts] as const))(
    "appointed: %s",
    async (_roles, facts) => {
      same(await player.appointmentMail(facts), appointmentMail(facts));
    },
  );

  const sheets: SquadSheetFacts[] = [
    {
      name: "Arjun",
      season: "MPL 2026",
      orgName: "Malad CC",
      teamName: "Cup Kings",
      squad: [{ name: "Arjun Sharma (you)", note: "Player" }, ...squad],
      coach: "Ravi Shastri",
      firstMatch: "vs Tigers · Sun, 4 Oct 2026, 7:30 am · Malad Ground",
    },
    {
      name: "Arjun",
      season: "MPL 2026",
      orgName: "Malad CC",
      teamName: "Cup Kings",
      squad,
      coach: null,
      firstMatch: null,
    },
  ];
  it.each(sheets.map((facts, i) => [i, facts] as const))("squad sheet, case %i", async (_i, f) => {
    same(await player.squadSheetMail(f), squadSheetMail(f));
  });

  const lineups: LineupFacts[] = [
    {
      name: "Arjun",
      season: "MPL 2026",
      teamName: "Cup Kings",
      opponent: "Tigers",
      when: "Sun, 4 Oct 2026, 7:30 pm",
      where: "Malad Ground",
      lineup: [{ name: "Arjun (you)", note: "Captain" }],
    },
    {
      name: "Arjun",
      season: "MPL 2026",
      teamName: "Cup Kings",
      opponent: "Tigers",
      when: "Sun, 4 Oct 2026, 7:30 pm",
      where: null,
      lineup: [],
    },
  ];
  it.each(lineups.map((facts, i) => [i, facts] as const))("lineup, case %i", async (_i, f) => {
    same(await player.lineupMail(f), lineupMail(f));
  });

  const owners: OwnerSummaryFacts[] = [
    // A public season: the owner is asked to share, and the button opens the squad page.
    {
      name: "Priya",
      season: "MPL 2026",
      teamName: "Cup Kings",
      squad,
      spent: "₹1,00,000",
      purseLeft: "₹1,99,00,000",
      squadSize: 2,
      squadMin: 2,
      squadMax: 15,
      teamUrl: "https://desiauction.in/seasons/mpl/teams",
      shareUrl: "https://desiauction.in/c/mpl/t/cup-kings?ref=email",
    },
    {
      name: "Priya",
      season: "MPL 2026",
      teamName: "Cup Kings",
      squad,
      spent: "₹1,00,000",
      purseLeft: "₹1,99,00,000",
      squadSize: 2,
      squadMin: 8,
      squadMax: 15,
      teamUrl: "https://desiauction.in/seasons/mpl/teams",
    },
    {
      name: "Priya",
      season: "MPL 2026",
      teamName: "Cup Kings",
      squad,
      spent: "₹1,00,000",
      purseLeft: "₹0",
      squadSize: 2,
      squadMin: 2,
      squadMax: 15,
      teamUrl: "https://desiauction.in/seasons/mpl/teams",
    },
  ];
  it.each(owners.map((facts, i) => [i, facts] as const))(
    "owner summary, case %i",
    async (_i, f) => {
      same(await player.ownerSummaryMail(f), ownerSummaryMail(f));
    },
  );

  const decisions: RegistrationDecisionFacts[] = (
    ["approve", "waitlist", "reject", "withdraw", "restore"] as RegistrationDecision[]
  ).map((decision) => ({ name: "Arjun", season: "MPL 2026", decision }));
  it.each(
    [
      ...decisions,
      { name: "Arjun", season: "MPL 2026", decision: "reject", reason: "the season is full" },
    ].map((facts) => [facts.decision, facts as RegistrationDecisionFacts] as const),
  )("registration: %s", async (_d, facts) => {
    same(await player.registrationDecisionMail(facts), registrationDecisionMail(facts));
  });
});

describe("account mail renders exactly as before", () => {
  it.each(["login", "signup", "email_change"] as CodeMailPurpose[])("code: %s", async (purpose) => {
    same(await codes.codeMailCopy("482913", purpose), codeMailCopy("482913", purpose));
  });

  it("email changed", async () => {
    same(
      await security.emailChangedCopy("arjun@example.com"),
      emailChangedCopy("arjun@example.com"),
    );
  });

  it("phone changed", async () => {
    same(await security.phoneChangedCopy("4321"), phoneChangedCopy("4321"));
  });
});

describe("strangers' and staff mail renders exactly as before", () => {
  const request: ValidDemoRequest = {
    name: "Rohan",
    phone: "+919820000000",
    email: "rohan@example.com",
    orgName: "Malad Cricket Club",
    sport: "cricket",
    tournamentSize: "8-16",
    auctionOn: "2026-11-14",
    preferredWindow: "weekday-evening",
    note: "Call after 7",
    source: "schedule-demo",
    requestIp: null,
  };
  const bare: ValidDemoRequest = { ...request, email: null, auctionOn: null, note: null };

  it.each([request, bare].map((r, i) => [i, r] as const))(
    "demo request, case %i",
    async (_i, r) => {
      same(await demo.requesterAcknowledgement(r), requesterAcknowledgement(r));
      same(await demo.founderNotification(r, "01JREQ"), founderNotification(r, "01JREQ"));
    },
  );

  const input: BookingMailInput = {
    to: "rohan@example.com",
    name: "Rohan",
    orgName: "Malad Cricket Club",
    token: "sample-token",
    requestId: "sample",
    slotStart: new Date("2026-10-02T12:30:00Z"),
    slotEnd: new Date("2026-10-02T13:00:00Z"),
    sequence: 0,
  };
  it("demo booked, cancelled, reminded", async () => {
    same(await booking.bookingConfirmationMail(input), bookingConfirmationMail(input));
    same(await booking.bookingCancellationMail(input), bookingCancellationMail(input));
    same(await booking.bookingReminderMail(input, 24), bookingReminderMail(input, 24));
    same(await booking.bookingReminderMail(input, 1), bookingReminderMail(input, 1));
  });

  it.each(
    (["organizer", "owner", "general"] as AskAudience[]).flatMap((audience) =>
      ["Ravi", null].map((name) => [audience, name] as const),
    ),
  )("review ask: %s, %s", async (audience, name) => {
    const link = "https://desiauction.in/review/abc";
    same(await reviews.reviewAskMail(name, link, audience), reviewAskMail(name, link, audience));
  });

  it.each(
    (["player", "owner"] as const).flatMap((role) =>
      ["Ravi", null].map((name) => [role, name] as const),
    ),
  )("season ask: %s, %s", async (role, name) => {
    const ask = {
      name,
      seasonName: "Malad Premier\nLeague 2026",
      orgName: "Malad CC",
      role,
      link: "https://desiauction.in/review/xyz",
    };
    same(await reviews.seasonAskMail(ask), seasonAskMail(ask));
  });

  const review: ValidReview = {
    rating: 4,
    wentWell: "The gavel",
    improve: null,
    mayQuote: true,
    displayName: "Ravi K",
    displayOrg: "Sunday PL",
  };
  it("review arrived", async () => {
    same(
      await reviews.reviewArrivedMail(review, "Ravi Kumar"),
      reviewArrivedMail(review, "Ravi Kumar"),
    );
    const plain = { ...review, mayQuote: false, displayName: null, displayOrg: null };
    same(await reviews.reviewArrivedMail(plain, null), reviewArrivedMail(plain, null));
  });

  const report: ValidProblemReport = {
    category: "bug",
    description: "The bid button did nothing\nsecond line",
    replyEmail: "ravi@example.com",
    pageUrl: "https://desiauction.in/home",
    context: { viewport: "390x844", theme: "dark" },
    personId: null,
    requestIp: null,
    screenshot: { bytes: new Uint8Array([1]), contentType: "image/png" },
  };
  const bareReport: ValidProblemReport = {
    ...report,
    replyEmail: null,
    context: {},
    screenshot: null,
  };
  it.each([report, bareReport].map((r, i) => [i, r] as const))(
    "problem report, case %i",
    async (_i, r) => {
      same(
        await support.supportNotification(r, "01JREP", "a guest"),
        supportNotification(r, "01JREP", "a guest"),
      );
      same(await support.reporterAcknowledgement(r), reporterAcknowledgement(r));
    },
  );
});

describe("a finance document's email is what it was", () => {
  it.each(["receipt.issued", "invoice.issued", "correction.issued", "statement.issued"])(
    "%s",
    (templateId) => {
      const content = defaultContent(EMAIL_TEMPLATES["finance.document.issued"], "en");
      const fields = content.variants[financeVariantFor(templateId)];
      expect(fields).toBeDefined();
      if (fields === undefined) return;
      const body = "RECEIPT R-0001\nAmount: ₹75,000";
      expect(financeDocumentMail(fields, body)).toEqual({
        subject: subjectFor(templateId),
        text: body,
      });
    },
  );
});
