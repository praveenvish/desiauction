import type { IncomingHttpHeaders } from "node:http";

/**
 * The address a WebSocket upgrade really came from, for the per-client socket cap.
 *
 * In production every socket arrives through Caddy, so the TCP peer is Caddy's
 * container for EVERYONE: keyed on it, `WS_MAX_SOCKETS_PER_IP` stops being a
 * per-client ceiling and becomes one ceiling for the whole platform — fifty
 * sockets across every live room, reachable by one visitor with a spectate
 * ticket or by an ordinary busy auction night.
 *
 * Same rule as the web tier's `clientIp`: each proxy APPENDS the address it
 * received from, so with `trustedProxies` hops in front the trustworthy entry is
 * that many from the right, and everything to its left is client-typed text
 * that is never read. A chain shorter than the declared hops has no trustworthy
 * entry. With 0 there is no proxy, and the TCP peer is the client.
 *
 * Returns "" when there is no trustworthy address; the caller then skips the
 * per-client cap (the per-room cap still holds) rather than lumping unknown
 * clients together under one key.
 */
export function clientAddress(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trustedProxies: number,
): string {
  if (trustedProxies <= 0) {
    return remoteAddress ?? "";
  }
  const raw = headers["x-forwarded-for"];
  const xff = Array.isArray(raw) ? raw.join(",") : raw;
  if (xff === undefined) {
    return "";
  }
  const parts = xff
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const index = parts.length - trustedProxies;
  return index >= 0 ? (parts[index] ?? "") : "";
}
