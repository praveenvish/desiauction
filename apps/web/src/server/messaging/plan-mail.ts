import { TIER_LIMITS, tierLabel, type Tier } from "@desiauction/core";
import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import { renderNotificationEmail, type NotificationMail } from "./notification-email";
import { seasonBand, type SeasonFacts } from "./player-mail";

/**
 * THE SEASON'S PASS (email programme PR15) — "we've got your request", the
 * answer, and the support mailbox's notice. The limits a pass carries are
 * read from the pass itself (core TIER_LIMITS), never typed into a template.
 */

const BASE = (): string => env.PUBLIC_BASE_URL.replace(/\/$/, "");

const LIMIT_WORDS: Readonly<
  Record<
    MessageLanguage,
    { teams: string; players: string; upTo: (n: number) => string; none: string }
  >
> = {
  en: { teams: "Teams", players: "Players", upTo: (n) => `Up to ${String(n)}`, none: "No limit" },
  hi: { teams: "टीमें", players: "खिलाड़ी", upTo: (n) => `${String(n)} तक`, none: "कोई सीमा नहीं" },
};

/** What a pass lets a season hold, as rows. */
export function passLimits(
  tier: Tier,
  language: MessageLanguage,
): readonly (readonly [string, string])[] {
  const w = LIMIT_WORDS[language];
  const limits = TIER_LIMITS[tier];
  const words = (n: number | null) => (n === null ? w.none : w.upTo(n));
  return [
    [w.teams, words(limits.teams)],
    [w.players, words(limits.players)],
  ];
}

function seasonUrl(slug: string): string {
  return `${BASE()}/seasons/${encodeURIComponent(slug)}`;
}

export function passRequestedMail(
  facts: SeasonFacts & { name: string; seasonSlug: string; fromTier: Tier; requestedTier: Tier },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "plan.requested",
    language,
    {
      name: facts.name,
      season: facts.season,
      passName: tierLabel(facts.requestedTier),
      currentPass: tierLabel(facts.fromTier),
    },
    { action: { id: "season", url: seasonUrl(facts.seasonSlug) }, band: seasonBand(facts) },
  );
}

export function passAnsweredMail(
  facts: SeasonFacts & {
    name: string;
    seasonSlug: string;
    outcome: "granted" | "declined";
    /** The pass before the answer. */
    fromTier: Tier;
    /** What was asked for — and, when granted, what was given. */
    passTier: Tier;
    note: string | null;
  },
  language: MessageLanguage,
): Promise<NotificationMail> {
  const note = facts.note?.trim() ?? "";
  return renderNotificationEmail(
    "plan.answered",
    language,
    {
      name: facts.name,
      season: facts.season,
      passName: tierLabel(facts.passTier),
      currentPass: tierLabel(facts.fromTier),
      noteLine:
        note === "" ? "" : language === "hi" ? `हमारा नोट: “${note}”` : `Our note: “${note}”`,
    },
    {
      variant: facts.outcome,
      action: { id: "season", url: seasonUrl(facts.seasonSlug) },
      band: seasonBand(facts),
      ...(facts.outcome === "granted" ? { details: passLimits(facts.passTier, language) } : {}),
    },
  );
}

export function staffPassRequestMail(facts: {
  season: string;
  orgName: string;
  fromTier: Tier;
  requestedTier: Tier;
  requesterName: string;
  requesterEmail: string | null;
  note: string | null;
}): Promise<NotificationMail> {
  return renderNotificationEmail("staff.pass_request", "en", {
    season: facts.season,
    orgName: facts.orgName,
    currentPass: tierLabel(facts.fromTier),
    passName: tierLabel(facts.requestedTier),
    requesterLine:
      facts.requesterEmail === null
        ? facts.requesterName
        : `${facts.requesterName} · ${facts.requesterEmail}`,
    noteText: facts.note?.trim() || "(nothing written)",
    deskUrl: `${BASE()}/admin/passes`,
  });
}
