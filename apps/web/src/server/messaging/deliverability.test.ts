import { describe, expect, it } from "vitest";

import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { defaultContent, sampleVariables } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import {
  GMAIL_CLIP_BYTES,
  auditMail,
  checkDkimCname,
  checkDmarc,
  checkMx,
  checkSpf,
  organisationalDomain,
  parseDmarc,
} from "./deliverability";
import { composeNotificationEmail } from "./notification-email";
import { previewOptions } from "./template-preview";

/**
 * DELIVERABILITY, CHECKED (email programme PR19): each rule against the
 * records and mail that break it — and every design we send, audited, so a
 * design that would be clipped or carry a bad link fails CI, not an inbox.
 */

describe("SPF", () => {
  it("passes one record that authorises the provider", () => {
    expect(
      checkSpf("bounce.mail.example.in", ["v=spf1 include:amazonses.com ~all"], "amazonses.com")
        .verdict,
    ).toBe("pass");
  });

  it("fails none, two, one without the provider, and +all", () => {
    expect(checkSpf("x", [], "amazonses.com").verdict).toBe("fail");
    const two = checkSpf(
      "x",
      ["v=spf1 include:a ~all", "v=spf1 include:amazonses.com ~all"],
      "amazonses.com",
    );
    expect(two.verdict).toBe("fail");
    expect(two.detail).toContain("2 v=spf1 records");
    expect(checkSpf("x", ["v=spf1 include:zoho.in ~all"], "amazonses.com").verdict).toBe("fail");
    expect(checkSpf("x", ["v=spf1 include:amazonses.com +all"], "amazonses.com").verdict).toBe(
      "fail",
    );
  });

  it("ignores TXT records that are not SPF", () => {
    expect(
      checkSpf(
        "x",
        ["google-site-verification=abc", "v=spf1 include:amazonses.com -all"],
        "amazonses.com",
      ).verdict,
    ).toBe("pass");
  });
});

describe("DMARC", () => {
  it("reads the policy and its report address", () => {
    expect(parseDmarc(["v=DMARC1; p=quarantine; rua=mailto:d@example.in; pct=50"])).toEqual({
      p: "quarantine",
      rua: "mailto:d@example.in",
      pct: 50,
    });
    expect(parseDmarc(["v=spf1 ~all"])).toBeNull();
  });

  it("fails a missing record, warns on p=none, passes an enforced policy", () => {
    expect(checkDmarc("_dmarc.x", []).verdict).toBe("fail");
    const monitor = checkDmarc("_dmarc.x", ["v=DMARC1; p=none"]);
    expect(monitor.verdict).toBe("warn");
    expect(monitor.fix).toContain("rua=");
    expect(checkDmarc("_dmarc.x", ["v=DMARC1; p=reject"]).verdict).toBe("pass");
  });
});

describe("DKIM, MX and the organisational domain", () => {
  it("checks the CNAME points at the provider", () => {
    expect(
      checkDkimCname("s._domainkey.x", ["s.dkim.amazonses.com."], "dkim.amazonses.com").verdict,
    ).toBe("pass");
    expect(checkDkimCname("s._domainkey.x", [], "dkim.amazonses.com").verdict).toBe("fail");
    expect(checkDkimCname("s._domainkey.x", ["elsewhere.net"], "dkim.amazonses.com").verdict).toBe(
      "fail",
    );
  });

  it("checks the bounce MX", () => {
    const expect_ = "feedback-smtp.ap-south-1.amazonses.com";
    expect(checkMx("bounce.x", [`${expect_}.`], expect_).verdict).toBe("pass");
    expect(checkMx("bounce.x", [], expect_).verdict).toBe("fail");
  });

  it("walks a subdomain up to its organisational domain", () => {
    expect(organisationalDomain("mail.desiauction.in")).toBe("desiauction.in");
    expect(organisationalDomain("desiauction.in")).toBe("desiauction.in");
  });
});

describe("the content audit", () => {
  const origin = "https://desiauction.in";
  const base = {
    id: "t",
    subject: "Hello",
    text: "Hello",
    html: '<html lang="en"><a href="https://desiauction.in/home">x</a><img src="a" alt="" width="1" height="1"></html>',
  };

  it("passes a clean mail", () => {
    expect(auditMail(base, origin)).toEqual([]);
  });

  it("catches the clip, a script, a bad link, an image with no alt, no lang and no text", () => {
    const findings = auditMail(
      {
        id: "bad",
        subject: "x".repeat(90),
        text: " ",
        html: `<html><script></script><a href="http://evil.example/x">x</a><img src="a">${"x".repeat(GMAIL_CLIP_BYTES)}</html>`,
      },
      origin,
    );
    const checks = findings.map(
      (finding) => `${finding.check.replace("bad · ", "")}:${finding.verdict}`,
    );
    expect(checks).toEqual(
      expect.arrayContaining([
        "text part:fail",
        "subject:warn",
        "size:fail",
        "script:fail",
        "link:fail",
        "image:fail",
        "image:warn",
        "language:fail",
      ]),
    );
  });

  it("finds no failure in any design we send", () => {
    const own = new URL(env.PUBLIC_BASE_URL).origin;
    const failures: string[] = [];
    for (const spec of Object.values(EMAIL_TEMPLATES)) {
      if (spec.format !== "layout") continue;
      for (const language of spec.languages) {
        const content = defaultContent(spec, language);
        for (const variant of spec.variants) {
          const fields = content.variants[variant.id];
          if (fields === undefined) continue;
          const mail = composeNotificationEmail(
            spec,
            fields,
            sampleVariables(spec, language),
            previewOptions(spec.kind, variant.id, language),
          );
          for (const finding of auditMail(
            {
              id: `${spec.kind}.${variant.id}.${language}`,
              subject: mail.subject,
              text: mail.text,
              html: mail.html,
            },
            own,
          )) {
            if (finding.verdict === "fail") failures.push(`${finding.check}: ${finding.detail}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
