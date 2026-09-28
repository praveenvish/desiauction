import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { auctionDateLeaf } from "./auction-schedule-mail";
import { renderNotificationEmail, type NotificationMail } from "./notification-email";
import { organizerJourney } from "./organizer-mail";
import { seasonBand, type SeasonFacts } from "./player-mail";
import { momentWords } from "./request-context";

/**
 * THE DAY BEFORE AUCTION NIGHT (email programme PR8) — one reminder, three
 * readers: the owner (their team, their paddle), the pool player (when, where
 * to watch), the organizer (is the room ready?). Built when it is due, so
 * every fact in it is true that day.
 */

export interface Readiness {
  readonly auctionCreated: boolean;
  readonly teams: number;
  readonly owned: number;
  readonly paddles: number;
  readonly pool: number;
}

const WORDS = {
  en: {
    team: "Your team",
    paddle: "Your paddle",
    paddleReady: "Ready",
    paddleMissing: "Not granted yet — ask the organizer",
    auction: "Auction",
    created: "Created",
    notCreated: "Not created yet",
    owners: "Team owners in",
    paddles: "Paddles granted",
    pool: "Players in the pool",
    of: (a: number, b: number) => `${String(a)} of ${String(b)}`,
    noAuction:
      "The auction isn't created yet — create it from the auction page so owners can join.",
    ownersMissing: (n: number) =>
      `${String(n)} ${n === 1 ? "owner hasn't" : "owners haven't"} joined yet — resend their links from the auction page.`,
    paddlesMissing: (n: number) =>
      `${String(n)} ${n === 1 ? "paddle is" : "paddles are"} still to grant — grant them from the auction page.`,
    ready: "Every team has its owner and paddle — you're ready for tomorrow.",
  },
  hi: {
    team: "आपकी टीम",
    paddle: "आपका पैडल",
    paddleReady: "तैयार",
    paddleMissing: "अभी नहीं मिला — आयोजक से कहें",
    auction: "नीलामी",
    created: "बन गई",
    notCreated: "अभी नहीं बनी",
    owners: "जुड़े हुए टीम मालिक",
    paddles: "दिए गए पैडल",
    pool: "सूची में खिलाड़ी",
    of: (a: number, b: number) => `${String(b)} में से ${String(a)}`,
    noAuction: "नीलामी अभी नहीं बनी है — नीलामी पेज से इसे बनाएँ, ताकि मालिक जुड़ सकें।",
    ownersMissing: (n: number) =>
      `${String(n)} मालिक अभी जुड़े नहीं हैं — नीलामी पेज से उन्हें लिंक दोबारा भेजें।`,
    paddlesMissing: (n: number) => `${String(n)} पैडल अभी देने बाकी हैं — नीलामी पेज से दें।`,
    ready: "हर टीम का मालिक और पैडल तैयार है — आप कल के लिए तैयार हैं।",
  },
} as const;

/** The organizer's table: what is ready, as counts. */
export function readinessRows(
  readiness: Readiness,
  language: MessageLanguage,
): readonly (readonly [string, string])[] {
  const w = WORDS[language];
  return [
    [w.auction, readiness.auctionCreated ? w.created : w.notCreated],
    [w.owners, w.of(readiness.owned, readiness.teams)],
    [w.paddles, w.of(readiness.paddles, readiness.teams)],
    [w.pool, String(readiness.pool)],
  ];
}

/** The one thing to do next — the first gap, or that there is none. */
export function readinessGap(readiness: Readiness, language: MessageLanguage): string {
  const w = WORDS[language];
  if (!readiness.auctionCreated) return w.noAuction;
  if (readiness.owned < readiness.teams) return w.ownersMissing(readiness.teams - readiness.owned);
  if (readiness.paddles < readiness.teams) {
    return w.paddlesMissing(readiness.teams - readiness.paddles);
  }
  return w.ready;
}

export type ReminderRole =
  | { readonly role: "owner"; readonly teamName: string; readonly hasPaddle: boolean }
  | { readonly role: "player" }
  | { readonly role: "organizer"; readonly readiness: Readiness };

export function auctionReminderMail(
  facts: SeasonFacts & { name: string; at: Date; url: string } & ReminderRole,
  language: MessageLanguage,
): Promise<NotificationMail> {
  const w = WORDS[language];
  return renderNotificationEmail(
    "auction.reminder",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      when: momentWords(facts.at, language),
      teamName: facts.role === "owner" ? facts.teamName : "",
      gapLine: facts.role === "organizer" ? readinessGap(facts.readiness, language) : "",
    },
    {
      variant: facts.role,
      action: { id: "open", url: facts.url },
      band: seasonBand(facts),
      dateLeaf: auctionDateLeaf(facts.at, facts.season, language),
      ...(facts.role === "owner"
        ? {
            details: [
              [w.team, facts.teamName],
              [w.paddle, facts.hasPaddle ? w.paddleReady : w.paddleMissing],
            ],
          }
        : {}),
      ...(facts.role === "organizer"
        ? {
            details: readinessRows(facts.readiness, language),
            progress: organizerJourney(3, language),
          }
        : {}),
    },
  );
}
