import type { Db } from "@desiauction/db";

import { db as appDb } from "../db";
import { PERSON_SWITCH_CHANNELS, type SwitchTopic } from "./catalogue";
import { setPreference } from "./consent";
import { personSwitchTopics, platformSwitches } from "./platform-switches";

/**
 * The topic, if a person may switch it off RIGHT NOW. A platform admin can
 * take a switch away (restrict-only, 0086); a link must then say so rather
 * than report "done" about mail the gate will keep sending.
 */
export async function switchableTopic(
  topic: string,
  db: Db = appDb,
): Promise<SwitchTopic | undefined> {
  return personSwitchTopics(await platformSwitches(db)).find((entry) => entry.topic === topic);
}

/**
 * Turn one of a person's /account switches off (or back on, for Undo) from a
 * mail's unsubscribe link. The caller has already checked the link
 * (`unsubscribeTokenMatches`) — the link is the only proof there is, since the
 * person is not signed in.
 *
 * The same rows the /account switch writes (email and text together), in one
 * transaction so a half-applied switch cannot exist, with the consent trail
 * saying it came from a mail rather than from account settings.
 *
 * On the app pool, as `setNotificationPreferenceAction` writes: a preference
 * is the person's own, not a club's.
 */
export async function setTopicFromEmailLink(
  input: { personId: string; topic: string; allowed: boolean; via: "one_click" | "page" },
  db: Db = appDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const channel of PERSON_SWITCH_CHANNELS) {
      await setPreference(tx, {
        personId: input.personId,
        topic: input.topic,
        channel,
        allowed: input.allowed,
        via: {
          source: "email_unsubscribe",
          evidence: {
            via:
              input.via === "one_click" ? "mail client one-click unsubscribe" : "unsubscribe page",
            action: input.allowed ? "undo" : "unsubscribe",
          },
        },
      });
    }
  });
}
