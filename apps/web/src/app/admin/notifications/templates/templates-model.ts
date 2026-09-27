import type { KitTone } from "@desiauction/ui";

import type {
  MappedView,
  ProviderTemplatesView,
  SmsRow,
  StatusView,
  WhatsAppRow,
} from "../../../../server/admin/provider-template-views";

/**
 * /admin/notifications/templates, put into words — pure over the read model
 * (provider-template-views.ts), so what each row says about its template is a
 * unit test. Nothing here decides whether a template is used: the resolver and
 * Meta's verdict do. This only names the state they left.
 */

export interface TemplateStatus {
  readonly word: string;
  readonly tone: KitTone;
}

const NOT_SET: TemplateStatus = { word: "Not set", tone: "neutral" };
const MAPPED: TemplateStatus = { word: "Mapped", tone: "blue" };

/** A Meta status that is still in review rather than refused. */
function inReview(statuses: readonly StatusView[]): boolean {
  return statuses.some((s) => ["PENDING", "IN_APPEAL"].includes(s.status.toUpperCase()));
}

/**
 * One WhatsApp message's template, in one word: Not set (no name anywhere),
 * Approved / Pending / Not approved (Meta's last word on the name), or Mapped
 * (a name, and nothing from Meta to judge it by — sync off or never run).
 */
export function whatsappStatus(row: WhatsAppRow): TemplateStatus {
  if (row.mapped.handle === null) return NOT_SET;
  const approval = row.approval;
  if (approval === null || approval.verdict === "unknown") return MAPPED;
  if (approval.verdict === "approved") return { word: "Approved", tone: "green" };
  return inReview(row.statuses)
    ? { word: "Pending", tone: "amber" }
    : { word: "Not approved", tone: "red" };
}

/** An SMS message's DLT template: an id is Mapped; Meta has no say here. */
export function smsStatus(row: SmsRow): TemplateStatus {
  return row.mapped.handle === null ? NOT_SET : MAPPED;
}

/** "3 of 10 mapped" — a name set anywhere, here or on the server. */
export function mappedCount(rows: readonly { mapped: MappedView }[]): string {
  const n = rows.filter((row) => row.mapped.handle !== null).length;
  return `${String(n)} of ${String(rows.length)} mapped`;
}

/** The ⋯ menu's Clear item says where the message falls back to. */
export function clearLabel(mapped: MappedView): string {
  return mapped.envValue === null
    ? "Clear mapping — no template after"
    : `Clear mapping — back to ${mapped.envValue}`;
}

export interface SetupLine {
  readonly key: "whatsapp" | "sms" | "sync";
  readonly testId: string;
}

/**
 * What is not set up on this server, in the order it matters: nothing goes on
 * WhatsApp, then SMS, then Meta's status sync (mapping works without it). The
 * page draws these as ONE calm banner; an empty list draws none.
 */
export function setupLines(view: ProviderTemplatesView): SetupLine[] {
  const lines: SetupLine[] = [];
  if (!view.whatsappConfigured) lines.push({ key: "whatsapp", testId: "tpl-wa-unconfigured" });
  if (!view.smsGateway) lines.push({ key: "sms", testId: "tpl-sms-dormant" });
  if (!view.syncEnabled) lines.push({ key: "sync", testId: "tpl-sync-disabled" });
  return lines;
}

/** The banner's title, from the same facts as its lines. */
export function setupTitle(view: ProviderTemplatesView): string | null {
  const off = [view.whatsappConfigured ? null : "WhatsApp", view.smsGateway ? null : "SMS"].filter(
    (name): name is string => name !== null,
  );
  if (off.length === 2) return "Nothing mapped here takes effect yet";
  if (off.length === 1) return `${off[0] ?? ""} mappings don't take effect yet`;
  return view.syncEnabled ? null : "Meta's approvals aren't being read";
}
