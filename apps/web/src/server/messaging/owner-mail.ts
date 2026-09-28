import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { auctionDateLeaf } from "./auction-schedule-mail";
import { renderNotificationEmail, type NotificationMail } from "./notification-email";
import { organizerJourney } from "./organizer-mail";
import { seasonBand, type SeasonFacts } from "./player-mail";

/**
 * TEAM OWNERS (email programme PR7) — the invitation an organizer emails, and
 * "every team has its owner" to the organizers.
 */

/**
 * The invitation. `acceptUrl` is the one-time link itself — the ownership —
 * so this mail is only ever sent direct, never queued (owner-actions.ts).
 */
export function ownerInviteMail(
  facts: SeasonFacts & {
    teamName: string;
    inviterName: string;
    acceptUrl: string;
    auctionAt: Date | null;
  },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "owner.invite",
    language,
    {
      season: facts.season,
      orgName: facts.orgName,
      teamName: facts.teamName,
      inviterName: facts.inviterName,
    },
    {
      action: { id: "accept", url: facts.acceptUrl },
      band: seasonBand(facts),
      ...(facts.auctionAt === null
        ? {}
        : { dateLeaf: auctionDateLeaf(facts.auctionAt, facts.season, language) }),
    },
  );
}

/** "Every team has its owner" — who bids for whom, and what is left to do. */
export function ownersReadyMail(
  facts: SeasonFacts & {
    name: string;
    owners: readonly (readonly [team: string, owner: string])[];
    roomUrl: string;
    auctionAt: Date | null;
  },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "auction.owners_ready",
    language,
    {
      name: facts.name,
      season: facts.season,
      teamCount: String(facts.owners.length),
      ifNoTime: facts.auctionAt === null,
    },
    {
      action: { id: "room", url: facts.roomUrl },
      band: seasonBand(facts),
      progress: organizerJourney(3, language),
      details: facts.owners,
      ...(facts.auctionAt === null
        ? {}
        : { dateLeaf: auctionDateLeaf(facts.auctionAt, facts.season, language) }),
    },
  );
}
