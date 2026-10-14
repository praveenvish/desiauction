/**
 * THE SCRIPT POLICY — one pure function, so it can be read and tested apart
 * from the middleware that sends it.
 *
 * The enforced header set in next.config.mjs has always carried the four
 * directives that need no nonce (framing, `<base>`, plugins, form targets) and
 * nothing about SCRIPTS, because the app router's inline bootstrap needs a
 * per-request nonce and a nonce needs middleware. That left React's escaping as
 * the only defence if an XSS sink ever appeared. This is the other half.
 *
 * Shape, and why:
 *   script-src   'nonce-…' 'strict-dynamic' — every script Next emits carries the
 *                nonce (it reads it from the request header middleware sets), and
 *                scripts those load inherit trust. No host allowlist: under
 *                'strict-dynamic' browsers ignore one, and a CDN allowlist is how
 *                most real-world CSPs are bypassed.
 *   style-src    'self' 'unsafe-inline' — React writes `style` attributes, which
 *                no nonce can cover. Style injection is a far smaller risk than
 *                script injection, and the script policy is the point.
 *   img-src      'self' data: blob: + the media origin — player photos and crests
 *                are served from the bucket's public base.
 *   connect-src  'self' + the engine's WebSocket origin + the bucket endpoint —
 *                the live room's socket, and presigned photo uploads, which go
 *                from the browser straight to storage.
 *   Google, narrowly — "Get photos from Google Drive" signs in through
 *                Google Identity Services and shows Google's Picker, which is a
 *                docs.google.com FRAME; the photos are then fetched from the Drive
 *                API. So: frame-src docs.google.com + accounts.google.com, and
 *                connect-src accounts.google.com + www.googleapis.com. Nothing
 *                wider (no *.google.com), and scripts still need no host entry:
 *                Google's loaders are inserted by our own trusted bundle, which
 *                'strict-dynamic' extends trust to.
 *   frame-ancestors is explicit when enforcing this policy, because it replaces
 *                the static header. Report-Only retains static framing protection.
 */

/** Google's sign-in (token popup + its helper frame). */
const GOOGLE_SIGN_IN = "https://accounts.google.com";
/** The Picker renders in a frame served from here. */
const GOOGLE_PICKER = "https://docs.google.com";
/** Where a picked file's bytes are downloaded from. */
const GOOGLE_DRIVE_API = "https://www.googleapis.com";

export interface CspInputs {
  readonly nonce: string;
  /** ENGINE_PUBLIC_WS_URL — the live room's socket. */
  readonly engineWsUrl: string;
  readonly liveWsUrl?: string | undefined;
  /** MEDIA_PUBLIC_BASE — where photos and crests are read from, if set. */
  readonly mediaPublicBase?: string | undefined;
  /** MEDIA_S3_ENDPOINT — where presigned uploads are PUT, if set. */
  readonly mediaUploadEndpoint?: string | undefined;
  /** Next's dev server evaluates code for fast refresh; production never does. */
  readonly development: boolean;
  readonly reportUri: string;
  readonly frameAncestors?: "*" | "'none'" | undefined;
}

/** The origin of a URL, or null when it is not one we can use. */
export function originOf(url: string | undefined): string | null {
  if (url === undefined || url === "") {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

/** A nonce: 128 bits from the platform RNG, base64 — what CSP expects. */
export function mintNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function buildContentSecurityPolicy(input: CspInputs): string {
  const media = originOf(input.mediaPublicBase);
  const upload = originOf(input.mediaUploadEndpoint);
  const engine = originOf(input.engineWsUrl);
  const unique = (values: readonly (string | null)[]): string[] => [
    ...new Set(values.filter((value): value is string => value !== null)),
  ];

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      unique([
        `'nonce-${input.nonce}'`,
        "'strict-dynamic'",
        input.development ? "'unsafe-eval'" : null,
      ]),
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", unique(["'self'", "data:", "blob:", media])],
    ["font-src", ["'self'", "data:"]],
    [
      "connect-src",
      unique([
        "'self'",
        engine,
        originOf(input.liveWsUrl),
        upload,
        GOOGLE_SIGN_IN,
        GOOGLE_DRIVE_API,
        // Fast refresh talks to the dev server over its own socket.
        input.development ? "ws:" : null,
      ]),
    ],
    ["media-src", ["'self'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", [GOOGLE_PICKER, GOOGLE_SIGN_IN]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ...(input.frameAncestors
      ? [["frame-ancestors", [input.frameAncestors]] as [string, string[]]]
      : []),
    ["report-uri", [input.reportUri]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** Preserve the static route exceptions when the nonce policy replaces it. */
export function buildDocumentPolicy(input: CspInputs, pathname: string, enforce: boolean): string {
  if (enforce && /^\/admin\/reports\/[^/]+\/screenshot\/?$/.test(pathname))
    return "default-src 'none'; frame-ancestors 'none'; sandbox";
  return buildContentSecurityPolicy({
    ...input,
    frameAncestors: enforce
      ? pathname === "/embed" || pathname.startsWith("/embed/")
        ? "*"
        : "'none'"
      : undefined,
  });
}

/** Exact data-free static scoring shell: build hashes replace the nonce only. */
export function buildScoringShellPolicy(input: CspInputs, hashes: readonly string[]): string {
  if (hashes.length === 0 || hashes.some((hash) => !/^sha256-[A-Za-z0-9+/]+={0,2}$/.test(hash)))
    throw new Error("Invalid scoring shell script hashes");
  return buildContentSecurityPolicy(input).replace(
    /script-src [^;]+/,
    `script-src ${hashes.map((hash) => `'${hash}'`).join(" ")} 'strict-dynamic'`,
  );
}

/**
 * A violation report's page address, with anything that could be a secret
 * removed before it is logged.
 *
 * Invite, owner-join, demo-booking and player-page links carry tokens in the
 * PATH, and reports arrive from exactly those pages. A log line holding a live
 * invite token is a credential on disk. Any path segment long enough to be a
 * token or an id is replaced, and the query string and fragment are dropped.
 */
export function redactReportedUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") {
    return null;
  }
  try {
    const url = new URL(raw);
    const path = url.pathname
      .split("/")
      .map((segment) => (segment.length >= 16 ? ":redacted" : segment))
      .join("/");
    return `${url.origin}${path}`;
  } catch {
    // "inline", "eval", "self" and friends — keywords, not URLs, and safe.
    return raw.length <= 32 ? raw : null;
  }
}
