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
 * so it comes from the environment. With 0 — the safe default — no XFF entry is
 * trusted and we fall back to `x-real-ip` (which a correctly-configured ingress
 * overwrites) or to no IP context at all. Loopback is the proxy talking to
 * itself, never a client.
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
  candidate ??= headers.get("x-real-ip");
  if (candidate === null || candidate === "127.0.0.1" || candidate === "::1") {
    return null;
  }
  return candidate;
}
