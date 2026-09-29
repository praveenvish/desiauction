/**
 * Is this what a request that NEVER CAME BACK looks like?
 *
 * Every browser words it differently, and Next words its own cases. Deliberately
 * a short list of exact shapes: a banner that appears for errors it does not
 * understand would teach people to ignore it.
 *
 * The shapes below were read out of the Next version this repository runs
 * (client/components/router-reducer/reducers/server-action-reducer.js), not
 * remembered — the first version of this file matched the sentence the SERVER
 * logs for a missing action, which a browser never receives, and so never
 * recognised the one case a reload fixes.
 */
export type LostRequest = "network" | "stale-page" | null;

const NETWORK = [
  "failed to fetch", // Chromium
  "load failed", // Safari
  "networkerror when attempting to fetch resource", // Firefox
  "fetch failed", // Node-flavoured runtimes
  "network request failed",
  "connection closed", // the response stream was cut mid-flight
  // Next, when the answer was not an action result at all: the proxy's 502
  // page while the server restarts, a captive portal. NOT a stale page —
  // reloading into a restart lands on the same 502; waiting and retrying is
  // what works.
  "an unexpected response was received from the server",
];

const STALE_PAGE = [
  // Next's client, when the server answered "I have no such action": this
  // page was built by a release that is no longer the one serving.
  "was not found on the server",
  "failed-to-find-server-action", // the link in that same message
  "failed to find server action", // the server's wording, should it ever reach here
];

export function lostRequest(reason: unknown): LostRequest {
  if (typeof reason === "object" && reason !== null && "name" in reason) {
    if (reason.name === "UnrecognizedActionError") {
      return "stale-page";
    }
  }
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
