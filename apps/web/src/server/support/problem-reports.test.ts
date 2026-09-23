import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PRIVATE_SELECTOR } from "../../components/report-problem/capture";
import { reporterAcknowledgement, supportNotification } from "./problem-report-mail";
import {
  CONTEXT_KEYS,
  REDACTED,
  SCREENSHOT_MAX_BYTES,
  TOKEN_ROUTE_PREFIXES,
  redactPageUrl,
  sanitizeContext,
  sniffImageType,
  validateProblemReport,
  type ProblemReportInput,
} from "./problem-reports";

/**
 * What Report a problem will store and send. Every input here arrives from a
 * browser and ends up in an operator's inbox and queue, so the cases are the
 * ones a real page, a real phone screenshot, or an edited request produces.
 */

const BASE = "https://desiauction.in";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);

const input: ProblemReportInput = {
  category: "bug",
  description: "The bid button did nothing on lot 14.",
  replyEmail: "",
  pageUrl: `${BASE}/seasons/sunday-pl/auction`,
  context: { viewport: "390×844 @3x", userAgent: "Mozilla/5.0 (iPhone)" },
  personId: null,
  requestIp: "203.0.113.4",
  screenshot: null,
};

function valid(overrides: Partial<ProblemReportInput> = {}) {
  const result = validateProblemReport({ ...input, ...overrides }, BASE);
  if (!result.ok) {
    throw new Error(`expected valid, got ${result.field}: ${result.message}`);
  }
  return result.value;
}

describe("redactPageUrl — no secret leaves the browser in a report", () => {
  it("keeps an ordinary path", () => {
    expect(redactPageUrl(`${BASE}/seasons/sunday-pl/teams`, BASE)).toBe(
      `${BASE}/seasons/sunday-pl/teams`,
    );
  });

  it("drops the query string and fragment", () => {
    expect(redactPageUrl(`${BASE}/login?next=%2Fhome&code=123456#step`, BASE)).toBe(
      `${BASE}/login`,
    );
  });

  it.each(TOKEN_ROUTE_PREFIXES)("replaces the token after /%s/", (prefix) => {
    expect(redactPageUrl(`${BASE}/${prefix}/s3cr3t-token-value`, BASE)).toBe(
      `${BASE}/${prefix}/${REDACTED}`,
    );
    expect(redactPageUrl(`${BASE}/${prefix}/s3cr3t/invite.ics`, BASE)).toBe(
      `${BASE}/${prefix}/${REDACTED}/invite.ics`,
    );
  });

  it("refuses another origin rather than recording it as ours", () => {
    expect(redactPageUrl("https://evil.example/join/abc", BASE)).toBeNull();
    expect(redactPageUrl("javascript:alert(1)", BASE)).toBeNull();
  });

  it("resolves a bare path against our origin", () => {
    expect(redactPageUrl("/help", BASE)).toBe(`${BASE}/help`);
  });

  /**
   * READ FROM THE APP DIRECTORY, NOT FROM THE LIST. A new `[token]` route that
   * nobody added to TOKEN_ROUTE_PREFIXES would mail its working link to the
   * support inbox, and a test that looped over the list would never notice.
   */
  it("covers every route on disk whose dynamic segment is a token", () => {
    const appDir = resolve(import.meta.dirname, "../../app");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (/^\[.*token.*\]$/i.test(entry.name)) {
          found.push(
            dir
              .slice(appDir.length + 1)
              .split("/")
              .at(-1) ?? "",
          );
        }
        walk(join(dir, entry.name));
      }
    };
    walk(appDir);
    expect(found.length).toBeGreaterThan(0);
    for (const prefix of found) {
      expect(
        TOKEN_ROUTE_PREFIXES as readonly string[],
        `/${prefix}/[token] is not redacted`,
      ).toContain(prefix);
    }
  });
});

describe("sanitizeContext — a closed set of short strings", () => {
  it("keeps known keys and drops the rest", () => {
    expect(
      sanitizeContext({ viewport: "1280×800 @1x", cookie: "session=abc", personId: "x" }),
    ).toEqual({ viewport: "1280×800 @1x" });
  });

  it("caps values, strips control characters, ignores non-strings", () => {
    const out = sanitizeContext({
      userAgent: `a\u0000b\nc${"x".repeat(1000)}`,
      theme: 42,
      language: "   ",
    });
    expect(out).not.toHaveProperty("theme");
    expect(out).not.toHaveProperty("language");
    const agent = (out as Record<string, string>)["userAgent"] ?? "";
    expect(agent.length).toBe(300);
    expect(agent.startsWith("a b c")).toBe(true);
  });

  it("refuses arrays and primitives", () => {
    expect(sanitizeContext(["viewport"])).toEqual({});
    expect(sanitizeContext("viewport")).toEqual({});
    expect(sanitizeContext(null)).toEqual({});
  });

  it("names only keys the client actually sends", () => {
    const client = readFileSync(
      resolve(import.meta.dirname, "../../components/report-problem/report-problem.tsx"),
      "utf8",
    );
    for (const key of CONTEXT_KEYS) {
      expect(client, `the dialog never sends ${key}`).toMatch(new RegExp(`\\b${key}[:,]`));
    }
  });
});

describe("sniffImageType — the bytes decide, not the label", () => {
  it("recognises the three formats", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("refuses markup dressed as an image", () => {
    expect(sniffImageType(new Uint8Array(Buffer.from("<svg onload=alert(1)>")))).toBeNull();
    expect(sniffImageType(new Uint8Array(Buffer.from("GIF89a")))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("validateProblemReport", () => {
  it("accepts a guest's plain report", () => {
    const report = valid();
    expect(report.category).toBe("bug");
    expect(report.replyEmail).toBeNull();
    expect(report.screenshot).toBeNull();
  });

  it("insists on a description", () => {
    const result = validateProblemReport({ ...input, description: "   " }, BASE);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe("description");
    const long = validateProblemReport({ ...input, description: "x".repeat(4001) }, BASE);
    expect(!long.ok && long.field).toBe("description");
  });

  it("normalises a reply address and refuses a malformed one", () => {
    expect(valid({ replyEmail: "  Ravi@Example.COM " }).replyEmail).toBe("ravi@example.com");
    const bad = validateProblemReport({ ...input, replyEmail: "ravi@" }, BASE);
    expect(!bad.ok && bad.field).toBe("replyEmail");
  });

  it("folds a tampered category to other", () => {
    expect(valid({ category: "<script>" }).category).toBe("other");
  });

  it("records an unplaceable page as the site root, not the attacker's string", () => {
    expect(valid({ pageUrl: "https://evil.example/x" }).pageUrl).toBe(`${BASE}/`);
  });

  it("keeps a real image and types it by its bytes", () => {
    expect(valid({ screenshot: PNG }).screenshot?.contentType).toBe("image/png");
  });

  it("refuses a non-image and an oversized image", () => {
    const html = validateProblemReport(
      { ...input, screenshot: new Uint8Array(Buffer.from("<html>")) },
      BASE,
    );
    expect(!html.ok && html.field).toBe("screenshot");
    const big = new Uint8Array(SCREENSHOT_MAX_BYTES + 1);
    big.set(JPEG);
    const huge = validateProblemReport({ ...input, screenshot: big }, BASE);
    expect(!huge.ok && huge.field).toBe("screenshot");
  });

  it("treats an empty file as no screenshot", () => {
    expect(valid({ screenshot: new Uint8Array() }).screenshot).toBeNull();
  });
});

describe("the mail", () => {
  it("keeps a subject to one line, whatever was typed", async () => {
    const report = valid({ description: "Line one\nBcc: everyone@example.com\nmore" });
    const { subject } = await supportNotification(report, "01J0000000000000000000000", "a guest");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain("Line one");
  });

  it("acknowledges without promising a fix — and never repeats what was typed", async () => {
    // Echoing the description made the form a way to mail any text, from us,
    // to any address typed into it.
    const { text } = await reporterAcknowledgement(
      valid({ replyEmail: "ravi@example.com", description: "Verify at https://evil.example" }),
    );
    expect(text).not.toContain("evil.example");
    expect(text.toLowerCase()).not.toContain("will be fixed");
  });

  it("refuses an address that would smuggle fields into the desk's mailto link", () => {
    const result = validateProblemReport(
      { ...input, replyEmail: "a@b.co?cc=attacker@x.com&body=hi" },
      "https://desiauction.in",
    );
    expect(result.ok).toBe(false);
  });
});

describe("the screenshot mask", () => {
  /**
   * The mask names classes the console already renders phone numbers under.
   * A rename in one of those panels would silently un-mask it, so each class
   * must still exist somewhere in the app's source.
   */
  it("every class it masks is still rendered by the app", () => {
    const classes = [...PRIVATE_SELECTOR.matchAll(/\.([a-z-]+)/g)].map((match) => match[1] ?? "");
    expect(classes.length).toBeGreaterThan(0);
    const srcDir = resolve(import.meta.dirname, "../..");
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".tsx") && !full.includes("report-problem")) {
          sources.push(readFileSync(full, "utf8"));
        }
      }
    };
    walk(srcDir);
    for (const name of classes) {
      expect(
        sources.some((source) => source.includes(`"${name}"`)),
        `.${name} is masked but no longer rendered`,
      ).toBe(true);
    }
  });
});
