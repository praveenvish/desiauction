"use server";

import { logger } from "../logger";
import { unsubscribeTokenMatches } from "./unsubscribe";
import { setTopicFromEmailLink, switchableTopic } from "./unsubscribe-writer";

/**
 * The unsubscribe PAGE's two buttons — Unsubscribe, and Undo right after it.
 * Sign-in free, like the one-click POST: the signed link on the page is the
 * proof (unsubscribe.ts), and it covers exactly one switch of one person.
 */
export interface EmailUnsubscribeState {
  readonly status?: "off" | "on";
  readonly error?: string;
}

async function apply(formData: FormData, allowed: boolean): Promise<EmailUnsubscribeState> {
  const personId = formData.get("p");
  const topic = formData.get("topic");
  if (
    !unsubscribeTokenMatches(personId, topic, formData.get("t")) ||
    typeof personId !== "string" ||
    typeof topic !== "string"
  ) {
    return { error: "This link isn't valid any more. Sign in to change your emails instead." };
  }
  try {
    if ((await switchableTopic(topic)) === undefined) {
      return { error: "These emails can't be switched off right now." };
    }
    await setTopicFromEmailLink({ personId, topic, allowed, via: "page" });
  } catch (error) {
    logger().error({ err: error, topic }, "email_unsubscribe.page_failed");
    return { error: "We couldn't save that just now. Please try again in a minute." };
  }
  return { status: allowed ? "on" : "off" };
}

export async function unsubscribeFromEmailAction(
  _previous: EmailUnsubscribeState,
  formData: FormData,
): Promise<EmailUnsubscribeState> {
  return apply(formData, formData.get("intent") === "undo");
}
