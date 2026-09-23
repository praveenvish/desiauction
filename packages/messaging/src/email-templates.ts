import type { EmailNotificationKind } from "./catalogue";

/**
 * EDITABLE EMAIL WORDING — the shape, the rules, and the substitution
 * (Notification Control Center, Phase 2).
 *
 * Before this, every email's words were a template literal inside the function
 * that sent it. Changing "Your sign-in code" meant a deploy. The founder wants
 * the people who run messaging to change wording without one, in English and
 * Hindi, with the safety rails a compromised admin account cannot talk its way
 * past. So the wording is DATA now, in one structured shape:
 *
 *   subject · preheader · heading · paragraphs[] · after[] · button labels · footnote
 *
 * — the same parts `renderEmail` (apps/web email-layout.ts) lays out. What stays
 * CODE, on purpose, and is never editable:
 *
 *   · every URL. A button's label is words; where it goes is ours. A template
 *     cannot carry a link anywhere but our own domain (see `findForeignLinks`).
 *   · the layout, the brand, the escaping. Wording is plain text, always.
 *   · the facts: a code block, the details table (a squad, a booking), the
 *     document body of a receipt. Computed sentences whose grammar depends on
 *     the data — "Cup Kings, Tigers and Falcons all bid for you" — are
 *     variables the code writes in each language, which an admin may move or
 *     remove but not reword.
 *
 * Pure, with no database import: the admin editor imports this module in the
 * browser for inline validation, and the server runs the SAME rules at save, at
 * publish and again at render. The code defaults live beside it
 * (email-template-defaults.ts); the published rows in `notification_templates`
 * (0087, template-store.ts).
 */

export const MESSAGE_LANGUAGES = ["en", "hi"] as const;
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number];

export function isMessageLanguage(value: unknown): value is MessageLanguage {
  return value === "en" || value === "hi";
}

/** Each language named in itself — a Hindi reader looks for हिन्दी, not "Hindi". */
export const MESSAGE_LANGUAGE_LABELS: Readonly<Record<MessageLanguage, string>> = {
  en: "English",
  hi: "हिन्दी",
};

/** The wording of ONE variant of one email, in one language. */
export interface TemplateFields {
  readonly subject: string;
  /** The hidden preview line. Empty for a plain-text mail. */
  readonly preheader: string;
  /** Empty for a plain-text mail. */
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** Paragraphs after the code, button or details. */
  readonly after: readonly string[];
  /** Button label per action id. The URL is the code's. */
  readonly actions: Readonly<Record<string, string>>;
  /** Why this person received this mail. Empty for a plain-text mail. */
  readonly footnote: string;
}

export type TemplateField = keyof TemplateFields;

/** What is stored in `notification_templates.content`. */
export interface TemplateContent {
  readonly variants: Readonly<Record<string, TemplateFields>>;
}

/**
 * A value a template may name as `{{name}}`.
 *
 *   · text — always has a value (a name, a season, an amount).
 *   · text with `whenEmpty: "drop"` — may be empty; a paragraph naming it is
 *     then left out ("Your first match: {{firstMatch}}." when there is none).
 *   · text with `whenEmpty: "blank"` — may be empty; prints nothing.
 *   · flag — prints nothing, ever. A paragraph naming it is shown only when
 *     the flag is on: "{{ifSignedDirect}}You join {{teamName}} directly…".
 *   · list — only as a whole paragraph, which becomes one paragraph per item.
 */
export interface TemplateVariable {
  readonly name: string;
  readonly description: string;
  readonly type?: "text" | "flag" | "list";
  /** Must appear somewhere in every variant (the login code, the new number's last digits). */
  readonly required?: boolean;
  readonly whenEmpty?: "drop" | "blank";
  /** Written by DesiAuction in each language — it can be moved, not reworded. */
  readonly computed?: boolean;
  /** What the editor's preview and a test send use. */
  readonly sample: Readonly<Record<MessageLanguage, string | readonly string[] | boolean>>;
}

/**
 * A block an admin cannot remove or change: the login code's expiry line, a
 * security alert's "if this wasn't you" line. It must appear, word for word,
 * as one whole entry of `field`, in every variant it applies to.
 */
export interface LockedBlock {
  readonly id: string;
  readonly field: "paragraphs" | "after";
  /** Variants it applies to; omitted = every variant. */
  readonly variants?: readonly string[];
  readonly text: Readonly<Record<MessageLanguage, string>>;
  /** Shown in the editor beside the locked block. */
  readonly why: string;
}

export interface TemplateAction {
  readonly id: string;
  /** Where it goes, in words, for the editor ("the player's season page"). */
  readonly description: string;
}

export interface TemplateVariant {
  readonly id: string;
  /** For the editor ("Sign-in", "The day before"). */
  readonly label: string;
}

export interface EmailTemplateSpec {
  readonly kind: EmailNotificationKind;
  /**
   * `layout`: the branded HTML mail with a plain-text twin (renderEmail).
   * `plain`: plain text only — our own staff notices, a report receipt, a
   * finance document whose body IS the document.
   */
  readonly format: "layout" | "plain";
  /** False: our own staff notices. Shown on the grid, never edited. */
  readonly editable: boolean;
  /** Which fields an admin may change; the rest are fixed to the default. */
  readonly editableFields: readonly TemplateField[];
  readonly languages: readonly MessageLanguage[];
  readonly variants: readonly TemplateVariant[];
  readonly actions: readonly TemplateAction[];
  readonly variables: readonly TemplateVariable[];
  readonly locked: readonly LockedBlock[];
  /** What the editor says about this kind's scope, when it needs saying. */
  readonly note?: string;
  readonly defaults: Readonly<Partial<Record<MessageLanguage, TemplateContent>>>;
}

export const LAYOUT_FIELDS: readonly TemplateField[] = [
  "subject",
  "preheader",
  "heading",
  "paragraphs",
  "after",
  "actions",
  "footnote",
];

export const PLAIN_FIELDS: readonly TemplateField[] = ["subject", "paragraphs"];

// ---------------------------------------------------------------------------
// Placeholders.
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;

/** Every `{{name}}` in a piece of text, in order. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

/** Braces that are not a well-formed `{{name}}` — a typo that would print as-is. */
function strayBraces(text: string): boolean {
  const rest = text.replace(PLACEHOLDER, "");
  return rest.includes("{{") || rest.includes("}}");
}

export type VariableValue = string | readonly string[] | boolean;
export type TemplateVariables = Readonly<Record<string, VariableValue>>;

function isEmpty(value: VariableValue | undefined): boolean {
  if (value === undefined || value === false) return true;
  if (typeof value === "string") return value === "";
  if (typeof value === "boolean") return false;
  return value.length === 0;
}

/**
 * ONE PASS over the template, never over the values: a player named
 * "{{code}}" is printed as those eight characters, not expanded.
 */
function substitute(text: string, variables: TemplateVariables): string {
  return text.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = variables[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return (value as readonly string[]).join(", ");
    // Flags print nothing; an unknown name cannot reach here past validation.
    return "";
  });
}

function fillParagraphs(
  paragraphs: readonly string[],
  spec: EmailTemplateSpec,
  variables: TemplateVariables,
): string[] {
  const byName = new Map(spec.variables.map((variable) => [variable.name, variable]));
  return paragraphs.flatMap((paragraph) => {
    const names = placeholdersIn(paragraph);
    const whole = /^\{\{([A-Za-z][A-Za-z0-9]*)\}\}$/.exec(paragraph.trim());
    if (whole !== null && byName.get(whole[1] ?? "")?.type === "list") {
      const value = variables[whole[1] ?? ""];
      return Array.isArray(value) ? [...(value as readonly string[])] : [];
    }
    for (const name of names) {
      const variable = byName.get(name);
      const value = variables[name];
      if (variable?.type === "flag" && value !== true) return [];
      if (variable?.whenEmpty === "drop" && isEmpty(value)) return [];
    }
    return [substitute(paragraph, variables)];
  });
}

/** The wording with every placeholder replaced, and every conditional paragraph decided. */
export function fillTemplate(
  spec: EmailTemplateSpec,
  fields: TemplateFields,
  variables: TemplateVariables,
): TemplateFields {
  const actions: Record<string, string> = {};
  for (const [id, label] of Object.entries(fields.actions)) {
    actions[id] = substitute(label, variables);
  }
  return {
    subject: substitute(fields.subject, variables),
    preheader: substitute(fields.preheader, variables),
    heading: substitute(fields.heading, variables),
    paragraphs: fillParagraphs(fields.paragraphs, spec, variables),
    after: fillParagraphs(fields.after, spec, variables),
    actions,
    footnote: substitute(fields.footnote, variables),
  };
}

/** The samples, as variables — what the preview and a test send render with. */
export function sampleVariables(
  spec: EmailTemplateSpec,
  language: MessageLanguage,
): TemplateVariables {
  const out: Record<string, VariableValue> = {};
  for (const variable of spec.variables) {
    out[variable.name] = variable.sample[language];
  }
  return out;
}

/** The code default, in this language or — for an English-only kind — English. */
export function defaultContent(
  spec: EmailTemplateSpec,
  language: MessageLanguage,
): TemplateContent {
  const content = spec.defaults[language] ?? spec.defaults.en;
  if (content === undefined) {
    // Every spec has English by construction (email-template-defaults.test).
    throw new Error(`no default wording for ${spec.kind}`);
  }
  return content;
}

// ---------------------------------------------------------------------------
// Validation — at save, at publish, and at render.
// ---------------------------------------------------------------------------

/**
 * Length limits, per field. Generous for wording, tight where a mail client
 * truncates anyway (a subject past ~80 characters is cut on a phone) — the
 * limit is what keeps a paste of a whole document out of a subject line.
 */
export const FIELD_LIMITS = {
  subject: 150,
  preheader: 200,
  heading: 120,
  paragraph: 1000,
  paragraphs: 12,
  after: 8,
  action: 40,
  footnote: 400,
} as const;

export interface TemplateIssue {
  readonly variant: string | null;
  readonly field: TemplateField | null;
  /** The paragraph's index, for `paragraphs` and `after`. */
  readonly index?: number;
  readonly message: string;
}

export interface ValidationContext {
  readonly language: MessageLanguage;
  /**
   * The hosts a link in the wording may point at: desiauction.in and whatever
   * PUBLIC_BASE_URL names (a staging host). Anything else is refused.
   */
  readonly ownHosts: readonly string[];
}

/** The product's own domain, always allowed; the caller adds PUBLIC_BASE_URL's host. */
export const OWN_DOMAIN = "desiauction.in";

export function ownHostsFor(publicBaseUrl: string | undefined): string[] {
  const hosts = [OWN_DOMAIN];
  try {
    if (publicBaseUrl !== undefined) {
      const host = new URL(publicBaseUrl).hostname.toLowerCase();
      if (!hosts.includes(host)) hosts.push(host);
    }
  } catch {
    // An unparseable base URL adds nothing; the product's domain still works.
  }
  return hosts;
}

/**
 * TOP-LEVEL DOMAINS a bare "example.com" is recognised by. A scheme or `www.`
 * makes anything a link; without one, "Mr.Sharma" must not read as a domain,
 * so a bare name counts only when it ends in a TLD people actually type. The
 * list is the common ones and the ones phishing favours; it errs toward
 * catching, and the admin sees exactly which text was refused.
 */
const BARE_TLDS = new Set([
  "com",
  "in",
  "net",
  "org",
  "io",
  "co",
  "app",
  "dev",
  "info",
  "biz",
  "me",
  "ly",
  "link",
  "click",
  "top",
  "xyz",
  "site",
  "online",
  "live",
  "shop",
  "store",
  "club",
  "help",
  "support",
  "page",
  "ai",
  "tk",
  "ml",
  "ga",
  "cf",
  "gq",
  "ru",
  "cn",
  "uk",
  "us",
  "au",
  "ca",
  "de",
  "gov",
  "edu",
]);

const URL_LIKE =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+)|(?:\bwww\.[^\s<>"']+)|(?:\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\b(?::\d+)?(?:\/[^\s<>"']*)?)/gi;

function hostOf(candidate: string): { host: string; explicit: boolean } | null {
  const trimmed = candidate.replace(/[.,;:!?)\]}'"।]+$/u, "");
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^www\./i.test(trimmed);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol)) {
      // javascript:, data:, ftp: … never ours, whatever host they name.
      return { host: url.protocol, explicit: true };
    }
    return { host: url.hostname.toLowerCase(), explicit };
  } catch {
    return null;
  }
}

function isOwnHost(host: string, ownHosts: readonly string[]): boolean {
  return ownHosts.some((own) => host === own || host.endsWith(`.${own}`));
}

/**
 * Every link-looking piece of text that points somewhere other than our own
 * domain — the phishing guard. A compromised admin account must not be able to
 * send "confirm your account at desiauction-help.co" from our address to every
 * player. An email address counts by its domain: "write to help@evil.com" is
 * the same lure.
 */
export function findForeignLinks(text: string, ownHosts: readonly string[]): string[] {
  const foreign: string[] = [];
  for (const match of text.matchAll(URL_LIKE)) {
    const candidate = match[0];
    const found = hostOf(candidate);
    if (found === null) continue;
    const tld = found.host.split(".").pop() ?? "";
    if (!found.explicit && !BARE_TLDS.has(tld)) continue;
    if (!isOwnHost(found.host, ownHosts)) foreign.push(candidate);
  }
  return foreign;
}

/**
 * THE HTML POLICY: plain text only, and anything that looks like markup is
 * REFUSED rather than silently escaped. Escaping alone would be safe — the
 * layout escapes every string — but an admin who typed `<b>` expecting bold
 * would publish a mail that shows the tag to every reader. Refusing says so at
 * the moment it can be fixed. A lone "<" ("under 5 < 10") is still allowed.
 */
const MARKUP = /<\s*[A-Za-z!/?]/;

/** Direction overrides and control characters: invisible, and a spoofing tool. */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/;

function textIssues(
  text: string,
  where: { variant: string; field: TemplateField; index?: number },
  context: ValidationContext,
  options: { multiline: boolean },
): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const at = {
    variant: where.variant,
    field: where.field,
    ...(where.index === undefined ? {} : { index: where.index }),
  };
  if (MARKUP.test(text)) {
    issues.push({ ...at, message: "Plain text only — remove the HTML tag." });
  }
  if (INVISIBLE.test(text)) {
    issues.push({ ...at, message: "Remove the invisible control characters." });
  }
  if (!options.multiline && /[\r\n]/.test(text)) {
    issues.push({ ...at, message: "Keep this to one line." });
  }
  if (strayBraces(text)) {
    issues.push({
      ...at,
      message: "A placeholder is not closed properly — write it as {{name}}.",
    });
  }
  const foreign = findForeignLinks(text, context.ownHosts);
  if (foreign.length > 0) {
    issues.push({
      ...at,
      message: `Links may only point at ${context.ownHosts.join(" or ")} — remove ${foreign.join(", ")}.`,
    });
  }
  return issues;
}

function sameFields(a: TemplateFields, b: TemplateFields, field: TemplateField): boolean {
  return JSON.stringify(a[field]) === JSON.stringify(b[field]);
}

/** Structure first: a row from the database is `unknown` until this says otherwise. */
export function parseTemplateContent(value: unknown): TemplateContent | null {
  if (typeof value !== "object" || value === null) return null;
  const variants = (value as { variants?: unknown }).variants;
  if (typeof variants !== "object" || variants === null) return null;
  const out: Record<string, TemplateFields> = {};
  for (const [id, raw] of Object.entries(variants)) {
    if (typeof raw !== "object" || raw === null) return null;
    const f = raw as Record<string, unknown>;
    const strings = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((item) => typeof item === "string");
    const actions = f["actions"];
    if (
      typeof f["subject"] !== "string" ||
      typeof f["preheader"] !== "string" ||
      typeof f["heading"] !== "string" ||
      typeof f["footnote"] !== "string" ||
      !strings(f["paragraphs"]) ||
      !strings(f["after"]) ||
      typeof actions !== "object" ||
      actions === null ||
      !Object.values(actions).every((label) => typeof label === "string")
    ) {
      return null;
    }
    out[id] = {
      subject: f["subject"],
      preheader: f["preheader"],
      heading: f["heading"],
      paragraphs: f["paragraphs"],
      after: f["after"],
      actions: actions as Record<string, string>,
      footnote: f["footnote"],
    };
  }
  return { variants: out };
}

/**
 * Every rule a template must pass. Empty list = valid. The same function runs
 * in the editor (inline errors), at save and publish (refusal), and at render
 * (fallback to the default) — so the three can never disagree.
 */
export function validateTemplate(
  spec: EmailTemplateSpec,
  content: TemplateContent,
  context: ValidationContext,
): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (!spec.editable) {
    return [{ variant: null, field: null, message: "This email is not editable." }];
  }
  if (!spec.languages.includes(context.language)) {
    return [{ variant: null, field: null, message: "This email is not sent in that language." }];
  }
  const fallback = defaultContent(spec, context.language);
  const known = new Map(spec.variables.map((variable) => [variable.name, variable]));
  const variantIds = spec.variants.map((variant) => variant.id);

  for (const id of Object.keys(content.variants)) {
    if (!variantIds.includes(id)) {
      issues.push({ variant: id, field: null, message: "There is no such version of this email." });
    }
  }

  for (const variant of spec.variants) {
    const fields = content.variants[variant.id];
    const base = fallback.variants[variant.id];
    if (fields === undefined || base === undefined) {
      issues.push({ variant: variant.id, field: null, message: `"${variant.label}" is missing.` });
      continue;
    }
    const at = (field: TemplateField, index?: number) => ({
      variant: variant.id,
      field,
      ...(index === undefined ? {} : { index }),
    });

    // Fixed fields stay exactly as the code has them.
    for (const field of LAYOUT_FIELDS) {
      if (!spec.editableFields.includes(field) && !sameFields(fields, base, field)) {
        issues.push({ ...at(field), message: "This part cannot be changed." });
      }
    }

    // Lengths, and the single-line fields.
    const single: [TemplateField, string, number, boolean][] = [
      ["subject", fields.subject, FIELD_LIMITS.subject, true],
      ["preheader", fields.preheader, FIELD_LIMITS.preheader, spec.format === "layout"],
      ["heading", fields.heading, FIELD_LIMITS.heading, spec.format === "layout"],
      ["footnote", fields.footnote, FIELD_LIMITS.footnote, spec.format === "layout"],
    ];
    for (const [field, text, limit, needed] of single) {
      if (needed && text.trim() === "") {
        issues.push({ ...at(field), message: "This cannot be empty." });
      }
      if (text.length > limit) {
        issues.push({ ...at(field), message: `Keep this under ${String(limit)} characters.` });
      }
      issues.push(...textIssues(text, at(field), context, { multiline: false }));
    }
    const lists: ["paragraphs" | "after", readonly string[], number][] = [
      ["paragraphs", fields.paragraphs, FIELD_LIMITS.paragraphs],
      ["after", fields.after, FIELD_LIMITS.after],
    ];
    for (const [field, paragraphs, max] of lists) {
      if (paragraphs.length > max) {
        issues.push({ ...at(field), message: `At most ${String(max)} paragraphs here.` });
      }
      paragraphs.forEach((text, index) => {
        if (text.trim() === "") {
          issues.push({ ...at(field, index), message: "Remove the empty paragraph." });
        }
        if (text.length > FIELD_LIMITS.paragraph) {
          issues.push({
            ...at(field, index),
            message: `Keep a paragraph under ${String(FIELD_LIMITS.paragraph)} characters.`,
          });
        }
        issues.push(...textIssues(text, at(field, index), context, { multiline: true }));
      });
    }
    if (spec.format === "layout" && fields.paragraphs.length === 0) {
      issues.push({ ...at("paragraphs"), message: "Write at least one paragraph." });
    }

    // Buttons: exactly the ones the code has, each labelled.
    const actionIds = spec.actions.map((action) => action.id);
    for (const id of Object.keys(fields.actions)) {
      if (!actionIds.includes(id)) {
        issues.push({ ...at("actions"), message: "There is no such button." });
      }
    }
    for (const id of actionIds) {
      const label = fields.actions[id];
      if (label === undefined || label.trim() === "") {
        issues.push({ ...at("actions"), message: "Every button needs a label." });
        continue;
      }
      if (label.length > FIELD_LIMITS.action) {
        issues.push({
          ...at("actions"),
          message: `Keep a button label under ${String(FIELD_LIMITS.action)} characters.`,
        });
      }
      issues.push(...textIssues(label, at("actions"), context, { multiline: false }));
    }

    // Placeholders: only the allowlist, lists only as a whole paragraph.
    const scalarTexts: [TemplateField, string][] = [
      ["subject", fields.subject],
      ["preheader", fields.preheader],
      ["heading", fields.heading],
      ["footnote", fields.footnote],
      ...Object.values(fields.actions).map((label): [TemplateField, string] => ["actions", label]),
    ];
    const used = new Set<string>();
    const unknown = (field: TemplateField, name: string, index?: number) =>
      issues.push({
        ...at(field, index),
        message: `{{${name}}} is not a value this email has.`,
      });
    for (const [field, text] of scalarTexts) {
      for (const name of placeholdersIn(text)) {
        used.add(name);
        const variable = known.get(name);
        if (variable === undefined) unknown(field, name);
        else if (variable.type === "list") {
          issues.push({
            ...at(field),
            message: `{{${name}}} is a list — it can only stand alone as a paragraph.`,
          });
        } else if (variable.type === "flag") {
          issues.push({
            ...at(field),
            message: `{{${name}}} decides whether a paragraph shows — use it in a paragraph.`,
          });
        }
      }
    }
    for (const [field, paragraphs] of lists) {
      paragraphs.forEach((text, index) => {
        for (const name of placeholdersIn(text)) {
          used.add(name);
          const variable = known.get(name);
          if (variable === undefined) unknown(field, name, index);
          else if (variable.type === "list" && text.trim() !== `{{${name}}}`) {
            issues.push({
              ...at(field, index),
              message: `{{${name}}} is a list — it must be a paragraph on its own.`,
            });
          }
        }
      });
    }
    for (const variable of spec.variables) {
      if (variable.required === true && !used.has(variable.name)) {
        issues.push({
          variant: variant.id,
          field: null,
          message: `{{${variable.name}}} must appear — ${variable.description.charAt(0).toLowerCase()}${variable.description.slice(1)}`,
        });
      }
    }

    // Locked blocks, word for word.
    for (const block of spec.locked) {
      if (block.variants !== undefined && !block.variants.includes(variant.id)) continue;
      if (!fields[block.field].includes(block.text[context.language])) {
        issues.push({
          ...at(block.field),
          message: `The locked line "${block.text[context.language]}" must stay, unchanged.`,
        });
      }
    }

    // And what it actually says with the samples: no braces left behind.
    const filled = fillTemplate(spec, fields, sampleVariables(spec, context.language));
    const rendered = [
      filled.subject,
      filled.preheader,
      filled.heading,
      filled.footnote,
      ...filled.paragraphs,
      ...filled.after,
      ...Object.values(filled.actions),
    ];
    if (rendered.some((text) => text.includes("{{") || text.includes("}}"))) {
      issues.push({
        variant: variant.id,
        field: null,
        message: "Something is left in {{…}} that will not be filled in.",
      });
    }
  }
  return issues;
}
