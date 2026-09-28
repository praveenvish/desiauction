import { describe, expect, it } from "vitest";

import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { defaultContent, sampleVariables } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import {
  FOOTER_WORDS,
  SUPPORT_EMAIL,
  applyWhatsAppNudge,
  forceDarkEmail,
  renderEmail,
} from "./email-layout";
import { composeNotificationEmail } from "./notification-email";
import { previewOptions } from "./template-preview";

/**
 * EMAIL V2 — THE RULES EVERY CUSTOMER MAIL KEEPS (docs/design/email-v2).
 *
 * Rendered the way the admin preview renders them: every kind, every variant,
 * every language it is sent in, with the code's sample facts. Each one must be
 * small enough that Gmail never clips it, say which language it is in, link
 * only to us, and carry "Manage emails" exactly when the reader has a switch
 * for it.
 */

/** Gmail clips a message at ~102 KB; our budget leaves room for a long squad. */
const BUDGET_BYTES = 60_000;

const OWN = new URL(env.PUBLIC_BASE_URL).origin;

/** The kinds a reader can switch off on /account (notification-email.ts). */
const MANAGEABLE = new Set([
  "auction.schedule",
  "auction.reminder",
  // "Club updates" (PR5) — but never a moderation notice: no switch stops those.
  "club.welcome",
  "club.member_joined",
  "plan.requested",
  "plan.answered",
  "auction.owners_ready",
  "auction.results",
  "registration.first",
  "registration.digest",
  "registration.received",
  "registration.approved",
  "registration.waitlisted",
  "registration.rejected",
  "registration.withdrawn",
  "registration.restored",
  "auction.sold",
  "auction.unsold",
  "auction.owner_summary",
  "team.appointed",
  "team.squad_sheet",
  "lineup.announced",
  // Match updates (PR11).
  "schedule.published",
  "fixture.changed",
  "match.day",
  "season.champion",
  "review.platform_ask",
  "review.season_ask",
]);

const CASES = Object.values(EMAIL_TEMPLATES)
  .filter((spec) => spec.format === "layout")
  .flatMap((spec) =>
    spec.languages.flatMap((language) =>
      spec.variants.map((variant) => ({ spec, language, variant: variant.id })),
    ),
  );

function render(c: (typeof CASES)[number]) {
  const fields = defaultContent(c.spec, c.language).variants[c.variant];
  if (fields === undefined) throw new Error(`${c.spec.kind}/${c.variant} has no ${c.language}`);
  return composeNotificationEmail(
    c.spec,
    fields,
    sampleVariables(c.spec, c.language),
    previewOptions(c.spec.kind, c.variant, c.language),
  );
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => (m[1] ?? "").replace(/&amp;/g, "&"));
}

describe("every customer mail, in every language", () => {
  it("covers every branded kind", () => {
    expect(new Set(CASES.map((c) => c.spec.kind)).size).toBeGreaterThanOrEqual(20);
  });

  it.each(CASES.map((c) => [`${c.spec.kind} · ${c.variant} · ${c.language}`, c] as const))(
    "%s",
    (_name, c) => {
      const mail = render(c);
      const html = mail.html ?? "";

      // Small enough that no inbox clips it.
      expect(Buffer.byteLength(html)).toBeLessThan(BUDGET_BYTES);

      // Says which language it is in — the document and the card both.
      expect(html).toContain(`<html lang="${c.language}"`);
      expect(html).toContain(`role="article"`);
      expect(html).toMatch(new RegExp(`role="article"[^>]*lang="${c.language}"`));
      if (c.language === "hi") expect(html).toContain("Noto Sans Devanagari");

      // Light by default, dark only as an addition.
      expect(html).toContain(`name="color-scheme" content="light dark"`);
      expect(html).toContain("/*da:dark*/");

      // Links only to us (and our help address). A code mail has none at all.
      const links = hrefs(html);
      if (c.spec.kind === "auth.email_code") {
        expect(links).toEqual([]);
        expect(mail.text).not.toMatch(/https?:\/\//);
      }
      for (const link of links) {
        expect(link === `mailto:${SUPPORT_EMAIL}` || link.startsWith(OWN)).toBe(true);
      }

      // "Manage emails" exactly when the reader has a switch for it.
      const manage = MANAGEABLE.has(c.spec.kind);
      const label = FOOTER_WORDS[c.language].manage;
      expect(html.includes(label)).toBe(manage);
      expect(mail.text.includes(`${label}:`)).toBe(manage);

      // The plain part carries the same heading first.
      expect(mail.text.split("\n")[0]).not.toBe("");
    },
  );
});

describe("the layout itself", () => {
  const content = {
    preheader: "Preview",
    heading: `<script>alert("x")</script> & co`,
    paragraphs: ["One <b>line</b>"],
    details: [["Purse", "₹1,50,000"]] as const,
    action: { label: "Open", url: `${OWN}/home?a=1&b=2` },
    footnote: "Because.",
  };

  it("lists matches on small leaves, in both parts", () => {
    const mail = renderEmail({
      ...content,
      fixtures: [
        {
          month: "OCT",
          day: "4",
          weekday: "SUN",
          title: "vs <Tigers>",
          detail: "7:30 pm IST · Malad Ground",
          note: "Moved",
        },
      ],
    });
    expect(mail.html).toContain("vs &lt;Tigers&gt;");
    expect(mail.html).toContain("Moved");
    expect(mail.text).toContain("  SUN 4 OCT · vs <Tigers> · 7:30 pm IST · Malad Ground (Moved)");
  });

  it("draws the matchup in the teams' colours, and gold for anything that is not one", () => {
    const side = (name: string, color: string | null, yours: boolean) => ({
      name,
      monogram: name.slice(0, 2).toUpperCase(),
      color,
      yours,
    });
    const mail = renderEmail({
      ...content,
      band: { title: "Season", subtitle: "Club", monogram: "SC" },
      matchup: {
        kicker: "Match day",
        home: side("Cup Kings", "#1E6FD9", true),
        away: side("Tigers", "red;background:url(x)", false),
        versus: "vs",
        yoursLabel: "Your team",
        line: "Sun 4 Oct · 7:30 pm IST · Malad Ground",
      },
    });
    expect(mail.html).toContain("border:3px solid #1E6FD9");
    expect(mail.html).not.toContain("url(x)");
    expect(mail.html).toContain("Your team");
    // The matchup replaces the club band, like the stage.
    expect(mail.html).not.toContain(">Season<");
    expect(mail.text.startsWith("Match day: Cup Kings vs Tigers\nSun 4 Oct · 7:30 pm IST")).toBe(
      true,
    );
  });

  it("escapes every string", () => {
    const { html } = renderEmail(content);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("One &lt;b&gt;line&lt;/b&gt;");
    expect(html).toContain(`href="${OWN}/home?a=1&amp;b=2"`);
  });

  it("gives the button ink text on the gold fill — never white on gold", () => {
    const { html } = renderEmail(content);
    expect(html).toMatch(/background:#F0B43C[^"]*"><a class="da-btn"[^>]*color:#070A0F/);
  });

  it("defaults to English and switches fonts for Hindi", () => {
    expect(renderEmail(content).html).toContain(`<html lang="en"`);
    const hi = renderEmail({ ...content, language: "hi" }).html;
    expect(hi).toContain(`<html lang="hi"`);
    expect(hi).toContain("Noto Sans Devanagari");
  });

  it("drops the manage link from a mail with no links", () => {
    const mail = renderEmail({
      preheader: content.preheader,
      heading: "Your sign-in code",
      paragraphs: content.paragraphs,
      code: "482913",
      footnote: content.footnote,
      noLinks: true,
      manageUrl: OWN,
    });
    expect(hrefs(mail.html)).toEqual([]);
    expect(mail.text).not.toContain("Manage emails");
  });

  it("can show its dark rendering unconditionally, for previews", () => {
    const { html } = renderEmail(content);
    const dark = forceDarkEmail(html);
    expect(dark).not.toContain("prefers-color-scheme");
    expect(dark).toContain(".da-card { background:#101623 !important;");
  });

  it("boxes the closing line when asked, its first sentence in bold", () => {
    const html = renderEmail({
      ...content,
      after: ["It expires in 15 minutes.", "Did not try to sign in? Someone entered your address."],
      calloutLast: true,
    }).html;
    expect(html).toContain('class="da-notice"');
    expect(html).toContain(
      '<strong class="da-heading" style="color:#1A1814;">Did not try to sign in?</strong> Someone entered your address.',
    );
    // Only the last one: the expiry line stays a plain paragraph.
    expect(html.match(/da-notice/g)?.length).toBe(2); // the box, and its dark-mode rule
    const hindi = renderEmail({
      ...content,
      after: ["आपने यह नहीं माँगा? इसे अनदेखा करें।"],
      calloutLast: true,
    }).html;
    expect(hindi).toContain(">आपने यह नहीं माँगा?</strong> इसे अनदेखा करें।");
  });

  it("keeps room for the WhatsApp nudge and fills it at send time", () => {
    const mail = renderEmail({ ...content, whatsappNudge: true });
    const filled = applyWhatsAppNudge(mail, true);
    expect(filled.html).toContain("Get these on WhatsApp");
    expect(filled.text).toContain("Get these on WhatsApp");
    expect(applyWhatsAppNudge(mail, false).html).toBe(mail.html);
  });
});
