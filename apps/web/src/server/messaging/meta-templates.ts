import { env } from "../../env";
import type { SmsTransport } from "./sms";
import { providerFetch } from "./provider-fetch";
import {
  WHATSAPP_TEMPLATES,
  type WhatsAppKey,
  type WhatsAppLanguage,
  type WhatsAppTemplate,
} from "./whatsapp";

/**
 * META'S TEMPLATE MANAGEMENT API — read the approval status of every template
 * on the WhatsApp Business Account, and submit one for approval
 * (Notification Control Center, Phase 3).
 *
 * The calls are the Graph API's `/{WABA_ID}/message_templates`, with the same
 * System User token the senders use (it carries `whatsapp_business_management`,
 * WHATSAPP_SETUP.md step 4) and the same deadline-bound transport. The token
 * travels in a header and never in a URL, an error or a log line: Meta's
 * `paging.next` URLs carry it as a query parameter, so a page link is used only
 * for its cursor and never followed verbatim.
 *
 * Everything that interprets Meta's answers is pure and exported, so the
 * parsing, the pagination bound and the submit payload are unit tests.
 */

/** Pinned like the senders: a vendor's "latest" must not move this path. */
export const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";

const FIELDS = "name,language,status,category,quality_score,rejected_reason,id";
const PAGE_LIMIT = 100;
/** 10 × 100 templates: far more than this product will ever submit. */
export const MAX_PAGES = 10;

export interface MetaTemplateStatus {
  readonly name: string;
  readonly language: string;
  /** APPROVED, PENDING, REJECTED, PAUSED, DISABLED, IN_APPEAL, … */
  readonly status: string;
  readonly category: string | null;
  /** GREEN / YELLOW / RED / UNKNOWN. */
  readonly quality: string | null;
  readonly rejectedReason: string | null;
  readonly metaId: string | null;
}

export class MetaTemplateError extends Error {
  constructor(
    message: string,
    /** Meta's `error.code`, when it gave one. */
    readonly metaCode: number | null = null,
  ) {
    super(message);
    this.name = "MetaTemplateError";
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Meta's error envelope, as a sentence with no secret in it. */
export function metaErrorOf(body: string): { message: string; code: number | null } | null {
  try {
    const error = record(record(JSON.parse(body))?.["error"]);
    if (error === null) return null;
    const code = error["code"];
    const message =
      str(error["error_user_msg"]) ?? str(error["message"]) ?? "Meta refused the request";
    return {
      // A message can quote the request; the token is never in one, but a
      // cap keeps a runaway body out of the UI and the log alike.
      message: message.slice(0, 300),
      code: typeof code === "number" && Number.isInteger(code) ? code : null,
    };
  } catch {
    return null;
  }
}

/** The `quality_score` field: `{ "score": "GREEN", … }` or a bare string. */
function qualityOf(value: unknown): string | null {
  const direct = str(value);
  if (direct !== null) return direct;
  return str(record(value)?.["score"]);
}

export interface TemplatePage {
  readonly templates: readonly MetaTemplateStatus[];
  /** The cursor for the next page, or null on the last one. */
  readonly after: string | null;
}

/**
 * One page of `GET /{WABA_ID}/message_templates`. Throws `MetaTemplateError`
 * on Meta's error envelope or a body that is not the list; skips an entry with
 * no name or language rather than failing the whole sync over it.
 */
export function parseTemplatePage(body: string): TemplatePage {
  const failure = metaErrorOf(body);
  if (failure !== null) throw new MetaTemplateError(failure.message, failure.code);
  let parsed: Record<string, unknown> | null;
  try {
    parsed = record(JSON.parse(body));
  } catch {
    throw new MetaTemplateError("Meta answered with something that is not JSON");
  }
  const data = parsed?.["data"];
  if (!Array.isArray(data)) throw new MetaTemplateError("Meta's answer had no template list");
  const templates: MetaTemplateStatus[] = [];
  for (const item of data) {
    const entry = record(item);
    const name = str(entry?.["name"]);
    const language = str(entry?.["language"]);
    if (entry === null || name === null || language === null) continue;
    const rejected = str(entry["rejected_reason"]);
    templates.push({
      name,
      language,
      status: (str(entry["status"]) ?? "UNKNOWN").toUpperCase(),
      category: str(entry["category"]),
      quality: qualityOf(entry["quality_score"]),
      // Meta reports "NONE" on everything that was not rejected.
      rejectedReason: rejected === null || rejected === "NONE" ? null : rejected,
      metaId: str(entry["id"]),
    });
  }
  const paging = record(parsed?.["paging"]);
  const hasNext = str(paging?.["next"]) !== null;
  const after = hasNext ? str(record(paging?.["cursors"])?.["after"]) : null;
  return { templates, after };
}

export interface MetaConfig {
  readonly wabaId: string;
  readonly accessToken: string;
  readonly apiBase?: string;
  readonly transport?: SmsTransport;
}

/**
 * The account to manage, or null when it is not set up: the WABA id is
 * optional (sending never needs it), and without it the page says so.
 */
export function metaConfigFromEnv(): MetaConfig | null {
  const wabaId = env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;
  if (wabaId === undefined || accessToken === undefined) return null;
  return { wabaId, accessToken };
}

function headers(config: MetaConfig): Record<string, string> {
  return {
    authorization: `Bearer ${config.accessToken}`,
    "content-type": "application/json",
  };
}

/**
 * Every template on the account, page by page, at most `MAX_PAGES`. Rebuilds
 * each page's URL from the cursor alone (see the note at the top on why a
 * `paging.next` link is not followed). A page past the bound is a refusal, not
 * a silent truncation: a snapshot missing templates would read as "deleted".
 */
export async function fetchTemplateStatuses(config: MetaConfig): Promise<MetaTemplateStatus[]> {
  const transport = config.transport ?? providerFetch;
  const base = config.apiBase ?? META_GRAPH_BASE;
  const out: MetaTemplateStatus[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ fields: FIELDS, limit: String(PAGE_LIMIT) });
    if (after !== null) query.set("after", after);
    const url = `${base}/${encodeURIComponent(config.wabaId)}/message_templates?${query.toString()}`;
    let response;
    try {
      response = await transport(url, { method: "GET", headers: headers(config) });
    } catch {
      throw new MetaTemplateError("Meta could not be reached");
    }
    if (response.status >= 500 || response.status === 429) {
      throw new MetaTemplateError(`Meta is unavailable (status ${String(response.status)})`);
    }
    const parsed = parseTemplatePage(response.body);
    if (response.status >= 400) {
      throw new MetaTemplateError(`Meta refused the request (status ${String(response.status)})`);
    }
    out.push(...parsed.templates);
    if (parsed.after === null) return out;
    after = parsed.after;
  }
  throw new MetaTemplateError(
    `More than ${String(MAX_PAGES * PAGE_LIMIT)} templates on the account; not stored`,
  );
}

// ---------------------------------------------------------------------------
// Submitting a template for approval.
// ---------------------------------------------------------------------------

/**
 * Why a kind cannot be submitted from the screen, or null. A header IMAGE
 * needs a sample uploaded through Meta's resumable upload API (an app id and
 * a media handle), which this product does not hold: that one is submitted in
 * WhatsApp Manager, from the generated sheet, and mapped here once approved.
 */
export function submitRefusal(template: WhatsAppTemplate): string | null {
  if (template.header === "image") {
    return "This template has a picture at the top, and Meta needs a sample image uploaded with it. Submit it in WhatsApp Manager (docs/messaging/WHATSAPP_TEMPLATES.md), then map the approved name here.";
  }
  return null;
}

export interface SubmitPayload {
  readonly name: string;
  readonly language: WhatsAppLanguage;
  readonly category: "UTILITY";
  readonly parameter_format: "POSITIONAL";
  readonly components: readonly unknown[];
}

/**
 * EXACTLY WHAT META RECEIVES for one language of one kind — built from the
 * catalogue's own definition (whatsapp.ts), the same source as the generated
 * sheet, so what is approved is what the send fills in. The body's samples go
 * in `example.body_text` (one row, one value per `{{n}}`, in order), which is
 * what Meta's review reads the variables against.
 */
export function buildSubmitPayload(
  key: WhatsAppKey,
  language: WhatsAppLanguage,
  name: string,
): SubmitPayload {
  const template = WHATSAPP_TEMPLATES[key];
  return {
    name,
    language,
    category: template.category,
    parameter_format: "POSITIONAL",
    components: [
      {
        type: "BODY",
        text: template.body[language],
        example: { body_text: [[...template.samples[language]]] },
      },
      { type: "FOOTER", text: template.footer },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: template.button.label[language], url: template.button.url }],
      },
    ],
  };
}

/** How many `{{n}}` a body carries — the count Meta checks the samples against. */
export function variableCount(body: string): number {
  return new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (m) => m[1])).size;
}

export interface SubmitReceipt {
  readonly metaId: string | null;
  readonly status: string;
  readonly category: string | null;
}

/** Meta's answer to a create: `{ "id": "…", "status": "PENDING", "category": "UTILITY" }`. */
export function parseSubmitResponse(body: string): SubmitReceipt {
  const failure = metaErrorOf(body);
  if (failure !== null) throw new MetaTemplateError(failure.message, failure.code);
  let parsed: Record<string, unknown> | null;
  try {
    parsed = record(JSON.parse(body));
  } catch {
    throw new MetaTemplateError("Meta answered with something that is not JSON");
  }
  if (parsed === null) throw new MetaTemplateError("Meta's answer was empty");
  return {
    metaId: str(parsed["id"]),
    status: (str(parsed["status"]) ?? "PENDING").toUpperCase(),
    category: str(parsed["category"]),
  };
}

export async function submitTemplate(
  config: MetaConfig,
  payload: SubmitPayload,
): Promise<SubmitReceipt> {
  const transport = config.transport ?? providerFetch;
  const base = config.apiBase ?? META_GRAPH_BASE;
  let response;
  try {
    response = await transport(`${base}/${encodeURIComponent(config.wabaId)}/message_templates`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(payload),
    });
  } catch {
    throw new MetaTemplateError("Meta could not be reached");
  }
  if (response.status >= 500 || response.status === 429) {
    throw new MetaTemplateError(`Meta is unavailable (status ${String(response.status)})`);
  }
  const receipt = parseSubmitResponse(response.body);
  if (response.status >= 400) {
    throw new MetaTemplateError(`Meta refused the template (status ${String(response.status)})`);
  }
  return receipt;
}
