import { NextResponse, type NextRequest } from "next/server";

import { scoringShellArtifact } from "./server/scoring/shell-artifact";
import { env } from "./env";
import { buildDocumentPolicy, buildScoringShellPolicy, mintNonce } from "./lib/csp";
import { isPublicPath, NOINDEX_HEADER } from "./server/seo/routes";

/**
 * THREE HEADERS PER PAGE REQUEST, AND NOTHING ELSE.
 *
 * This app had no middleware on purpose: authorization lives in each page and
 * action, where it cannot be skipped by a crafted header (the CVE-2025-29927
 * class), and this file keeps it that way. It makes NO access decision. It
 * does exactly two things every page needs and only a middleware can do:
 *
 *   1. A per-request NONCE, and the script policy built around it. Next reads
 *      the policy from the REQUEST headers, finds the nonce and stamps it on
 *      every script it emits; the same policy goes out on the response. Unless
 *      CSP_ENFORCE is set it goes out as Report-Only, which blocks nothing.
 *   2. A REQUEST ID on every page and server-action request that arrives
 *      without one, so a server action's log lines can be joined up. Before
 *      this only the five API routes carried one.
 *   3. `X-Robots-Tag: noindex` on every page the SEO route registry does not
 *      claim as public (server/seo/routes.ts). The registry is an allowlist,
 *      so a console route nobody remembered to list is still kept out of
 *      search. This is an indexing hint, not an access decision.
 */
export const config = {
  runtime: "nodejs",
  matcher: [
    {
      // Pages and server actions. Not static assets, not images, not the API
      // routes (webhooks and jobs set their own ids and render no scripts),
      // and not the installed app's files: the worker, its scriptless
      // offline page, and the manifest.
      source:
        "/((?!_next/static|_next/image|\\.well-known/|api/|favicon.ico|icon.png|apple-icon.png|sw.js|offline.html|manifest.webmanifest|brand/|marketing/|_media/).*)",
      // A router prefetch renders nothing a nonce could protect.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const nonce = mintNonce();
  const policy = buildDocumentPolicy(
    {
      nonce,
      engineWsUrl: env.ENGINE_PUBLIC_WS_URL,
      liveWsUrl: env.NEXT_PUBLIC_LIVE_WS_PATH
        ? env.PUBLIC_BASE_URL.replace(/^http/, "ws")
        : undefined,
      mediaPublicBase: env.MEDIA_PUBLIC_BASE,
      mediaUploadEndpoint: env.MEDIA_S3_ENDPOINT,
      development: env.NODE_ENV === "development",
      reportUri: "/api/csp-report",
    },
    request.nextUrl.pathname,
    env.CSP_ENFORCE,
  );
  const header = env.CSP_ENFORCE
    ? "content-security-policy"
    : "content-security-policy-report-only";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(header, policy);
  // A client-supplied id is honoured for correlation, but bounded and plain:
  // it is copied into every log line of this request.
  const offered = request.headers.get("x-request-id");
  const requestId =
    offered !== null && /^[A-Za-z0-9._-]{1,64}$/.test(offered) ? offered : crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);

  // LS-1 C27: this exact static, data-free document has a build-hash policy.
  // Authenticated pages and router RSC requests retain the normal nonce policy.
  if (
    request.nextUrl.pathname === "/score/shell" &&
    ["GET", "HEAD"].includes(request.method) &&
    !request.headers.has("rsc") &&
    !request.headers.has("next-router-state-tree") &&
    !request.headers.has("next-router-prefetch")
  ) {
    try {
      const artifact = await scoringShellArtifact();
      const shellPolicy = buildScoringShellPolicy(
        {
          nonce,
          engineWsUrl: env.ENGINE_PUBLIC_WS_URL,
          liveWsUrl: env.NEXT_PUBLIC_LIVE_WS_PATH
            ? env.PUBLIC_BASE_URL.replace(/^http/, "ws")
            : undefined,
          mediaPublicBase: env.MEDIA_PUBLIC_BASE,
          mediaUploadEndpoint: env.MEDIA_S3_ENDPOINT,
          development: false,
          reportUri: "/api/csp-report",
          frameAncestors: env.CSP_ENFORCE ? "'none'" : undefined,
        },
        artifact.scriptHashes,
      );
      return new NextResponse(request.method === "HEAD" ? null : artifact.html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          [header]: shellPolicy,
          "x-request-id": requestId,
          "x-robots-tag": NOINDEX_HEADER,
          "x-frame-options": "DENY",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      });
    } catch {
      return new NextResponse(
        request.method === "HEAD"
          ? null
          : '<!doctype html><html lang="en"><title>Scoring offline unavailable</title><h1>Offline scoring is unavailable</h1><p>Connect and retry match-day preparation.</p></html>',
        {
          status: 503,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy":
              "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            "x-request-id": requestId,
            "x-robots-tag": NOINDEX_HEADER,
            "x-frame-options": "DENY",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  response.headers.set("x-request-id", requestId);
  if (request.nextUrl.pathname === "/inbox" && request.nextUrl.searchParams.has("reminder")) {
    response.headers.set("cache-control", "private, no-store");
  }
  if (!isPublicPath(request.nextUrl.pathname)) {
    response.headers.set("x-robots-tag", NOINDEX_HEADER);
  }
  return response;
}
