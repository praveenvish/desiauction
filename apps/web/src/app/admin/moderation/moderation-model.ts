import type { KitTone } from "@desiauction/ui";

/**
 * THE MODERATION ROWS, IN WORDS — pure, so what the desk says about a public
 * season is a unit test. A row used to say name · club · sport · "created 28
 * Sep"; created is not when a page reached strangers, and nothing said whether
 * strangers could register on it right now.
 */

/** Whether strangers can act on the page right now, as a pill. */
export function entryState(status: string): { label: string; tone: KitTone } {
  switch (status) {
    case "registration_open":
      return { label: "Registration open", tone: "green" };
    case "registration_closed":
      return { label: "Registration closed", tone: "neutral" };
    case "draft":
    case "setup":
      return { label: "Not open yet", tone: "neutral" };
    default:
      return { label: status.replace(/_/g, " "), tone: "neutral" };
  }
}
