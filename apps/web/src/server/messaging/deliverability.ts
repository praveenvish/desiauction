/**
 * DELIVERABILITY, CHECKED (email programme PR19) — the pure half of
 * `pnpm --filter @desiauction/web mail:deliverability`.
 *
 * Two questions, answered the same way every time rather than by eye:
 *
 *   1. Will the receiving servers TRUST our mail? SPF on the envelope domain,
 *      DKIM on the From domain, DMARC on the organisational domain — and the
 *      one mistake that silently breaks SPF: two `v=spf1` records on a name.
 *   2. Will the mail RENDER and survive? Every design under Gmail's 102 KB
 *      clip, with a text part, a subject that fits, links only to us over
 *      https, and images that say what they are.
 *
 * DNS answers come in as data (the script resolves them), so every rule here
 * is a plain function with its own test.
 */

export type Verdict = "pass" | "warn" | "fail";

export interface Finding {
  readonly check: string;
  readonly verdict: Verdict;
  readonly detail: string;
  /** What to do about it, when it is not a pass. */
  readonly fix?: string;
}

// --- Authentication (DNS) --------------------------------------------------------

/** The `v=spf1` records among a name's TXT answers. */
export function spfRecords(txt: readonly string[]): string[] {
  return txt.filter((record) => /^v=spf1(\s|$)/i.test(record.trim()));
}

export function checkSpf(name: string, txt: readonly string[], mustInclude: string): Finding {
  const records = spfRecords(txt);
  if (records.length === 0) {
    return {
      check: `SPF on ${name}`,
      verdict: "fail",
      detail: "no v=spf1 record",
      fix: `Add TXT ${name} "v=spf1 include:${mustInclude} ~all".`,
    };
  }
  if (records.length > 1) {
    return {
      check: `SPF on ${name}`,
      verdict: "fail",
      detail: `${String(records.length)} v=spf1 records — receivers treat that as a permanent error`,
      fix: "Merge them into ONE record; never add a second.",
    };
  }
  const record = records[0] ?? "";
  if (!record.toLowerCase().includes(`include:${mustInclude.toLowerCase()}`)) {
    return {
      check: `SPF on ${name}`,
      verdict: "fail",
      detail: `"${record}" does not authorise ${mustInclude}`,
      fix: `Add include:${mustInclude} to that record.`,
    };
  }
  if (/\s\+all\b/i.test(record)) {
    return {
      check: `SPF on ${name}`,
      verdict: "fail",
      detail: `"${record}" ends in +all — anyone may send as you`,
      fix: "End it with ~all (or -all).",
    };
  }
  return { check: `SPF on ${name}`, verdict: "pass", detail: record };
}

export interface DmarcPolicy {
  readonly p: string | null;
  readonly rua: string | null;
  readonly pct: number | null;
}

export function parseDmarc(txt: readonly string[]): DmarcPolicy | null {
  const record = txt.find((entry) => /^v=DMARC1\s*;/i.test(entry.trim()));
  if (record === undefined) return null;
  const tags = new Map(
    record
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.includes("="))
      .map((part) => {
        const at = part.indexOf("=");
        return [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim()] as const;
      }),
  );
  const pct = tags.get("pct");
  return {
    p: tags.get("p") ?? null,
    rua: tags.get("rua") ?? null,
    pct: pct === undefined ? null : Number(pct),
  };
}

export function checkDmarc(name: string, txt: readonly string[]): Finding {
  const policy = parseDmarc(txt);
  if (policy === null) {
    return {
      check: `DMARC on ${name}`,
      verdict: "fail",
      detail: "no v=DMARC1 record — Gmail and Yahoo require one for bulk senders",
      fix: `Add TXT ${name} "v=DMARC1; p=none; rua=mailto:dmarc@<your domain>".`,
    };
  }
  if (policy.p === null) {
    return { check: `DMARC on ${name}`, verdict: "fail", detail: "the record has no p= tag" };
  }
  if (policy.p === "none") {
    return {
      check: `DMARC on ${name}`,
      verdict: "warn",
      detail: `p=none${policy.rua === null ? ", and no rua= reports" : ""} — monitoring only`,
      fix:
        policy.rua === null
          ? "Add rua= to receive reports; after a clean month, move to p=quarantine."
          : "After a clean month of reports, move to p=quarantine.",
    };
  }
  return { check: `DMARC on ${name}`, verdict: "pass", detail: `p=${policy.p}` };
}

export function checkDkimCname(
  name: string,
  cname: readonly string[],
  expectSuffix: string,
): Finding {
  const target = cname[0];
  if (target === undefined) {
    return {
      check: `DKIM ${name}`,
      verdict: "fail",
      detail: "no CNAME",
      fix: `Publish the CNAME your provider gave for ${name}.`,
    };
  }
  return target.replace(/\.$/, "").endsWith(expectSuffix)
    ? { check: `DKIM ${name}`, verdict: "pass", detail: target }
    : {
        check: `DKIM ${name}`,
        verdict: "fail",
        detail: `points at ${target}, not ${expectSuffix}`,
      };
}

export function checkMx(name: string, mx: readonly string[], expect: string): Finding {
  return mx.some((host) => host.replace(/\.$/, "") === expect)
    ? { check: `MX on ${name}`, verdict: "pass", detail: mx.join(", ") }
    : {
        check: `MX on ${name}`,
        verdict: "fail",
        detail: mx.length === 0 ? "no MX — bounces have nowhere to go" : mx.join(", "),
        fix: `Add MX ${name} → ${expect} (priority 10).`,
      };
}

/** "mail.desiauction.in" → "desiauction.in" — enough for a two-label TLD like .in. */
export function organisationalDomain(domain: string): string {
  const labels = domain.split(".");
  return labels.slice(-2).join(".");
}

// --- Content ---------------------------------------------------------------------

/** Gmail clips a message's HTML at ~102 KB; past it, the footer and unsubscribe vanish. */
export const GMAIL_CLIP_BYTES = 102 * 1024;
/** Subjects past this are cut on most phones. */
export const SUBJECT_MAX = 78;

export interface RenderedMailForAudit {
  readonly id: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string | undefined;
}

export function auditMail(mail: RenderedMailForAudit, ownOrigin: string): Finding[] {
  const findings: Finding[] = [];
  const add = (check: string, verdict: Verdict, detail: string, fix?: string) => {
    findings.push({
      check: `${mail.id} · ${check}`,
      verdict,
      detail,
      ...(fix === undefined ? {} : { fix }),
    });
  };
  if (mail.text.trim() === "") {
    add("text part", "fail", "empty — spam filters and screen readers need it");
  }
  if (mail.subject.length > SUBJECT_MAX) {
    add("subject", "warn", `${String(mail.subject.length)} characters — cut on phones`);
  }
  if (mail.html === undefined) {
    return findings;
  }
  const bytes = Buffer.byteLength(mail.html);
  if (bytes > GMAIL_CLIP_BYTES) {
    add("size", "fail", `${String(Math.round(bytes / 1024))} KB — Gmail clips at 102 KB`);
  }
  if (/<script\b/i.test(mail.html)) {
    add("script", "fail", "a <script> tag — every client strips it and filters flag it");
  }
  for (const [, href = ""] of mail.html.matchAll(/href="([^"]*)"/g)) {
    const url = href.replace(/&amp;/g, "&");
    if (url.startsWith("mailto:")) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      add("link", "fail", `not a URL: ${url}`);
      continue;
    }
    if (parsed.protocol !== "https:" && !ownOrigin.startsWith("http://")) {
      add("link", "fail", `not https: ${url}`);
    } else if (parsed.origin !== ownOrigin) {
      add("link", "warn", `links off-site: ${parsed.origin} — mismatched links look like phishing`);
    }
  }
  for (const [tag] of mail.html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt="/i.test(tag)) {
      add("image", "fail", "an <img> with no alt attribute");
    }
    if (!/\bwidth="/i.test(tag) || !/\bheight="/i.test(tag)) {
      add("image", "warn", "an <img> without width and height — the layout jumps as it loads");
    }
  }
  if (!/<html[^>]*\blang="/i.test(mail.html)) {
    add("language", "fail", "no lang on <html> — screen readers guess the language");
  }
  return findings;
}
