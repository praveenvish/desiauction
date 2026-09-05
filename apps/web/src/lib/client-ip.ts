/**
 * The real client IP, given how many proxies actually sit in front (PRR P2/F32).
 *
 * `x-forwarded-for` is a chain: each proxy APPENDS the address it received the
 * request from, so the LEFTMOST entry is whatever the client itself claimed —
 * fully spoofable. Reading it (as the OTP throttle did) lets an attacker rotate
 * a fake IP to defeat a per-IP cap. The only trustworthy entry is the one YOUR
 * own infrastructure added: with `trustedProxies` hops in front, that is the
 * entry `trustedProxies` from the right; everything to its left is attacker text
 * and is never read.
 *
 * `trustedProxies` is a deployment fact (1 behind a single Vercel/Fly ingress),
 * so it comes from the environment. With 0 there is no proxy in front, which
 * means NOTHING is overwriting `x-real-ip` either — so at 0 there is no
 * trustworthy source of a client address at all, and the honest answer is none.
 * Loopback is the proxy talking to itself, never a client.
 */
export function clientIp(headers: Headers, trustedProxies: number): string | null {
  let candidate: string | null = null;
  const xff = headers.get("x-forwarded-for");
  if (trustedProxies > 0 && xff !== null) {
    const parts = xff
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const index = parts.length - trustedProxies;
    // If the chain is SHORTER than the trusted-proxy count (a spoofer sending
    // fewer hops, or a misconfigured count), there is no trustworthy entry —
    // never fall back to parts[0], which is the attacker-controlled leftmost.
    candidate = index >= 0 ? (parts[index] ?? null) : null;
  }
  /*
   * `x-real-ip` IS A CLIENT HEADER UNTIL A PROXY OVERWRITES IT (audit PA-1 §25).
   *
   * The XFF branch above is careful — it reads the Nth entry from the right and
   * never the spoofable leftmost — and then this line undid that care, trusting
   * a header anyone can set. With `TRUSTED_PROXY_COUNT` at its default of 0
   * there is no proxy in front, so nothing is overwriting it: an attacker
   * rotating `x-real-ip` per request defeated the 20/IP/hour OTP cap and every
   * other per-IP throttle keyed off this, at the cost of one header.
   *
   * Now it is honoured under exactly the condition that makes it true — a proxy
   * we trust is in front — which is the same rule the XFF branch already
   * applies. With no trusted proxy the answer is "no IP context", and the
   * per-phone caps carry the throttling on their own.
   */
  if (trustedProxies > 0) {
    candidate ??= headers.get("x-real-ip");
  }
  if (candidate === null || candidate === "127.0.0.1" || candidate === "::1") {
    return null;
  }
  return candidate;
}
