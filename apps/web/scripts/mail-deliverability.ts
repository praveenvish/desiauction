import { Resolver } from "node:dns/promises";
import { writeFileSync } from "node:fs";

import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { defaultContent, sampleVariables } from "@desiauction/messaging/email-templates";
import { selectedProvider } from "@desiauction/messaging/mail-provider";

import { env } from "../src/env.js";
import {
  auditMail,
  checkDkimCname,
  checkDmarc,
  checkMx,
  checkSpf,
  organisationalDomain,
  type Finding,
} from "../src/server/messaging/deliverability.js";
import { composeNotificationEmail } from "../src/server/messaging/notification-email.js";
import { previewOptions } from "../src/server/messaging/template-preview.js";

/**
 * DELIVERABILITY, CHECKED (email programme PR19).
 *
 *   pnpm --filter @desiauction/web mail:deliverability
 *       [--domain=mail.desiauction.in]   the From domain (default: EMAIL_FROM's)
 *       [--dkim=sel1,sel2,sel3]          DKIM selectors to look up (SES gives three)
 *       [--ns=ns1.dns-parking.com]       ask the authoritative server, not a cache
 *       [--provider=ses|resend]          whose records (default: the configured one)
 *       [--offline]                      skip DNS; audit the designs only
 *       [--report=path.md]               also write the findings as Markdown
 *
 * Two halves, each a list of pass / warn / fail with the fix beside it:
 * AUTHENTICATION (SPF, DKIM, DMARC, the bounce MX — for the provider in use)
 * and CONTENT (every design × language × version, as the gallery renders it).
 * Exits 1 on any fail, so it can gate a release. What it cannot check — how a
 * message lands in a real inbox — is the checklist in
 * docs/operations/EMAIL_DELIVERABILITY.md.
 */

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
const has = (name: string) => process.argv.includes(`--${name}`);

function fromDomain(): string {
  const from = env.EMAIL_FROM ?? "";
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const domain = address.slice(address.lastIndexOf("@") + 1).trim();
  return domain === "" ? "mail.desiauction.in" : domain;
}

async function resolverFor(ns: string | undefined): Promise<Resolver> {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  if (ns !== undefined) {
    const [address] = await new Resolver().resolve4(ns);
    if (address !== undefined) resolver.setServers([address]);
  }
  return resolver;
}

async function answer<T>(lookup: () => Promise<T[]>): Promise<T[]> {
  try {
    return await lookup();
  } catch {
    return [];
  }
}

async function authentication(): Promise<Finding[]> {
  const domain = flag("domain") ?? fromDomain();
  const resolver = await resolverFor(flag("ns"));
  const txt = async (name: string) =>
    (await answer(() => resolver.resolveTxt(name))).map((chunks) => chunks.join(""));
  const chosen = flag("provider");
  const provider =
    chosen === "ses" || chosen === "resend" ? chosen : (selectedProvider(env) ?? "ses");
  const findings: Finding[] = [];

  if (provider === "ses") {
    // SES sends with a custom MAIL FROM on bounce.<domain>: SPF and the bounce MX live there.
    const bounce = `bounce.${domain}`;
    const region = env.SES_REGION ?? "ap-south-1";
    findings.push(checkSpf(bounce, await txt(bounce), "amazonses.com"));
    findings.push(
      checkMx(
        bounce,
        (await answer(() => resolver.resolveMx(bounce))).map((mx) => mx.exchange),
        `feedback-smtp.${region}.amazonses.com`,
      ),
    );
    const selectors = (flag("dkim") ?? "").split(",").filter((s) => s !== "");
    if (selectors.length === 0) {
      findings.push({
        check: "DKIM",
        verdict: "warn",
        detail: "no selectors given — nothing looked up",
        fix: "Pass --dkim=<the three SES selectors> (docs/EMAIL_INFRASTRUCTURE.md → DNS).",
      });
    }
    for (const selector of selectors) {
      const name = `${selector}._domainkey.${domain}`;
      findings.push(
        checkDkimCname(name, await answer(() => resolver.resolveCname(name)), "dkim.amazonses.com"),
      );
    }
  } else {
    // Resend: its return path (send.<domain>) is a CNAME/MX to Resend's own
    // servers, which carry the SPF; what is ours to publish is the DKIM key.
    const name = `resend._domainkey.${domain}`;
    const key = await txt(name);
    findings.push(
      key.some((record) => record.includes("p="))
        ? { check: `DKIM ${name}`, verdict: "pass", detail: "key published" }
        : {
            check: `DKIM ${name}`,
            verdict: "fail",
            detail: "no DKIM key",
            fix: "Publish Resend's DKIM TXT.",
          },
    );
    const returnPath = `send.${domain}`;
    // A CNAME to Resend's servers, or an MX — an authoritative server does not
    // chase the CNAME into Resend's zone, so either is the record we publish.
    const cname = await answer(() => resolver.resolveCname(returnPath));
    const mx = (await answer(() => resolver.resolveMx(returnPath))).map((row) => row.exchange);
    const found = [...cname, ...mx];
    findings.push(
      found.length > 0
        ? { check: `Return path ${returnPath}`, verdict: "pass", detail: found.join(", ") }
        : {
            check: `Return path ${returnPath}`,
            verdict: "fail",
            detail: "no CNAME or MX — Resend's return path is missing",
            fix: "Publish Resend's send.<domain> records.",
          },
    );
  }

  // DMARC: the From domain's own, else the organisational domain's (inherited).
  const own = await txt(`_dmarc.${domain}`);
  const org = organisationalDomain(domain);
  findings.push(
    own.length > 0
      ? checkDmarc(`_dmarc.${domain}`, own)
      : checkDmarc(`_dmarc.${org}`, await txt(`_dmarc.${org}`)),
  );
  // The one mistake that breaks everything silently: two SPF records at the root.
  const root = (await txt(org)).filter((record) => /^v=spf1(\s|$)/i.test(record));
  findings.push(
    root.length > 1
      ? {
          check: `SPF on ${org}`,
          verdict: "fail",
          detail: `${String(root.length)} v=spf1 records at the root`,
          fix: "Merge them into one — receivers treat two as a permanent error.",
        }
      : {
          check: `SPF on ${org}`,
          verdict: "pass",
          detail: root[0] ?? "(none — fine: SES sends from its own MAIL FROM)",
        },
  );
  return findings;
}

function content(): Finding[] {
  const origin = new URL(env.PUBLIC_BASE_URL).origin;
  const findings: Finding[] = [];
  let audited = 0;
  for (const spec of Object.values(EMAIL_TEMPLATES)) {
    if (spec.format !== "layout") continue;
    for (const language of spec.languages) {
      const contentFor = defaultContent(spec, language);
      for (const variant of spec.variants) {
        const fields = contentFor.variants[variant.id];
        if (fields === undefined) continue;
        const mail = composeNotificationEmail(
          spec,
          fields,
          sampleVariables(spec, language),
          previewOptions(spec.kind, variant.id, language),
        );
        audited += 1;
        findings.push(
          ...auditMail(
            {
              id: `${spec.kind}.${variant.id}.${language}`,
              subject: mail.subject,
              text: mail.text,
              html: mail.html,
            },
            origin,
          ),
        );
      }
    }
  }
  findings.unshift({
    check: "designs audited",
    verdict: "pass",
    detail: `${String(audited)} designs × languages × versions`,
  });
  return findings;
}

const MARK = { pass: "✓", warn: "!", fail: "✗" } as const;

function print(title: string, findings: readonly Finding[]): string[] {
  const lines = [`## ${title}`, ""];
  for (const finding of findings) {
    lines.push(`- ${MARK[finding.verdict]} **${finding.check}** — ${finding.detail}`);
    if (finding.fix !== undefined) lines.push(`  - fix: ${finding.fix}`);
  }
  lines.push("");
  return lines;
}

const auth = has("offline") ? [] : await authentication();
const designs = content();
const all = [...auth, ...designs];
const counts = {
  pass: all.filter((f) => f.verdict === "pass").length,
  warn: all.filter((f) => f.verdict === "warn").length,
  fail: all.filter((f) => f.verdict === "fail").length,
};
const report = [
  "# Email deliverability",
  "",
  `${String(counts.pass)} pass · ${String(counts.warn)} warn · ${String(counts.fail)} fail`,
  "",
  ...(auth.length === 0 ? [] : print("Authentication", auth)),
  // The content half lists only what is worth reading: the summary, then problems.
  ...print(
    "Content",
    designs.filter((finding) => finding.verdict !== "pass" || finding.check === "designs audited"),
  ),
].join("\n");
console.log(report);
const out = flag("report");
if (out !== undefined) writeFileSync(out, `${report}\n`);
process.exitCode = counts.fail > 0 ? 1 : 0;
