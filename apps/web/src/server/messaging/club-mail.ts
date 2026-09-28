import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import type { EmailBand } from "./email-layout";
import { renderNotificationEmail, type NotificationMail } from "./notification-email";
import { monogramOf } from "./player-mail";

/**
 * JOINING A CLUB (email programme PR13) — the invitation an organizer emails,
 * and "someone joined" to whoever sent it and the club's owners. Words about
 * what each kind of access can do live here, once, in both languages.
 */

const BASE = (): string => env.PUBLIC_BASE_URL.replace(/\/$/, "");

const ROLE: Readonly<
  Record<MessageLanguage, Readonly<Record<string, { name: string; line: string }>>>
> = {
  en: {
    "org:owner": {
      name: "an owner",
      line: "As an owner you can do everything — seasons, money and who has access.",
    },
    "org:staff": {
      name: "staff",
      line: "As staff you can run seasons, teams, registrations and matches — not the money or who has access.",
    },
    viewer: {
      name: "a member",
      line: "As a member you can see the club's seasons and how they are going; you won't be able to change anything.",
    },
  },
  hi: {
    "org:owner": {
      name: "मालिक",
      line: "मालिक के तौर पर आप सब कुछ कर सकते हैं — सीज़न, पैसा और किसे एक्सेस मिले।",
    },
    "org:staff": {
      name: "स्टाफ़",
      line: "स्टाफ़ के तौर पर आप सीज़न, टीमें, रजिस्ट्रेशन और मैच चला सकते हैं — पैसे या एक्सेस नहीं।",
    },
    viewer: {
      name: "मेंबर",
      line: "मेंबर के तौर पर आप क्लब के सीज़न और उनका हाल देख सकते हैं; कुछ बदल नहीं पाएँगे।",
    },
  },
};

export function roleWords(
  capabilitySet: string,
  language: MessageLanguage,
): { name: string; line: string } {
  return ROLE[language][capabilitySet] ?? ROLE[language]["viewer"] ?? { name: "", line: "" };
}

const CLUB_SUBTITLE: Readonly<Record<MessageLanguage, string>> = {
  en: "A club on DesiAuction",
  hi: "DesiAuction पर एक क्लब",
};

export function clubBand(orgName: string, language: MessageLanguage): EmailBand {
  return { title: orgName, subtitle: CLUB_SUBTITLE[language], monogram: monogramOf(orgName) };
}

export function clubInviteMail(
  facts: { orgName: string; inviterName: string; capabilitySet: string; acceptUrl: string },
  language: MessageLanguage,
): Promise<NotificationMail> {
  const role = roleWords(facts.capabilitySet, language);
  return renderNotificationEmail(
    "club.invite",
    language,
    {
      orgName: facts.orgName,
      inviterName: facts.inviterName,
      roleName: role.name,
      roleLine: role.line,
    },
    { action: { id: "accept", url: facts.acceptUrl }, band: clubBand(facts.orgName, language) },
  );
}

export function memberJoinedMail(
  facts: {
    name: string;
    orgName: string;
    orgSlug: string;
    memberName: string;
    capabilitySet: string;
  },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "club.member_joined",
    language,
    {
      name: facts.name,
      orgName: facts.orgName,
      memberName: facts.memberName,
      roleName: roleWords(facts.capabilitySet, language).name,
    },
    {
      action: {
        id: "members",
        url: `${BASE()}/org/${encodeURIComponent(facts.orgSlug)}#members`,
      },
      band: clubBand(facts.orgName, language),
    },
  );
}
