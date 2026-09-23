import { providerTemplateMappings as mappingsTable, type Db } from "@desiauction/db";

import { env } from "../../env";
import { SMS_TEMPLATES } from "./templates";
import { WHATSAPP_LANGUAGES, WHATSAPP_TEMPLATES, type WhatsAppLanguage } from "./whatsapp";

/**
 * WHICH APPROVED TEMPLATE A MOMENT USES — WhatsApp and SMS (Notification
 * Control Center, Phase 3).
 *
 * Meta sends only a template it approved, by NAME and language; MSG91 only a
 * DLT-registered template ID. Neither text is ours to edit at send time, so
 * what an admin manages is the pointer: this kind goes out under that approved
 * name. It used to be an env var per kind (the template's `nameEnv` /
 * `providerTemplateEnv`), which made "Meta approved the new one" a deploy.
 *
 * THE PRECEDENCE, one rule for every reader — the senders, the admin grid's
 * "Not configured" chip, the templates page:
 *
 *     admin mapping (provider_template_mappings, 0088)
 *       ?? the env var the template declares
 *       ?? unset — the moment has no text on that channel
 *
 * The env stays a fallback so nothing breaks on deploy: a server configured by
 * env before 0088 sends exactly what it sent, and "Clear mapping" returns a
 * kind to its env var. Sign-in codes are NOT here (WHATSAPP_TEMPLATE_NAME,
 * MSG91_TEMPLATE_ID): whether anybody can sign in is not a screen's decision,
 * and 0088 refuses an `auth.*` row.
 *
 * READ ON EVERY DRAIN, SO CACHED like the platform switches: one load reads the
 * table whole (twenty rows at most) and serves the process for thirty seconds;
 * a write from this process drops it at once.
 */

export type TextChannel = "whatsapp" | "sms";
export type MappingSource = "admin" | "env" | "unset";

export interface MappingRow {
  readonly kind: string;
  readonly channel: TextChannel;
  readonly providerTemplateName: string | null;
  readonly providerTemplateId: string | null;
  readonly languages: readonly string[];
  readonly note: string | null;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

export type MappingSnapshot = ReadonlyMap<string, MappingRow>;

export const NO_MAPPINGS: MappingSnapshot = new Map();

export function mappingKey(kind: string, channel: TextChannel): string {
  return `${kind}|${channel}`;
}

type EnvRecord = Readonly<Record<string, unknown>>;

function envValue(record: EnvRecord, name: string): string | undefined {
  const value = record[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isLanguage(value: string): value is WhatsAppLanguage {
  return (WHATSAPP_LANGUAGES as readonly string[]).includes(value);
}

export interface ResolvedWhatsApp {
  /** Undefined: no approved name anywhere — the moment has no WhatsApp. */
  readonly name: string | undefined;
  readonly source: MappingSource;
  /**
   * The language versions the name is approved in. Null for an env name: the
   * env never said, and the send's 132001 fallback covers a missing Hindi.
   */
  readonly languages: readonly WhatsAppLanguage[] | null;
}

/** THE RESOLUTION for WhatsApp — pure, so the precedence is a unit test. */
export function resolveWhatsAppTemplate(
  key: string,
  snapshot: MappingSnapshot,
  envRecord: EnvRecord,
): ResolvedWhatsApp {
  const template = (WHATSAPP_TEMPLATES as Readonly<Record<string, { nameEnv: string }>>)[key];
  if (template === undefined) return { name: undefined, source: "unset", languages: null };
  const row = snapshot.get(mappingKey(key, "whatsapp"));
  if (row?.providerTemplateName != null && row.providerTemplateName !== "") {
    const languages = row.languages.filter(isLanguage);
    return {
      name: row.providerTemplateName,
      source: "admin",
      languages: languages.length === 0 ? null : languages,
    };
  }
  const fromEnv = envValue(envRecord, template.nameEnv);
  return fromEnv === undefined
    ? { name: undefined, source: "unset", languages: null }
    : { name: fromEnv, source: "env", languages: null };
}

export interface ResolvedSms {
  readonly id: string | undefined;
  readonly source: MappingSource;
}

/** THE RESOLUTION for SMS — the DLT id, by the same precedence. */
export function resolveSmsTemplate(
  key: string,
  snapshot: MappingSnapshot,
  envRecord: EnvRecord,
): ResolvedSms {
  const template = (SMS_TEMPLATES as Readonly<Record<string, { providerTemplateEnv: string }>>)[
    key
  ];
  if (template === undefined) return { id: undefined, source: "unset" };
  const row = snapshot.get(mappingKey(key, "sms"));
  if (row?.providerTemplateId != null && row.providerTemplateId !== "") {
    return { id: row.providerTemplateId, source: "admin" };
  }
  const fromEnv = envValue(envRecord, template.providerTemplateEnv);
  return fromEnv === undefined
    ? { id: undefined, source: "unset" }
    : { id: fromEnv, source: "env" };
}

/**
 * The version a reader gets: their own language when the name is approved in
 * it, else the first language it is approved in. Asking Meta for a version the
 * admin has said does not exist only buys a 132001 and a second call.
 */
export function languageFor(
  wanted: WhatsAppLanguage,
  approved: readonly WhatsAppLanguage[] | null,
): WhatsAppLanguage {
  if (approved === null || approved.length === 0 || approved.includes(wanted)) return wanted;
  return approved[0] ?? wanted;
}

// ---------------------------------------------------------------------------
// What an admin may map — pure validation, shared by the writer and tests.
// ---------------------------------------------------------------------------

/** Meta's rule for a template name: lowercase letters, digits and underscores. */
export const WHATSAPP_NAME_MAX = 512;
const WHATSAPP_NAME = /^[a-z0-9_]+$/;
/** A DLT / MSG91 template id: letters, digits, `_` and `-`. */
export const SMS_ID_MAX = 64;
const SMS_ID = /^[A-Za-z0-9_-]+$/;
export const NOTE_MAX = 500;

/** Null when valid; else the sentence the operator reads. */
export function refuseWhatsAppName(name: string): string | null {
  if (name === "") return "Enter the template name.";
  if (name.length > WHATSAPP_NAME_MAX) {
    return `A template name is at most ${String(WHATSAPP_NAME_MAX)} characters.`;
  }
  if (!WHATSAPP_NAME.test(name)) {
    return "A template name uses only lowercase letters, digits and underscores (a-z, 0-9, _).";
  }
  return null;
}

export function refuseSmsId(id: string): string | null {
  if (id === "") return "Enter the DLT template ID.";
  if (id.length > SMS_ID_MAX) return `A template ID is at most ${String(SMS_ID_MAX)} characters.`;
  if (!SMS_ID.test(id)) return "A template ID uses only letters, digits, - and _.";
  return null;
}

// ---------------------------------------------------------------------------
// Loading, and the in-process cache.
// ---------------------------------------------------------------------------

export const PROVIDER_TEMPLATE_TTL_MS = 30_000;

let cached: { readonly snapshot: MappingSnapshot; readonly loadedAt: number } | null = null;

/** The table, uncached. The admin screen reads through this. */
export async function loadProviderTemplateMappings(db: Db): Promise<MappingSnapshot> {
  const rows = await db.select().from(mappingsTable);
  return new Map(
    rows.map((row) => [mappingKey(row.kind, row.channel), row satisfies MappingRow] as const),
  );
}

/**
 * The snapshot the senders read — at most `PROVIDER_TEMPLATE_TTL_MS` old.
 *
 * A failed load answers the ENV alone rather than throwing, unlike the kill
 * switches: a mapping is a pointer, not a stop, and the env names are what
 * this server sent under before 0088. The worst a stale pointer does is send
 * under a name Meta then refuses — which the drain already handles.
 */
export async function providerTemplateMappings(
  db: Db,
  now: number = Date.now(),
): Promise<MappingSnapshot> {
  if (cached !== null && now - cached.loadedAt < PROVIDER_TEMPLATE_TTL_MS) {
    return cached.snapshot;
  }
  try {
    const snapshot = await loadProviderTemplateMappings(db);
    cached = { snapshot, loadedAt: now };
    return snapshot;
  } catch {
    return NO_MAPPINGS;
  }
}

/** Drop the cache — after every write in this process, and in tests. */
export function invalidateProviderTemplateMappings(): void {
  cached = null;
}

/** What a sender asks, bound to one snapshot and one env. */
export interface TemplateResolver {
  readonly whatsappName: (key: string) => string | undefined;
  readonly whatsappLanguages: (key: string) => readonly WhatsAppLanguage[] | null;
  readonly smsId: (key: string) => string | undefined;
}

export function resolverFor(snapshot: MappingSnapshot, envRecord: EnvRecord): TemplateResolver {
  return {
    whatsappName: (key) => resolveWhatsAppTemplate(key, snapshot, envRecord).name,
    whatsappLanguages: (key) => resolveWhatsAppTemplate(key, snapshot, envRecord).languages,
    smsId: (key) => resolveSmsTemplate(key, snapshot, envRecord).id,
  };
}

/** The platform's resolver: this process's cached mappings over `env`. */
export async function templateResolver(db: Db): Promise<TemplateResolver> {
  return resolverFor(await providerTemplateMappings(db), env as unknown as EnvRecord);
}
