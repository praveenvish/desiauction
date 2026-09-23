import {
  auditLog,
  newId,
  providerTemplateMappings,
  providerTemplateStatus,
  providerTemplateSyncs,
  type Db,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";

import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "../admin/capabilities";
import { db as appDb } from "../db";
import { isNotificationKind, notificationOf } from "./catalogue";
import {
  buildSubmitPayload,
  fetchTemplateStatuses,
  metaConfigFromEnv,
  MetaTemplateError,
  submitRefusal,
  submitTemplate,
  type MetaConfig,
} from "./meta-templates";
import {
  invalidateProviderTemplateMappings,
  NOTE_MAX,
  refuseSmsId,
  refuseWhatsAppName,
  type TextChannel,
} from "./provider-templates";
import type { WriteHandles, WriteResult } from "./platform-switch-writer";
import { SMS_TEMPLATES } from "./templates";
import { WHATSAPP_LANGUAGES, WHATSAPP_TEMPLATES, type WhatsAppLanguage } from "./whatsapp";

/**
 * THE ONE WRITER OF TEMPLATE MAPPINGS AND META'S STATUS SNAPSHOT (Phase 3).
 *
 * Under server/messaging, not server/admin, for the reason the switch writer
 * is: administration's projections are proven read-only by a source scan.
 *
 * The same two handles as the switches (platform-switch-writer.ts): the 0088
 * tables on the APP pool, the platform-scoped audit row on the SYSTEM pool,
 * inside the write's transaction callback so no mapping is live without its
 * record. Every mapping change carries its before and after, so Revert
 * re-applies `before`; a submission is audited with what Meta answered.
 */

export const TEMPLATE_AUDIT_ACTIONS = {
  mapping: "notification.template_mapped",
  submit: "notification.template_submitted",
} as const;

export const TEMPLATE_AUDIT_ACTION_LIST: readonly string[] = Object.values(TEMPLATE_AUDIT_ACTIONS);

/** A mapping as stored — null is "no row: the env var decides". */
export interface MappingState {
  readonly providerTemplateName: string | null;
  readonly providerTemplateId: string | null;
  readonly languages: readonly string[];
  readonly note: string | null;
}

export interface MappingAuditMeta {
  readonly change: "mapping";
  readonly channel: TextChannel;
  readonly before: MappingState | null;
  readonly after: MappingState | null;
  readonly revertOf?: string;
}

export interface SubmitAuditMeta {
  readonly change: "submit";
  readonly name: string;
  readonly results: readonly (
    | { readonly language: string; readonly status: string; readonly metaId: string | null }
    | { readonly language: string; readonly error: string }
  )[];
}

export type MappingChange =
  | {
      readonly kind: string;
      readonly channel: string;
      /** WhatsApp: the approved name. SMS: the DLT id. */
      readonly value: string;
      /** WhatsApp only; omitted = both. */
      readonly languages?: readonly string[] | undefined;
      readonly note?: string | undefined;
    }
  | { readonly kind: string; readonly channel: string; readonly clear: true };

function kindLabel(kind: string): string {
  return isNotificationKind(kind) ? notificationOf(kind).label : kind;
}

function hasTemplate(kind: string, channel: TextChannel): boolean {
  const table: Readonly<Record<string, unknown>> =
    channel === "whatsapp" ? WHATSAPP_TEMPLATES : SMS_TEMPLATES;
  return Object.prototype.hasOwnProperty.call(table, kind);
}

function isLanguage(value: string): value is WhatsAppLanguage {
  return (WHATSAPP_LANGUAGES as readonly string[]).includes(value);
}

function normalizeNote(note: string | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Every rule a mapping must pass, as the refusal a person reads — or the state
 * it would write. The database's CHECKs (0088) repeat the ones SQL can say.
 */
export function mappingStateFor(
  change: MappingChange,
): { ok: true; channel: TextChannel; state: MappingState | null } | { ok: false; error: string } {
  if (change.channel !== "whatsapp" && change.channel !== "sms") {
    return { ok: false, error: "Templates are mapped for WhatsApp and SMS only." };
  }
  const channel = change.channel;
  if (!isNotificationKind(change.kind) || notificationOf(change.kind).category === "login") {
    return {
      ok: false,
      error: "The sign-in code's template is set on the server, never from here.",
    };
  }
  if (!hasTemplate(change.kind, channel)) {
    return { ok: false, error: `${kindLabel(change.kind)} has no ${channel} template.` };
  }
  if ("clear" in change) return { ok: true, channel, state: null };
  const value = change.value.trim();
  const refusal = channel === "whatsapp" ? refuseWhatsAppName(value) : refuseSmsId(value);
  if (refusal !== null) return { ok: false, error: refusal };
  const note = normalizeNote(change.note);
  if (note !== null && note.length > NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${String(NOTE_MAX)} characters.` };
  }
  let languages: string[] = ["en"];
  if (channel === "whatsapp") {
    const asked = change.languages ?? WHATSAPP_LANGUAGES;
    if (asked.length === 0 || !asked.every(isLanguage)) {
      return { ok: false, error: "Pick at least one language the template is approved in." };
    }
    // In the catalogue's order, once each.
    languages = WHATSAPP_LANGUAGES.filter((l) => asked.includes(l));
  }
  return {
    ok: true,
    channel,
    state: {
      providerTemplateName: channel === "whatsapp" ? value : null,
      providerTemplateId: channel === "sms" ? value : null,
      languages,
      note,
    },
  };
}

function sameState(a: MappingState | null, b: MappingState | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.providerTemplateName === b.providerTemplateName &&
    a.providerTemplateId === b.providerTemplateId &&
    a.note === b.note &&
    a.languages.join(",") === b.languages.join(",")
  );
}

async function readState(tx: Db, kind: string, channel: TextChannel): Promise<MappingState | null> {
  const [row] = await tx
    .select()
    .from(providerTemplateMappings)
    .where(
      and(eq(providerTemplateMappings.kind, kind), eq(providerTemplateMappings.channel, channel)),
    )
    .for("update");
  return row === undefined
    ? null
    : {
        providerTemplateName: row.providerTemplateName,
        providerTemplateId: row.providerTemplateId,
        languages: row.languages,
        note: row.note,
      };
}

async function writeState(
  tx: Db,
  kind: string,
  channel: TextChannel,
  state: MappingState | null,
  actorId: string,
): Promise<void> {
  if (state === null) {
    await tx
      .delete(providerTemplateMappings)
      .where(
        and(eq(providerTemplateMappings.kind, kind), eq(providerTemplateMappings.channel, channel)),
      );
    return;
  }
  const values = {
    providerTemplateName: state.providerTemplateName,
    providerTemplateId: state.providerTemplateId,
    languages: [...state.languages],
    note: state.note,
    updatedBy: actorId,
    updatedAt: new Date(),
  };
  await tx
    .insert(providerTemplateMappings)
    .values({ kind, channel, ...values })
    .onConflictDoUpdate({
      target: [providerTemplateMappings.kind, providerTemplateMappings.channel],
      set: values,
    });
}

async function audit(
  handles: WriteHandles,
  actorId: string,
  action: string,
  subject: string,
  meta: MappingAuditMeta | SubmitAuditMeta,
): Promise<string> {
  const id = newId();
  await handles.auditDb.insert(auditLog).values({
    id,
    actor: actorId,
    action,
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    subject,
    meta,
  });
  return id;
}

function channelWord(channel: TextChannel): string {
  return channel === "whatsapp" ? "WhatsApp" : "SMS";
}

/** One sentence for a mapping change, from its before and after. */
export function describeMapping(kind: string, meta: MappingAuditMeta): string {
  const handle = (s: MappingState | null) =>
    s === null ? "the server setting" : (s.providerTemplateName ?? s.providerTemplateId ?? "?");
  return `${kindLabel(kind)} on ${channelWord(meta.channel)}: ${handle(meta.before)} → ${handle(meta.after)}`;
}

/** Map, change or clear one kind's template on one channel. Audited. */
export async function applyTemplateMapping(
  handles: WriteHandles,
  actorId: string,
  change: MappingChange,
): Promise<WriteResult> {
  const next = mappingStateFor(change);
  if (!next.ok) return next;
  const { channel, state } = next;
  const result = await handles.db.transaction(async (tx) => {
    const before = await readState(tx, change.kind, channel);
    if (sameState(before, state)) {
      return { ok: true, message: "Nothing changed.", auditId: null } as const;
    }
    await writeState(tx, change.kind, channel, state, actorId);
    const meta: MappingAuditMeta = { change: "mapping", channel, before, after: state };
    const auditId = await audit(
      handles,
      actorId,
      TEMPLATE_AUDIT_ACTIONS.mapping,
      change.kind,
      meta,
    );
    return {
      ok: true,
      message:
        state === null
          ? `${kindLabel(change.kind)} on ${channelWord(channel)} uses the server setting again.`
          : `${kindLabel(change.kind)} on ${channelWord(channel)} now uses ${state.providerTemplateName ?? state.providerTemplateId ?? ""}.`,
      auditId,
    } as const;
  });
  invalidateProviderTemplateMappings();
  return result;
}

function isState(value: unknown): value is MappingState | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const s = value as MappingState;
  return (
    (s.providerTemplateName === null || typeof s.providerTemplateName === "string") &&
    (s.providerTemplateId === null || typeof s.providerTemplateId === "string") &&
    Array.isArray(s.languages)
  );
}

/**
 * REVERT a mapping change: re-apply what it moved away from. Refused when the
 * mapping has moved on since, like the switches — reverting an older change on
 * top of a newer one would silently undo the newer one too.
 */
export async function revertTemplateMapping(
  handles: WriteHandles,
  actorId: string,
  auditId: string,
): Promise<WriteResult> {
  const [row] = await handles.auditDb
    .select({ subject: auditLog.subject, meta: auditLog.meta })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.id, auditId),
        eq(auditLog.scopeType, PLATFORM_SCOPE_TYPE),
        eq(auditLog.action, TEMPLATE_AUDIT_ACTIONS.mapping),
      ),
    )
    .limit(1);
  const meta = row?.meta as Partial<MappingAuditMeta> | null | undefined;
  if (
    row === undefined ||
    row.subject === null ||
    meta?.change !== "mapping" ||
    (meta.channel !== "whatsapp" && meta.channel !== "sms") ||
    !isState(meta.before ?? null) ||
    !isState(meta.after ?? null)
  ) {
    return { ok: false, error: "That change is not on the list." };
  }
  const kind = row.subject;
  const channel = meta.channel;
  const target = meta.before ?? null;
  const left = meta.after ?? null;
  const result = await handles.db.transaction(async (tx) => {
    const now = await readState(tx, kind, channel);
    if (!sameState(now, left)) {
      return {
        ok: false,
        error: "That mapping has changed since. Revert the later change first.",
      } as const;
    }
    await writeState(tx, kind, channel, target, actorId);
    const id = await audit(handles, actorId, TEMPLATE_AUDIT_ACTIONS.mapping, kind, {
      change: "mapping",
      channel,
      before: now,
      after: target,
      revertOf: auditId,
    });
    return {
      ok: true,
      message: `Reverted: ${kindLabel(kind)} on ${channelWord(channel)} is back as it was.`,
      auditId: id,
    } as const;
  });
  invalidateProviderTemplateMappings();
  return result;
}

// ---------------------------------------------------------------------------
// The status sync.
// ---------------------------------------------------------------------------

/** "Refresh from Meta" at most this often, across every web process. */
export const SYNC_MIN_INTERVAL_MS = 60_000;
/** The scheduled sync refreshes a snapshot older than this. */
export const SYNC_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;

export type SyncOutcome =
  | { readonly ok: true; readonly count: number }
  | {
      readonly ok: false;
      readonly reason: "disabled" | "too_soon" | "failed";
      readonly error: string;
    };

async function recordAttempt(db: Db, at: Date, patch: Record<string, unknown>): Promise<void> {
  const values = { lastAttemptAt: at, ...patch };
  await db
    .insert(providerTemplateSyncs)
    .values({ provider: "whatsapp", ...values })
    .onConflictDoUpdate({ target: providerTemplateSyncs.provider, set: values });
}

/**
 * Replace the snapshot with what Meta says now. The rate limit reads and
 * claims `last_attempt_at` in one statement, so two clicks (or two processes)
 * inside the interval make one call to Meta, not two.
 */
export async function syncWhatsAppTemplates(
  db: Db,
  config: MetaConfig | null,
  options: { now?: Date; minIntervalMs?: number } = {},
): Promise<SyncOutcome> {
  if (config === null) {
    return {
      ok: false,
      reason: "disabled",
      error: "Set WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_ACCESS_TOKEN to read Meta's status.",
    };
  }
  const now = options.now ?? new Date();
  const interval = options.minIntervalMs ?? SYNC_MIN_INTERVAL_MS;
  const since = new Date(now.getTime() - interval);
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ at: providerTemplateSyncs.lastAttemptAt })
      .from(providerTemplateSyncs)
      .where(eq(providerTemplateSyncs.provider, "whatsapp"))
      .for("update");
    if (row?.at != null && row.at > since) return false;
    await recordAttempt(tx, now, {});
    return true;
  });
  if (!claimed) {
    return {
      ok: false,
      reason: "too_soon",
      error: "Meta was asked a moment ago. Try again in a minute.",
    };
  }
  let templates;
  try {
    templates = await fetchTemplateStatuses(config);
  } catch (error) {
    const message = error instanceof MetaTemplateError ? error.message : "Meta could not be read";
    await recordAttempt(db, now, { lastError: message });
    return { ok: false, reason: "failed", error: message };
  }
  await db.transaction(async (tx) => {
    // Whole replacement: a template deleted at Meta must stop reading approved.
    await tx.delete(providerTemplateStatus);
    if (templates.length > 0) {
      await tx
        .insert(providerTemplateStatus)
        .values(templates.map((t) => ({ ...t, source: "sync" as const, syncedAt: now })))
        .onConflictDoNothing();
    }
    await recordAttempt(tx, now, {
      lastSuccessAt: now,
      lastError: null,
      templateCount: templates.length,
    });
  });
  return { ok: true, count: templates.length };
}

/**
 * The scheduled sync (/api/jobs/feedback): refresh only a snapshot older than
 * `SYNC_MAX_AGE_MS`, so a fifteen-minute job asks Meta four times a day. Never
 * throws — a Meta outage must not fail the retention purge beside it.
 */
export async function syncWhatsAppTemplatesIfStale(
  db: Db,
  config: MetaConfig | null,
  now: Date = new Date(),
): Promise<SyncOutcome | { ok: true; skipped: "fresh" }> {
  if (config === null) {
    return { ok: false, reason: "disabled", error: "WABA id not set" };
  }
  try {
    const [row] = await db
      .select({ at: providerTemplateSyncs.lastSuccessAt })
      .from(providerTemplateSyncs)
      .where(eq(providerTemplateSyncs.provider, "whatsapp"))
      .limit(1);
    if (row?.at != null && now.getTime() - row.at.getTime() < SYNC_MAX_AGE_MS) {
      return { ok: true, skipped: "fresh" };
    }
    // Stale by its last SUCCESS; a failed try is retried after ten minutes,
    // not after six hours.
    return await syncWhatsAppTemplates(db, config, { now, minIntervalMs: RETRY_AFTER_FAILURE_MS });
  } catch {
    return { ok: false, reason: "failed", error: "sync failed" };
  }
}

/** The scheduled job's call: the platform's account, on the app pool. */
export function scheduledTemplateSync(): ReturnType<typeof syncWhatsAppTemplatesIfStale> {
  return syncWhatsAppTemplatesIfStale(appDb, metaConfigFromEnv());
}

// ---------------------------------------------------------------------------
// Submitting for approval.
// ---------------------------------------------------------------------------

export interface SubmitRequest {
  readonly kind: string;
  readonly name: string;
  readonly languages: readonly string[];
}

/**
 * Submit the catalogue's own definition of a kind to Meta, one call per
 * language under ONE name (Meta holds each language as a version of it). What
 * Meta answered is written to the status snapshot at once (source
 * `submitted`, so it shows PENDING before the next sync) and to the audit log.
 *
 * NOT auto-mapped: an approved template still goes live only when an admin
 * maps it — the page offers the name as a one-click "Use this name" once the
 * sync reads it APPROVED. A name going live on Meta's clock, unwatched, is the
 * kind of change this screen exists to make deliberate.
 */
export async function submitForApproval(
  handles: WriteHandles,
  actorId: string,
  request: SubmitRequest,
  config: MetaConfig | null,
): Promise<WriteResult> {
  if (config === null) {
    return {
      ok: false,
      error: "Set WHATSAPP_BUSINESS_ACCOUNT_ID to submit templates from here.",
    };
  }
  if (!isNotificationKind(request.kind) || !hasTemplate(request.kind, "whatsapp")) {
    return { ok: false, error: "There is no WhatsApp template for that notification." };
  }
  const key = request.kind as keyof typeof WHATSAPP_TEMPLATES;
  const refusal = submitRefusal(WHATSAPP_TEMPLATES[key]);
  if (refusal !== null) return { ok: false, error: refusal };
  const name = request.name.trim();
  const nameRefusal = refuseWhatsAppName(name);
  if (nameRefusal !== null) return { ok: false, error: nameRefusal };
  const languages = WHATSAPP_LANGUAGES.filter((l) => request.languages.includes(l));
  if (languages.length === 0 || languages.length !== request.languages.length) {
    return { ok: false, error: "Pick English, Hindi or both." };
  }
  const results: SubmitAuditMeta["results"][number][] = [];
  for (const language of languages) {
    try {
      const receipt = await submitTemplate(config, buildSubmitPayload(key, language, name));
      results.push({ language, status: receipt.status, metaId: receipt.metaId });
      const row = {
        status: receipt.status,
        category: receipt.category,
        quality: null,
        rejectedReason: null,
        metaId: receipt.metaId,
        source: "submitted" as const,
        syncedAt: new Date(),
      };
      await handles.db
        .insert(providerTemplateStatus)
        .values({ name, language, ...row })
        .onConflictDoUpdate({
          target: [providerTemplateStatus.name, providerTemplateStatus.language],
          set: row,
        });
    } catch (error) {
      results.push({
        language,
        error: error instanceof MetaTemplateError ? error.message : "Meta could not be reached",
      });
    }
  }
  const auditId = await audit(handles, actorId, TEMPLATE_AUDIT_ACTIONS.submit, request.kind, {
    change: "submit",
    name,
    results,
  });
  const failed = results.filter((r) => "error" in r);
  if (failed.length === results.length) {
    const first = failed[0];
    return {
      ok: false,
      error: `Meta did not accept it: ${first !== undefined && "error" in first ? first.error : "unknown error"}`,
    };
  }
  const accepted = results.filter((r) => !("error" in r)).map((r) => r.language);
  return {
    ok: true,
    message:
      failed.length === 0
        ? `Submitted ${name} (${accepted.join(", ")}) to Meta. Map it here once it is approved.`
        : `Submitted ${name} in ${accepted.join(", ")}; ${failed.map((f) => f.language).join(", ")} was refused — see the change list.`,
    auditId,
  };
}
