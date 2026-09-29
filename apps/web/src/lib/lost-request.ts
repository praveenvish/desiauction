/**
 * Is this what a request that NEVER CAME BACK looks like?
 *
 * Every browser words it differently, and Next words its own two cases (a
 * server that answered with something that is not an action result, and a
 * page older than the build now serving). Deliberately a short list of exact
 * shapes: a banner that appears for errors it does not understand would teach
 * people to ignore it.
 */
export type LostRequest = "network" | "stale-page" | null;

const NETWORK = [
  "failed to fetch", // Chromium
  "load failed", // Safari
  "networkerror when attempting to fetch resource", // Firefox
  "fetch failed", // Node-flavoured runtimes
  "network request failed",
  "connection closed", // the response stream was cut mid-flight
];

const STALE_PAGE = [
  "failed to find server action", // the page is older than the deploy
  "an unexpected response was received from the server",
];

export function lostRequest(reason: unknown): LostRequest {
  const said =
    typeof reason === "object" && reason !== null && "message" in reason ? reason.message : reason;
  const text = typeof said === "string" ? said.toLowerCase() : "";
  if (text === "") {
    return null;
  }
  if (STALE_PAGE.some((shape) => text.includes(shape))) {
    return "stale-page";
  }
  return NETWORK.some((shape) => text.includes(shape)) ? "network" : null;
}
