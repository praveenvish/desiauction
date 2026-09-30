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

/** Failures in a row before an old page is suspected of holding a dead ticket. */
export const RENEW_AFTER_FAILURES = 6;

/**
 * A ticket is good for the day it was minted in and the day after (engine
 * `TICKET_WINDOW_MS`), so one younger than this cannot have expired — whatever
 * is refusing the socket, it is not the ticket.
 */
export const TICKET_CANNOT_HAVE_EXPIRED_BEFORE_MS = 20 * 60 * 60 * 1000;

/**
 * Is a new ticket worth asking for — by loading the page again?
 *
 * The socket URL carries a ticket minted when the page was rendered. A tab
 * left open past its life retried the SAME expired ticket for ever; the engine
 * refuses it by dropping the connection, which looks exactly like an outage,
 * so the room said "Reconnecting…" with no way to succeed.
 *
 * THE FIRST ANSWER TO THAT WAS WRONG, AND WORSE THAN THE PROBLEM. It asked the
 * router to refresh after every six failures, at any page age. A refresh that
 * cannot reach the server makes the router fall back to a full navigation — so
 * a phone that lost signal for thirty seconds, or a projector on venue Wi-Fi
 * that blinked, was taken off the auction and left on the browser's own error
 * page, where nothing reconnects. It also re-rendered every open page every
 * fifteen seconds for the length of an engine outage, to be handed a ticket
 * that is the same all day. Caught in review, before it shipped.
 *
 * So: only a page OLD ENOUGH for its ticket to have expired, only while the
 * device says it is online — and the caller must then confirm the server
 * answers before it reloads anything. A young page never reloads, which is
 * every page on an ordinary auction night.
 */
export function ticketMayHaveExpired(input: {
  consecutiveFailures: number;
  pageAgeMs: number;
  online: boolean;
}): boolean {
  return (
    input.online &&
    input.consecutiveFailures >= RENEW_AFTER_FAILURES &&
    input.pageAgeMs >= TICKET_CANNOT_HAVE_EXPIRED_BEFORE_MS
  );
}
