import { providerTemplateStatus, providerTemplateSyncs, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";

/**
 * WHAT META LAST SAID about each template — read side (Phase 3).
 *
 * The snapshot lives in `provider_template_status` (0088), written by the sync
 * and by a submission (provider-template-writer.ts). This module only reads it
 * and interprets it: which chip a status earns, and whether a mapped name can
 * actually send. Pure below the loader, so each verdict is a unit test.
 */

export interface StatusRow {
  readonly name: string;
  readonly language: string;
  readonly status: string;
  readonly category: string | null;
  readonly quality: string | null;
  readonly rejectedReason: string | null;
  readonly metaId: string | null;
  readonly source: "sync" | "submitted";
  readonly syncedAt: Date;
}

export interface SyncRecord {
  readonly lastAttemptAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly lastError: string | null;
  readonly templateCount: number;
}

export interface StatusSnapshot {
  /** Every row for a name, by name. */
  readonly byName: ReadonlyMap<string, readonly StatusRow[]>;
  readonly sync: SyncRecord;
}

export const NEVER_SYNCED: SyncRecord = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  templateCount: 0,
};

export const EMPTY_STATUS: StatusSnapshot = { byName: new Map(), sync: NEVER_SYNCED };

export function snapshotOf(rows: readonly StatusRow[], sync: SyncRecord): StatusSnapshot {
  const byName = new Map<string, StatusRow[]>();
  for (const row of rows) {
    const list = byName.get(row.name) ?? [];
    list.push(row);
    byName.set(row.name, list);
  }
  for (const list of byName.values()) list.sort((a, b) => a.language.localeCompare(b.language));
  return { byName, sync };
}

export async function loadStatusSnapshot(db: Db): Promise<StatusSnapshot> {
  const rows = await db.select().from(providerTemplateStatus);
  const [sync] = await db
    .select()
    .from(providerTemplateSyncs)
    .where(eq(providerTemplateSyncs.provider, "whatsapp"))
    .limit(1);
  return snapshotOf(
    rows,
    sync === undefined
      ? NEVER_SYNCED
      : {
          lastAttemptAt: sync.lastAttemptAt,
          lastSuccessAt: sync.lastSuccessAt,
          lastError: sync.lastError,
          templateCount: sync.templateCount,
        },
  );
}

export type ChipTone = "green" | "amber" | "red" | "neutral";

/** The chip one Meta status earns, in words an operator reads. */
export function statusChip(status: string): { readonly label: string; readonly tone: ChipTone } {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return { label: "Approved", tone: "green" };
    case "PENDING":
    case "IN_APPEAL":
    case "PENDING_DELETION":
      return {
        label: status.toUpperCase() === "IN_APPEAL" ? "In appeal" : "Pending",
        tone: "amber",
      };
    case "PAUSED":
      return { label: "Paused by Meta", tone: "amber" };
    case "REJECTED":
      return { label: "Rejected", tone: "red" };
    case "DISABLED":
      return { label: "Disabled by Meta", tone: "red" };
    case "LIMIT_EXCEEDED":
      return { label: "Limit exceeded", tone: "red" };
    default:
      return { label: status === "" ? "Unknown" : status, tone: "neutral" };
  }
}

export type Approval =
  /** Meta approved it in at least one of the languages it is mapped for. */
  | { readonly verdict: "approved"; readonly missing: readonly string[] }
  /** The last sync says it cannot send: pending, rejected, paused, or absent. */
  | { readonly verdict: "not_approved"; readonly why: string }
  /** Nothing to go on — never synced, or the WABA id is not set. */
  | { readonly verdict: "unknown" };

/**
 * CAN THIS NAME SEND, per the last sync? `languages` null means "whatever it
 * is approved in" (an env name, which never said).
 *
 * Unknown is not "not approved": with no sync there is nothing to say, and the
 * grid does not accuse a name it has no evidence against. A name the last
 * SUCCESSFUL sync did not see at all is the opposite — Meta has no template by
 * that name, which is exactly the typo an admin needs told about.
 */
export function approvalOf(
  name: string,
  languages: readonly string[] | null,
  snapshot: StatusSnapshot,
): Approval {
  const rows = snapshot.byName.get(name) ?? [];
  const relevant = languages === null ? rows : rows.filter((r) => languages.includes(r.language));
  if (relevant.length === 0) {
    if (rows.length > 0) {
      return {
        verdict: "not_approved",
        why: `Meta has it only in ${rows.map((r) => r.language).join(", ")}`,
      };
    }
    return snapshot.sync.lastSuccessAt === null
      ? { verdict: "unknown" }
      : { verdict: "not_approved", why: "Meta has no template by this name" };
  }
  const approved = relevant.filter((r) => r.status.toUpperCase() === "APPROVED");
  if (approved.length > 0) {
    const want = languages ?? relevant.map((r) => r.language);
    return {
      verdict: "approved",
      missing: want.filter((l) => !approved.some((r) => r.language === l)),
    };
  }
  const worst = relevant[0];
  return {
    verdict: "not_approved",
    why: worst === undefined ? "Not approved" : statusChip(worst.status).label,
  };
}
