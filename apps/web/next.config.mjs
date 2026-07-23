// Security headers (IP-0_DESIGN §31).
//
// PX-11 hardening: adds a Content-Security-Policy plus Referrer-Policy and
// Permissions-Policy. The CSP carries the directives that DO NOT require
// per-request nonces and so are safe with the app router's inline hydration
// bootstrap: `frame-ancestors` (clickjacking, alongside X-Frame-Options),
// `base-uri` (blocks <base> injection that could rewrite relative URLs),
// `object-src 'none'` (no plugins), and `form-action 'self'` (a form cannot be
// pointed at an external origin — defence-in-depth for the login flow). A
// nonce-based `script-src`/`style-src` requires middleware and is recorded as a
// tracked follow-up (docs/operations/PRODUCTION_CHECKLIST.md), not shipped here
// where it would need `'unsafe-inline'` and defeat its own purpose.
// No `default-src`/`script-src`/`connect-src` here ON PURPOSE: those need a
// nonce to coexist with the app-router hydration bootstrap, the engine
// WebSocket, and Sentry, and adding them without one would either break the app
// or require `'unsafe-inline'` (worthless). These four restrict framing, <base>,
// plugins and form targets only — pure gain, no breakage.
const CSP = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy", value: CSP },
];

/** @type {import("next").NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@desiauction/core", "@desiauction/contracts", "@desiauction/ui"],
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
  redirects() {
    // A competition is now called a season — the thing that runs, under a
    // tournament that recurs. The old paths stay permanently redirected because
    // organizer links live in bookmarks, sent messages and browser history; the
    // rename is a vocabulary change and must not cost anyone a dead link.
    // (The public player link /c/[slug] is untouched — that is the one already
    // printed on QR codes and sent to registrants.)
    return Promise.resolve([
      { source: "/competitions", destination: "/seasons", permanent: true },
      { source: "/competitions/:path*", destination: "/seasons/:path*", permanent: true },
    ]);
  },
};
