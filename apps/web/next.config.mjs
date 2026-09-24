// Security headers (IP-0_DESIGN §31).
//
// PX-11 hardening: adds a Content-Security-Policy plus Referrer-Policy and
// Permissions-Policy. The CSP carries the directives that DO NOT require
// per-request nonces and so are safe with the app router's inline hydration
// bootstrap: `frame-ancestors` (clickjacking, alongside X-Frame-Options),
// `base-uri` (blocks <base> injection that could rewrite relative URLs),
// `object-src 'none'` (no plugins), and `form-action 'self'` (a form cannot be
// pointed at an external origin — defence-in-depth for the login flow).
//
// THE SCRIPT POLICY IS NOT HERE, AND THAT IS NOT AN OMISSION. `script-src`,
// `connect-src` and the rest need a PER-REQUEST nonce to coexist with the app
// router's inline bootstrap, and a static header cannot carry one. They are sent
// by src/middleware.ts, built by src/lib/csp.ts: Report-Only by default, enforced
// when CSP_ENFORCE is set. These four stay here because they need no nonce and
// must hold on every response, including the ones middleware never sees.
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
  // Two `next dev` processes sharing one .next corrupt each other's webpack
  // pack cache — the e2e server on :3050 and a developer's own server on :3000
  // produce phantom 404s and ChunkLoadErrors in whichever one loses the race.
  // The harness sets NEXT_DIST_DIR so the two never share a build directory.
  ...(process.env["NEXT_DIST_DIR"] !== undefined ? { distDir: process.env["NEXT_DIST_DIR"] } : {}),
  /*
   * STANDALONE, because the web tier is a container now.
   *
   * Next traces the modules a build actually reaches and emits a self-contained
   * server under `.next/standalone`. Without it a Docker image has to carry the
   * whole pnpm workspace `node_modules` — hundreds of megabytes of dev
   * dependencies, build tooling and every package this monorepo has ever
   * installed — to run a server that needs a fraction of it. That is not just
   * size: every one of those packages is attack surface on the box that serves
   * auction night.
   */
  output: "standalone",
  reactStrictMode: true,
  // The floating "N" dev-tools badge renders on every dev page and repeats down
  // any full-page screenshot — it was being read as part of the product in
  // design reviews. Dev-only either way; production never shows it.
  devIndicators: false,
  poweredByHeader: false,
  transpilePackages: ["@desiauction/core", "@desiauction/contracts", "@desiauction/ui"],
  /*
   * BARREL IMPORTS, RESOLVED TO THE MODULE THAT WAS ASKED FOR.
   *
   * Every page imports `@desiauction/ui` through its one index, and every
   * "use client" file behind that index became part of the page's client
   * bundle — the landing page shipped the auction sound engine, RollingNumber
   * and PlayerCard because it wanted a Button. Next rewrites
   * `import { Button } from "@desiauction/ui"` to the file that defines Button.
   */
  experimental: {
    optimizePackageImports: ["@desiauction/ui"],
  },
  /*
   * PINO RUNS FROM node_modules, NOT FROM A BUNDLE.
   *
   * In development the logger writes through a `pino-pretty` transport, and a
   * pino transport runs in a worker thread that pino starts from its own file
   * on disk (thread-stream's `lib/worker.js`). Bundled by webpack, that path
   * points into `.next/server/vendor-chunks/lib/worker.js`, which does not
   * exist: every logger start threw "Cannot find module …/worker.js" as an
   * uncaughtException, the worker died, and dev logs went nowhere. Next 15.5's
   * built-in external list does not include pino, so it is listed here. In
   * production there is no transport, and standalone tracing still copies pino
   * into the server's node_modules.
   */
  serverExternalPackages: ["pino", "pino-pretty"],
  headers() {
    return Promise.resolve([
      { source: "/:path*", headers: securityHeaders },
      // FR-1: a problem-report screenshot is a picture of somebody's screen,
      // served to one operator. Config headers REPLACE a route handler's own
      // header of the same name, so the stricter policy the route sets was
      // being overwritten by the site-wide one above — measured, not assumed.
      // A later rule wins for the same key, so it is restated here.
      {
        source: "/admin/reports/:reportId/screenshot",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; frame-ancestors 'none'; sandbox",
          },
        ],
      },
    ]);
  },
  redirects() {
    // A competition is now called a season — the thing that runs, under a
    // tournament that recurs. The old paths stay permanently redirected because
    // organizer links live in bookmarks, sent messages and browser history; the
    // rename is a vocabulary change and must not cost anyone a dead link.
    // (The public player link /c/[slug] is untouched — that is the one already
    // printed on QR codes and sent to registrants.)
    return Promise.resolve([
      // Straight to the final destination. /seasons is itself a redirect now
      // (page.tsx: -> /tournaments?view=seasons), so pointing here at /seasons
      // made the bare path a TWO-hop permanent chain — two round trips for a
      // bookmark, and a chain search engines follow grudgingly. The :path*
      // rule below must keep targeting /seasons/:path*, because those ARE the
      // real pages.
      { source: "/competitions", destination: "/tournaments?view=seasons", permanent: true },
      { source: "/competitions/:path*", destination: "/seasons/:path*", permanent: true },
    ]);
  },
};
