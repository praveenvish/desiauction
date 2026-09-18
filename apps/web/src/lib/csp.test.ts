import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, mintNonce, originOf, redactReportedUrl } from "./csp";

const base = {
  nonce: "abc123==",
  engineWsUrl: "wss://engine.desiauction.in/ws",
  mediaPublicBase: "https://media.desiauction.in/desiauction-media",
  mediaUploadEndpoint: "https://s3.desiauction.in",
  development: false,
  reportUri: "/api/csp-report",
};

function directive(policy: string, name: string): string[] {
  const found = policy.split("; ").find((part) => part.startsWith(`${name} `));
  return found === undefined ? [] : found.split(" ").slice(1);
}

describe("the script policy", () => {
  it("trusts scripts by nonce and nothing else in production", () => {
    const policy = buildContentSecurityPolicy(base);
    expect(directive(policy, "script-src")).toEqual(["'nonce-abc123=='", "'strict-dynamic'"]);
    // No host allowlist and no eval: both are the usual ways a CSP is bypassed.
    expect(policy).not.toContain("unsafe-eval");
    expect(directive(policy, "script-src").some((source) => source.startsWith("http"))).toBe(false);
  });

  it("admits exactly the origins the product talks to", () => {
    const policy = buildContentSecurityPolicy(base);
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "wss://engine.desiauction.in",
      "https://s3.desiauction.in",
    ]);
    expect(directive(policy, "img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://media.desiauction.in",
    ]);
  });

  it("keeps the static header's directives that work in Report-Only", () => {
    const policy = buildContentSecurityPolicy(base);
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    expect(directive(policy, "form-action")).toEqual(["'self'"]);
  });

  it("leaves frame-ancestors to the static header, where it is always enforced", () => {
    // Browsers ignore frame-ancestors in a Report-Only policy (WebKit warns on
    // every page), so here it would guard nothing in the default mode.
    expect(directive(buildContentSecurityPolicy(base), "frame-ancestors")).toEqual([]);
    const config = readFileSync(new URL("../../next.config.mjs", import.meta.url), "utf8");
    expect(config).toContain(`"frame-ancestors 'none'"`);
    expect(config).toContain(`key: "X-Frame-Options", value: "DENY"`);
  });

  it("relaxes only what the dev server needs, only in development", () => {
    const policy = buildContentSecurityPolicy({ ...base, development: true });
    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
    expect(directive(policy, "connect-src")).toContain("ws:");
  });

  it("omits media origins that are not configured", () => {
    const policy = buildContentSecurityPolicy({
      ...base,
      mediaPublicBase: undefined,
      mediaUploadEndpoint: undefined,
    });
    expect(directive(policy, "img-src")).toEqual(["'self'", "data:", "blob:"]);
  });

  it("mints a fresh 128-bit nonce each time", () => {
    const a = mintNonce();
    expect(atob(a)).toHaveLength(16);
    expect(mintNonce()).not.toBe(a);
  });
});

describe("violation report addresses", () => {
  it("never logs a token from the path, a query string or a fragment", () => {
    expect(
      redactReportedUrl("https://desiauction.in/join/3a9f1c7e5b2d4f6a8c0e1b3d5f7a9c1e?next=/x#y"),
    ).toBe("https://desiauction.in/join/:redacted");
    expect(redactReportedUrl("https://desiauction.in/seasons/mpl-26/auction")).toBe(
      "https://desiauction.in/seasons/mpl-26/auction",
    );
  });

  it("passes CSP keywords through and drops anything else it cannot parse", () => {
    expect(redactReportedUrl("inline")).toBe("inline");
    expect(redactReportedUrl(42)).toBeNull();
  });

  it("reduces a URL to its origin", () => {
    expect(originOf("wss://engine.example/ws?x=1")).toBe("wss://engine.example");
    expect(originOf("not a url")).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});
