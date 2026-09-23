import { auditLog, people, type Db } from "@desiauction/db";
import { and, desc, eq, inArray } from "drizzle-orm";

import { env } from "../../env";
import { systemDb } from "../db";
import { isNotificationKind, notificationOf } from "../messaging/catalogue";
import { buildSubmitPayload, submitRefusal } from "../messaging/meta-templates";
import {
  describeMapping,
  TEMPLATE_AUDIT_ACTION_LIST,
  TEMPLATE_AUDIT_ACTIONS,
  type MappingAuditMeta,
  type MappingState,
  type SubmitAuditMeta,
} from "../messaging/provider-template-writer";
import {
  loadProviderTemplateMappings,
  mappingKey,
  resolveSmsTemplate,
  resolveWhatsAppTemplate,
  type MappingSnapshot,
  type MappingSource,
  type TextChannel,
} from "../messaging/provider-templates";
import { SMS_TEMPLATES } from "../messaging/templates";
import {
  approvalOf,
  loadStatusSnapshot,
  statusChip,
  type Approval,
  type ChipTone,
  type StatusSnapshot,
  type SyncRecord,
} from "../messaging/template-status";
import {
  WHATSAPP_LANGUAGES,
  WHATSAPP_SUGGESTED_NAMES,
  WHATSAPP_TEMPLATES,
  type WhatsAppKey,
  type WhatsAppLanguage,
} from "../messaging/whatsapp";
import { platformAdminGate } from "./authz";
import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "./capabilities";

/**
 * /admin/notifications/templates, read (Notification Control Center, Phase 3).
 *
 * A projection like every other in this folder: the catalogue's WhatsApp and
 * SMS templates, the mappings an admin set (0088), the env names underneath,
 * Meta's last status snapshot and the template changes on the audit log. It
 * writes nothing — provider-template-writer.ts does, called from
 * provider-template-actions.ts. On the SYSTEM pool behind `platform.admin`:
 * the changes are platform-scoped audit rows no tenant context can read.
 */

const RECENT = 20;
const LANGUAGE_LABEL: Readonly<Record<WhatsAppLanguage, string>> = { en: "English", hi: "हिन्दी" };

export interface StatusView {
  readonly language: string;
  readonly status: string;
  readonly label: string;
  readonly tone: ChipTone;
  readonly quality: string | null;
  readonly rejectedReason: string | null;
  readonly submitted: boolean;
  readonly at: Date;
}

export interface MappedView {
  /** The name (WhatsApp) or DLT id (SMS) a send uses, or null: none anywhere. */
  readonly handle: string | null;
  readonly source: MappingSource;
  readonly languages: readonly string[] | null;
  readonly note: string | null;
  readonly updatedAt: Date | null;
  readonly updatedByName: string | null;
  /** The env var underneath — what "Clear mapping" falls back to. */
  readonly envVar: string;
  readonly envValue: string | null;
}

export interface SubmitPreview {
  readonly language: WhatsAppLanguage;
  readonly languageLabel: string;
  readonly body: string;
  readonly footer: string;
  readonly button: string;
  readonly buttonUrl: string;
  readonly samples: readonly string[];
  /** The exact JSON body the submit sends, for the dialog's "what Meta receives". */
  readonly json: string;
}

export interface WhatsAppRow {
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly mapped: MappedView;
  readonly statuses: readonly StatusView[];
  readonly approval: Approval | null;
  readonly suggestedName: string;
  /** Why this kind cannot be submitted from here, or null. */
  readonly submitRefusal: string | null;
  readonly preview: readonly SubmitPreview[];
  /** Names submitted for this kind that Meta has since approved, not mapped yet. */
  readonly approvedCandidates: readonly string[];
}

export interface SmsRow {
  readonly kind: string;
  readonly label: string;
  readonly mapped: MappedView;
}

export interface TemplateChange {
  readonly id: string;
  readonly at: Date;
  readonly actorName: string | null;
  readonly summary: string;
  readonly revertOf: string | null;
  readonly revertable: boolean;
}

export interface ProviderTemplatesView {
  /** A WABA id is set: status can be read and templates submitted. */
  readonly syncEnabled: boolean;
  readonly whatsappConfigured: boolean;
  readonly smsGateway: boolean;
  readonly sync: SyncRecord;
  readonly otp: {
    readonly name: string | null;
    readonly language: string | null;
    readonly statuses: readonly StatusView[];
  };
  readonly whatsapp: readonly WhatsAppRow[];
  readonly sms: readonly SmsRow[];
  readonly recent: readonly TemplateChange[];
  /** Every name Meta has APPROVED in at least one language, per the last sync. */
  readonly approvedNames: readonly string[];
}

type EnvRecord = Readonly<Record<string, string | undefined>>;

function statusesFor(name: string | null, status: StatusSnapshot): StatusView[] {
  if (name === null) return [];
  return (status.byName.get(name) ?? []).map((row) => {
    const chip = statusChip(row.status);
    return {
      language: row.language,
      status: row.status,
      label: chip.label,
      tone: chip.tone,
      quality: row.quality,
      rejectedReason: row.rejectedReason,
      submitted: row.source === "submitted",
      at: row.syncedAt,
    };
  });
}

function labelOf(kind: string): { label: string; description: string } {
  if (!isNotificationKind(kind)) return { label: kind, description: "" };
  const entry = notificationOf(kind);
  return { label: entry.label, description: entry.description };
}

function mappedView(
  kind: string,
  channel: TextChannel,
  mappings: MappingSnapshot,
  envRecord: EnvRecord,
  names: ReadonlyMap<string, string | null>,
): MappedView {
  const row = mappings.get(mappingKey(kind, channel));
  const envVar =
    channel === "whatsapp"
      ? WHATSAPP_TEMPLATES[kind as WhatsAppKey].nameEnv
      : SMS_TEMPLATES[kind as keyof typeof SMS_TEMPLATES].providerTemplateEnv;
  const envValue = (envRecord[envVar] ?? "") === "" ? null : (envRecord[envVar] ?? null);
  const resolved =
    channel === "whatsapp"
      ? resolveWhatsAppTemplate(kind, mappings, envRecord)
      : { ...resolveSmsTemplate(kind, mappings, envRecord), languages: null };
  return {
    handle: "name" in resolved ? (resolved.name ?? null) : (resolved.id ?? null),
    source: resolved.source,
    languages: row === undefined ? null : row.languages,
    note: row?.note ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedByName: row?.updatedBy == null ? null : (names.get(row.updatedBy) ?? null),
    envVar,
    envValue,
  };
}

function isState(value: unknown): value is MappingState | null {
  return (
    value === null ||
    (typeof value === "object" && Array.isArray((value as MappingState).languages))
  );
}

function stillAsLeft(kind: string, meta: MappingAuditMeta, mappings: MappingSnapshot): boolean {
  const row = mappings.get(mappingKey(kind, meta.channel));
  const after = meta.after;
  if (after === null) return row === undefined;
  return (
    row !== undefined &&
    row.providerTemplateName === after.providerTemplateName &&
    row.providerTemplateId === after.providerTemplateId &&
    row.note === after.note &&
    row.languages.join(",") === after.languages.join(",")
  );
}

/** The page, pure over its inputs (the loader below reads them). */
export function buildTemplatesView(input: {
  mappings: MappingSnapshot;
  status: StatusSnapshot;
  envRecord: EnvRecord;
  names: ReadonlyMap<string, string | null>;
  audits: readonly {
    id: string;
    at: Date;
    subject: string | null;
    action: string;
    meta: unknown;
    actorName: string | null;
  }[];
}): ProviderTemplatesView {
  const { mappings, status, envRecord, names } = input;
  const set = (key: string) => (envRecord[key] ?? "") !== "";

  const submittedByKind = new Map<string, Set<string>>();
  const recent: TemplateChange[] = [];
  for (const row of input.audits) {
    if (row.subject === null) continue;
    const raw = row.meta as { change?: unknown } | null;
    if (row.action === TEMPLATE_AUDIT_ACTIONS.submit && raw?.change === "submit") {
      const meta = raw as Partial<SubmitAuditMeta>;
      const name = typeof meta.name === "string" ? meta.name : null;
      if (name !== null) {
        const list = submittedByKind.get(row.subject) ?? new Set<string>();
        list.add(name);
        submittedByKind.set(row.subject, list);
      }
      const results = Array.isArray(meta.results) ? meta.results : [];
      const parts = results.map((r) =>
        "error" in r ? `${r.language}: refused (${r.error})` : `${r.language}: ${r.status}`,
      );
      recent.push({
        id: row.id,
        at: row.at,
        actorName: row.actorName,
        summary: `${labelOf(row.subject).label}: submitted ${name ?? "?"} to Meta — ${parts.join(", ")}`,
        revertOf: null,
        revertable: false,
      });
      continue;
    }
    const meta = raw as Partial<MappingAuditMeta> | null;
    if (
      meta?.change === "mapping" &&
      (meta.channel === "whatsapp" || meta.channel === "sms") &&
      isState(meta.before ?? null) &&
      isState(meta.after ?? null)
    ) {
      const full = meta as MappingAuditMeta;
      recent.push({
        id: row.id,
        at: row.at,
        actorName: row.actorName,
        summary: describeMapping(row.subject, full),
        revertOf: full.revertOf ?? null,
        revertable: stillAsLeft(row.subject, full, mappings),
      });
    }
  }

  const whatsapp: WhatsAppRow[] = Object.values(WHATSAPP_TEMPLATES).map((template) => {
    const mapped = mappedView(template.key, "whatsapp", mappings, envRecord, names);
    const resolved = resolveWhatsAppTemplate(template.key, mappings, envRecord);
    const suggestedName = WHATSAPP_SUGGESTED_NAMES[template.key];
    const candidates = [...(submittedByKind.get(template.key) ?? [])].filter(
      (name) =>
        name !== mapped.handle &&
        (status.byName.get(name) ?? []).some((r) => r.status.toUpperCase() === "APPROVED"),
    );
    return {
      kind: template.key,
      ...labelOf(template.key),
      mapped,
      statuses: statusesFor(mapped.handle, status),
      approval:
        resolved.name === undefined ? null : approvalOf(resolved.name, resolved.languages, status),
      suggestedName,
      submitRefusal: submitRefusal(template),
      preview: WHATSAPP_LANGUAGES.map((language) => ({
        language,
        languageLabel: LANGUAGE_LABEL[language],
        body: template.body[language],
        footer: template.footer,
        button: template.button.label[language],
        buttonUrl: template.button.url,
        samples: template.samples[language],
        json: JSON.stringify(
          buildSubmitPayload(template.key, language, mapped.handle ?? suggestedName),
          null,
          2,
        ),
      })),
      approvedCandidates: candidates,
    };
  });

  const sms: SmsRow[] = Object.values(SMS_TEMPLATES).map((template) => ({
    kind: template.key,
    label: labelOf(template.key).label,
    mapped: mappedView(template.key, "sms", mappings, envRecord, names),
  }));

  const otpName = envRecord["WHATSAPP_TEMPLATE_NAME"] ?? null;
  return {
    syncEnabled: set("WHATSAPP_BUSINESS_ACCOUNT_ID") && set("WHATSAPP_ACCESS_TOKEN"),
    whatsappConfigured: set("WHATSAPP_PHONE_NUMBER_ID") && set("WHATSAPP_ACCESS_TOKEN"),
    smsGateway: set("MSG91_AUTH_KEY"),
    sync: status.sync,
    otp: {
      name: otpName === "" ? null : otpName,
      language: envRecord["WHATSAPP_TEMPLATE_LANGUAGE"] ?? null,
      statuses: statusesFor(otpName === "" ? null : otpName, status),
    },
    whatsapp,
    sms,
    recent: recent.slice(0, RECENT),
    approvedNames: [...status.byName.entries()]
      .filter(([, rows]) => rows.some((r) => r.status.toUpperCase() === "APPROVED"))
      .map(([name]) => name)
      .sort(),
  };
}

export async function providerTemplatesView(
  db: Db,
  envRecord: EnvRecord,
): Promise<ProviderTemplatesView> {
  const mappings = await loadProviderTemplateMappings(db);
  const status = await loadStatusSnapshot(db);
  const updaters = [...new Set([...mappings.values()].flatMap((r) => r.updatedBy ?? []))];
  const nameRows =
    updaters.length === 0
      ? []
      : await db
          .select({ id: people.id, name: people.name })
          .from(people)
          .where(inArray(people.id, updaters));
  const audits = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      subject: auditLog.subject,
      action: auditLog.action,
      meta: auditLog.meta,
      actorName: people.name,
    })
    .from(auditLog)
    .leftJoin(people, eq(people.id, auditLog.actor))
    .where(
      and(
        eq(auditLog.scopeType, PLATFORM_SCOPE_TYPE),
        eq(auditLog.scopeId, PLATFORM_SCOPE_ID),
        inArray(auditLog.action, [...TEMPLATE_AUDIT_ACTION_LIST]),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    // Enough history to find every submitted name, not just the last twenty.
    .limit(200);
  return buildTemplatesView({
    mappings,
    status,
    envRecord,
    names: new Map(nameRows.map((r) => [r.id, r.name])),
    audits,
  });
}

/** The page's read: `platform.admin`, or nothing. */
export async function adminProviderTemplates(): Promise<ProviderTemplatesView | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return providerTemplatesView(systemDb, env as unknown as EnvRecord);
}
