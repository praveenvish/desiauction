import { NextResponse, type NextRequest } from "next/server";

import { env } from "./env";
import { buildContentSecurityPolicy, mintNonce } from "./lib/csp";

/**
 * TWO HEADERS PER PAGE REQUEST, AND NOTHING ELSE.
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
 */
export const config = {
  runtime: "nodejs",
  matcher: [
    {
      // Pages and server actions. Not static assets, not images, not the API
      // routes (webhooks and jobs set their own ids and render no scripts).
      source:
        "/((?!_next/static|_next/image|api/|favicon.ico|icon.png|apple-icon.png|brand/|marketing/|_media/).*)",
      // A router prefetch renders nothing a nonce could protect.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

export function middleware(request: NextRequest): NextResponse {
  const nonce = mintNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    engineWsUrl: env.ENGINE_PUBLIC_WS_URL,
    mediaPublicBase: env.MEDIA_PUBLIC_BASE,
    mediaUploadEndpoint: env.MEDIA_S3_ENDPOINT,
    development: env.NODE_ENV === "development",
    reportUri: "/api/csp-report",
  });
  const header = env.CSP_ENFORCE
    ? "content-security-policy"
    : "content-security-policy-report-only";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(header, policy);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  response.headers.set("x-request-id", requestId);
  return response;
}
