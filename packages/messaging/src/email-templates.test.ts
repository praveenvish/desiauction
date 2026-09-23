import type { Db } from "@desiauction/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATIONS } from "./catalogue";
import { EMAIL_TEMPLATES } from "./email-template-defaults";
import {
  MESSAGE_LANGUAGES,
  defaultContent,
  fillTemplate,
  findForeignLinks,
  ownHostsFor,
  placeholdersIn,
  sampleVariables,
  validateTemplate,
  type EmailTemplateSpec,
  type MessageLanguage,
  type TemplateContent,
  type TemplateFields,
} from "./email-templates";
import { languageFromEvidence, resolveLanguage } from "./language";
import { invalidateTemplates, resolveTemplate, variantOf } from "./template-store";

/**
 * THE TEMPLATE RULES — what an admin may and may not publish, and what a send
 * does when the stored wording is missing or wrong. Pure: no database, no web
 * tier. The byte-for-byte parity of the English defaults with the renderers
 * they replaced is proven in apps/web (email-parity.test.ts), where the layout
 * lives.
 */

const OWN = ownHostsFor("https://staging.desiauction.test");
const ctx = (language: MessageLanguage = "en") => ({ language, ownHosts: OWN });

const specs = Object.values(EMAIL_TEMPLATES);

function edit(
  spec: EmailTemplateSpec,
  change: (fields: TemplateFields) => Partial<TemplateFields>,
  language: MessageLanguage = "en",
  variant?: string,
): TemplateContent {
  const base = defaultContent(spec, language);
  const id = variant ?? spec.variants[0]?.id ?? "default";
  const fields = base.variants[id] as TemplateFields;
  return { variants: { ...base.variants, [id]: { ...fields, ...change(fields) } } };
}

function messages(
  spec: EmailTemplateSpec,
  content: TemplateContent,
  language: MessageLanguage = "en",
) {
  return validateTemplate(spec, content, ctx(language)).map((issue) => issue.message);
}

const SOLD = EMAIL_TEMPLATES["auction.sold"];
const CODE = EMAIL_TEMPLATES["auth.email_code"];
const EMAIL_CHANGED = EMAIL_TEMPLATES["security.email_changed"];
const FINANCE = EMAIL_TEMPLATES["finance.document.issued"];
const UNSOLD = EMAIL_TEMPLATES["auction.unsold"];

describe("the registry", () => {
  it("covers exactly the kinds the catalogue sends by email", () => {
    const emailKinds = NOTIFICATIONS.filter((entry) => entry.channels.includes("email")).map(
      (entry) => entry.key,
    );
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual([...emailKinds].sort());
    for (const [kind, spec] of Object.entries(EMAIL_TEMPLATES)) expect(spec.kind).toBe(kind);
  });

  it.each(
    specs.flatMap((spec) => spec.languages.map((language) => [spec.kind, language] as const)),
  )("%s (%s): the default passes every rule it will be held to", (kind, language) => {
    const spec = EMAIL_TEMPLATES[kind];
    if (!spec.editable) return; // staff notices are never validated for editing
    expect(validateTemplate(spec, defaultContent(spec, language), ctx(language))).toEqual([]);
  });

  it("every kind a customer receives has Hindi, with the same variants and the same variables", () => {
    for (const spec of specs.filter((s) => s.editable)) {
      expect(spec.languages, spec.kind).toEqual(["en", "hi"]);
      const en = defaultContent(spec, "en");
      const hi = defaultContent(spec, "hi");
      expect(Object.keys(hi.variants).sort(), spec.kind).toEqual(Object.keys(en.variants).sort());
      for (const [id, fields] of Object.entries(en.variants)) {
        const other = hi.variants[id] as TemplateFields;
        const names = (f: TemplateFields) =>
          [
            f.subject,
            f.preheader,
            f.heading,
            f.footnote,
            ...f.paragraphs,
            ...f.after,
            ...Object.values(f.actions),
          ]
            .flatMap(placeholdersIn)
            .sort();
        expect([...new Set(names(other))], `${spec.kind}/${id}`).toEqual([
          ...new Set(names(fields)),
        ]);
        expect(Object.keys(other.actions).sort(), `${spec.kind}/${id}`).toEqual(
          Object.keys(fields.actions).sort(),
        );
        // Hindi really is Hindi: some Devanagari in the subject or a paragraph.
        expect(`${other.subject}${other.paragraphs.join("")}`, spec.kind).toMatch(/[ऀ-ॿ]/);
      }
      for (const variable of spec.variables) {
        expect(variable.sample.hi, `${spec.kind} {{${variable.name}}}`).toBeDefined();
      }
    }
  });

  it("our own staff notices are English only and not editable", () => {
    for (const kind of [
      "staff.demo_request",
      "staff.problem_report",
      "staff.review_arrived",
    ] as const) {
      expect(EMAIL_TEMPLATES[kind].editable).toBe(false);
      expect(EMAIL_TEMPLATES[kind].languages).toEqual(["en"]);
      expect(
        validateTemplate(EMAIL_TEMPLATES[kind], defaultContent(EMAIL_TEMPLATES[kind], "en"), ctx()),
      ).toEqual([{ variant: null, field: null, message: "This email is not editable." }]);
    }
  });

  it("login codes lock the code and the expiry line; security alerts lock the safety line", () => {
    expect(CODE.variables.find((v) => v.name === "code")?.required).toBe(true);
    expect(CODE.locked.map((block) => block.variants)).toEqual([
      ["login"],
      ["signup"],
      ["email_change"],
    ]);
    for (const kind of ["security.phone_changed", "security.email_changed"] as const) {
      expect(EMAIL_TEMPLATES[kind].locked.map((block) => block.id)).toEqual(["if-not-you"]);
    }
  });
});

describe("validation", () => {
  it("accepts an ordinary edit", () => {
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ subject: "{{season}}: the auction is over" })),
      ),
    ).toEqual([]);
  });

  it("refuses a placeholder the kind does not have", () => {
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ subject: "Hi {{phone}}" })),
      ),
    ).toContain("{{phone}} is not a value this email has.");
  });

  it("refuses a malformed placeholder", () => {
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ subject: "Hi {{ name }}" })),
      ),
    ).toContain("A placeholder is not closed properly — write it as {{name}}.");
  });

  it("refuses to lose a required placeholder — the login code", () => {
    const content = edit(
      CODE,
      () => ({ preheader: "Your sign-in code is inside." }),
      "en",
      "login",
    );
    expect(messages(CODE, content).join(" ")).toMatch(/\{\{code\}\} must appear/);
  });

  it("refuses to remove or change a locked block", () => {
    const removed = edit(CODE, (f) => ({ after: f.after.slice(1) }), "en", "login");
    expect(messages(CODE, removed).join(" ")).toMatch(
      /locked line "It expires in 15 minutes\." must stay/,
    );
    const reworded = edit(EMAIL_CHANGED, (f) => ({
      after: f.after.map((p) => p.replace("straight away", "when you can")),
    }));
    expect(messages(EMAIL_CHANGED, reworded).join(" ")).toMatch(/locked line/);
    // Moving it is fine.
    const moved = edit(EMAIL_CHANGED, (f) => ({ after: [...f.after, "Thanks."] }));
    expect(messages(EMAIL_CHANGED, moved)).toEqual([]);
  });

  it("refuses the Hindi locked block's English text in the Hindi template", () => {
    const content = edit(
      EMAIL_CHANGED,
      () => ({ after: [EMAIL_CHANGED.locked[0]?.text.en ?? ""] }),
      "hi",
    );
    expect(messages(EMAIL_CHANGED, content, "hi").join(" ")).toMatch(/locked line/);
  });

  it("refuses a link to anywhere but our own domain — a phishing guard", () => {
    for (const lure of [
      "Confirm at https://evil.example.com/login",
      "Confirm at http://desiauction.in.evil.co/x",
      "Visit desiauction-help.co now",
      "Visit www.evil.org",
      "Write to help@evil.com",
      "Tap javascript://alert(1)",
    ]) {
      expect(
        messages(
          UNSOLD,
          edit(UNSOLD, (f) => ({ after: [...f.after, lure] })),
        ).join(" "),
        lure,
      ).toMatch(/Links may only point at desiauction\.in/);
    }
  });

  it("allows our own domain, its subdomains and PUBLIC_BASE_URL's host", () => {
    for (const ok of [
      "Help: https://desiauction.in/help",
      "See www.desiauction.in",
      "See https://app.desiauction.in/home",
      "See desiauction.in/account",
      "Staging: https://staging.desiauction.test/home",
      "Write to support@desiauction.in",
      // Not domains: a name with a dot, a time, a price.
      "Mr.Sharma plays at 7.30 pm for ₹1.5 lakh",
    ]) {
      expect(
        messages(
          UNSOLD,
          edit(UNSOLD, (f) => ({ after: [...f.after, ok] })),
        ),
        ok,
      ).toEqual([]);
    }
    expect(findForeignLinks("see https://desiauction.in.", ["desiauction.in"])).toEqual([]);
  });

  it("refuses HTML rather than escaping it silently; a lone < is fine", () => {
    for (const markup of ["<b>bold</b>", "a </p> b", "<!-- x -->", "<img src=x onerror=1>"]) {
      expect(
        messages(
          UNSOLD,
          edit(UNSOLD, () => ({ heading: markup })),
        ),
        markup,
      ).toContain("Plain text only — remove the HTML tag.");
    }
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ heading: "Under 5 < 10" })),
      ),
    ).toEqual([]);
  });

  it("keeps the subject to one line, and every field within its length", () => {
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ subject: "One\nBcc: all@example.com" })),
      ),
    ).toContain("Keep this to one line.");
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ subject: "x".repeat(151) })),
      ),
    ).toContain("Keep this under 150 characters.");
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ paragraphs: ["x".repeat(1001)] })),
      ),
    ).toContain("Keep a paragraph under 1000 characters.");
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ paragraphs: Array(13).fill("Hi") })),
      ),
    ).toContain("At most 12 paragraphs here.");
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ subject: "  " })),
      ),
    ).toContain("This cannot be empty.");
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ paragraphs: [] })),
      ),
    ).toContain("Write at least one paragraph.");
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ actions: { season: "x".repeat(41) } })),
      ),
    ).toContain("Keep a button label under 40 characters.");
  });

  it("refuses invisible direction overrides", () => {
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, () => ({ heading: "Hi ‮evil" })),
      ),
    ).toContain("Remove the invisible control characters.");
  });

  it("keeps a list to a paragraph of its own, and a flag out of the subject", () => {
    const appointed = EMAIL_TEMPLATES["team.appointed"];
    expect(
      messages(
        appointed,
        edit(appointed, (f) => ({ paragraphs: [...f.paragraphs, "Roles: {{roleLines}}"] })),
      ).join(" "),
    ).toMatch(/is a list/);
    expect(
      messages(
        appointed,
        edit(appointed, () => ({ subject: "{{ifSignedDirect}} hi" })),
      ).join(" "),
    ).toMatch(/decides whether a paragraph shows/);
  });

  it("finance: only the subject and the opening paragraphs are editable", () => {
    expect(
      messages(
        FINANCE,
        edit(FINANCE, () => ({ subject: "Your receipt", paragraphs: ["Thanks for paying."] })),
      ),
    ).toEqual([]);
    expect(
      messages(
        FINANCE,
        edit(FINANCE, () => ({ footnote: "hi" })),
      ),
    ).toContain("This part cannot be changed.");
  });

  it("refuses a missing variant, an unknown variant and an unknown button", () => {
    const base = defaultContent(CODE, "en");
    const rest = Object.fromEntries(Object.entries(base.variants).filter(([id]) => id !== "login"));
    expect(messages(CODE, { variants: rest }).join(" ")).toMatch(/"Sign-in" is missing/);
    expect(
      messages(CODE, {
        variants: { ...base.variants, extra: base.variants["login"] as TemplateFields },
      }),
    ).toContain("There is no such version of this email.");
    expect(
      messages(
        UNSOLD,
        edit(UNSOLD, (f) => ({ actions: { ...f.actions, other: "Go" } })),
      ),
    ).toContain("There is no such button.");
  });
});

describe("filling a template", () => {
  it("drops a paragraph whose optional value is empty, keeps it otherwise", () => {
    const fields = defaultContent(SOLD, "en").variants["default"] as TemplateFields;
    const vars = { ...sampleVariables(SOLD, "en"), highlight: "" };
    expect(fillTemplate(SOLD, fields, vars).paragraphs.join("|")).not.toContain("night");
    expect(fillTemplate(SOLD, fields, sampleVariables(SOLD, "en")).paragraphs.join("|")).toContain(
      "most expensive buy of the night.",
    );
  });

  it("shows a flagged paragraph only when the flag is on, and prints nothing for the flag", () => {
    const spec = EMAIL_TEMPLATES["team.appointed"];
    const fields = defaultContent(spec, "en").variants["default"] as TemplateFields;
    const on = fillTemplate(spec, fields, { ...sampleVariables(spec, "en"), ifSignedDirect: true });
    expect(on.paragraphs).toContain(
      "You join Cup Kings directly, without going through the auction.",
    );
    const off = fillTemplate(spec, fields, {
      ...sampleVariables(spec, "en"),
      ifSignedDirect: false,
    });
    expect(off.paragraphs.join("|")).not.toContain("directly");
  });

  it("expands a list into one paragraph per item", () => {
    const spec = EMAIL_TEMPLATES["team.appointed"];
    const fields = defaultContent(spec, "en").variants["default"] as TemplateFields;
    const filled = fillTemplate(spec, fields, {
      ...sampleVariables(spec, "en"),
      roleLines: ["One.", "Two."],
    });
    expect(filled.paragraphs).toEqual(expect.arrayContaining(["One.", "Two."]));
  });

  it("substitutes once: a value that looks like a placeholder is printed as-is", () => {
    const fields = defaultContent(UNSOLD, "en").variants["default"] as TemplateFields;
    const filled = fillTemplate(UNSOLD, fields, {
      name: "{{season}}",
      season: "MPL",
      orgName: "X",
    });
    expect(filled.paragraphs[0]).toBe("Hi {{season}},");
  });
});

describe("one language per person", () => {
  it("the chosen language wins, then the WhatsApp consent's, then English", () => {
    expect(resolveLanguage("hi", "en")).toBe("hi");
    expect(resolveLanguage("en", "hi")).toBe("en");
    expect(resolveLanguage(null, "hi")).toBe("hi");
    expect(resolveLanguage(null, null)).toBe("en");
    expect(resolveLanguage("fr", null)).toBe("en");
  });

  it("reads the newest consent record that names a language, skipping a bare STOP/START", () => {
    expect(
      languageFromEvidence([{ evidence: { source: "webhook" } }, { evidence: { language: "hi" } }]),
    ).toBe("hi");
    expect(languageFromEvidence([{ evidence: null }, { evidence: { language: "xx" } }])).toBeNull();
  });
});

/** A database that answers the one query the store makes. */
function fakeDb(rows: unknown[] | Error): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)),
      }),
    }),
  } as unknown as Db;
}

function published(kind: string, language: MessageLanguage, content: TemplateContent, version = 3) {
  return { id: `row-${kind}-${language}`, kind, language, version, content };
}

describe("the fallback chain", () => {
  afterEach(() => {
    invalidateTemplates();
  });

  const hiDefault = defaultContent(UNSOLD, "hi");
  const edited = edit(UNSOLD, () => ({ subject: "आपकी नीलामी — {{season}}" }), "hi");

  it("uses the published wording in the reader's language", async () => {
    const resolved = await resolveTemplate(
      fakeDb([published("auction.unsold", "hi", edited)]),
      "auction.unsold",
      "hi",
      {
        ownHosts: OWN,
      },
    );
    expect(resolved).toMatchObject({ source: "published", version: 3, language: "hi" });
    expect(variantOf(resolved, undefined).subject).toBe("आपकी नीलामी — {{season}}");
  });

  it("falls back to that language's default when nothing is published in it", async () => {
    const resolved = await resolveTemplate(
      fakeDb([published("auction.unsold", "en", defaultContent(UNSOLD, "en"))]),
      "auction.unsold",
      "hi",
      { ownHosts: OWN },
    );
    expect(resolved).toMatchObject({ source: "default", language: "hi" });
    expect(resolved.content).toEqual(hiDefault);
  });

  it("falls back to English for a kind with no Hindi (our own notices)", async () => {
    const resolved = await resolveTemplate(fakeDb([]), "staff.review_arrived", "hi", {
      ownHosts: OWN,
    });
    expect(resolved.language).toBe("en");
    expect(resolved.content).toEqual(defaultContent(EMAIL_TEMPLATES["staff.review_arrived"], "en"));
  });

  it("an invalid published row falls back to the default, and says so", async () => {
    const onProblem = vi.fn();
    const bad = edit(UNSOLD, () => ({ subject: "Click https://evil.example.com" }), "hi");
    const resolved = await resolveTemplate(
      fakeDb([published("auction.unsold", "hi", bad, 7)]),
      "auction.unsold",
      "hi",
      { ownHosts: OWN, onProblem },
    );
    expect(resolved).toMatchObject({ source: "default" });
    expect(onProblem).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "auction.unsold", reason: "invalid", version: 7 }),
    );
  });

  it("a row not in the template shape falls back too", async () => {
    const onProblem = vi.fn();
    const resolved = await resolveTemplate(
      fakeDb([published("auction.unsold", "en", { nope: true } as unknown as TemplateContent)]),
      "auction.unsold",
      "en",
      { ownHosts: OWN, onProblem },
    );
    expect(resolved.source).toBe("default");
    expect(onProblem).toHaveBeenCalledOnce();
  });

  it("an unreadable table never blanks a mail — the default goes out", async () => {
    const onProblem = vi.fn();
    const resolved = await resolveTemplate(
      fakeDb(new Error("permission denied")),
      "auction.unsold",
      "en",
      {
        ownHosts: OWN,
        onProblem,
      },
    );
    expect(resolved.source).toBe("default");
    expect(onProblem).toHaveBeenCalledWith(expect.objectContaining({ reason: "load_failed" }));
  });

  it("caches for the TTL, and a publish in this process drops the cache", async () => {
    const db = fakeDb([
      published(
        "auction.unsold",
        "en",
        edit(UNSOLD, () => ({ subject: "v1" })),
      ),
    ]);
    const spy = vi.spyOn(db, "select");
    await resolveTemplate(db, "auction.unsold", "en", { ownHosts: OWN, now: 1000 });
    await resolveTemplate(db, "auction.unsold", "en", { ownHosts: OWN, now: 20_000 });
    expect(spy).toHaveBeenCalledTimes(1);
    await resolveTemplate(db, "auction.unsold", "en", { ownHosts: OWN, now: 40_000 });
    expect(spy).toHaveBeenCalledTimes(2);
    invalidateTemplates();
    await resolveTemplate(db, "auction.unsold", "en", { ownHosts: OWN, now: 40_001 });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("never looks up a kind that is not editable", async () => {
    const db = fakeDb(new Error("should not be read"));
    const spy = vi.spyOn(db, "select");
    await resolveTemplate(db, "staff.demo_request", "en", { ownHosts: OWN });
    expect(spy).not.toHaveBeenCalled();
  });

  it("MESSAGE_LANGUAGES is English and Hindi", () => {
    expect(MESSAGE_LANGUAGES).toEqual(["en", "hi"]);
  });
});
