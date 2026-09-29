// The live socket's reconnection POLICY, apart from the hook that runs it, so
// the numbers and the decisions can be tested without a browser or a socket.

/** No frame — snapshot or heartbeat — for this long means the feed is dead. */
export const FRAME_STALE_AFTER_MS = 25_000;

/** The ceiling a reconnect may wait, however many attempts have failed. */
export const BACKOFF_CEILING_MS = 5_000;

/**
 * Full jitter under an exponential ceiling (see the hook for why jitter): the
 * wait before attempt N is a random point in (100ms, min(5s, 250ms · 2^N)).
 */
export function reconnectDelayMs(attempt: number, random: number = Math.random()): number {
  const ceiling = Math.min(BACKOFF_CEILING_MS, 250 * 2 ** Math.max(0, attempt));
  return Math.max(100, Math.round(random * ceiling));
}

/**
 * Must the socket be ABANDONED and replaced?
 *
 * A socket that closes tells us (`onclose`) and the hook reconnects. The one
 * that does not is the blackholed connection: venue Wi-Fi that drops packets
 * without a FIN leaves `readyState` at OPEN for minutes. The watchdog has
 * always detected it — and only ever changed a label. The screen said
 * "Reconnecting — bidding is disabled until we're live again" while nothing
 * was reconnecting, and the owner was locked out of the auction until they
 * thought to reload the page (PRR 2026-09-29).
 *
 * So silence past the window is a reason to replace the socket, whatever it
 * says its state is. A socket still CONNECTING is included: a handshake that
 * has not finished in 25 seconds is not going to.
 */
export function mustReplaceSocket(input: {
  readyState: number | null;
  lastFrameAtMs: number;
  nowMs: number;
}): boolean {
  const CONNECTING = 0;
  const OPEN = 1;
  if (input.readyState !== OPEN && input.readyState !== CONNECTING) {
    // Closing, closed or absent: the ordinary reconnect path already owns it.
    return false;
  }
  return input.nowMs - input.lastFrameAtMs > FRAME_STALE_AFTER_MS;
}

/** How many failed attempts in a row before the page asks for a new ticket. */
export const REFRESH_EVERY_ATTEMPTS = 6;

/**
 * Should the page re-render on the server, to be handed a fresh socket URL?
 *
 * The URL carries a ticket minted when the page was rendered, good for a day
 * or two. A tab left open past that retried the SAME expired ticket for ever —
 * the engine refuses it by dropping the connection, which looks exactly like
 * an outage, so the room said "Reconnecting…" with no way to succeed. Every
 * few failures the page now asks again; if the ticket was the problem the new
 * URL fixes it, and if the engine is simply down nothing changes.
 */
export function shouldRefreshTicket(consecutiveFailures: number): boolean {
  return consecutiveFailures > 0 && consecutiveFailures % REFRESH_EVERY_ATTEMPTS === 0;
}
