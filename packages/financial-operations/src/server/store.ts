import { createHash } from "node:crypto";

import {
  auditLog,
  finopsCursors,
  finopsDispatches,
  finopsDocuments,
  finopsEvents,
  finopsExports,
  finopsJobs,
  finopsPeriodDays,
  finopsPeriods,
  finopsProfiles,
  finopsSchedules,
  finopsSeries,
  newId,
  organizations,
  payments,
  settlementEvents,
  teams,
  type Db,
} from "@desiauction/db";
import type { SettlementEventEnvelope } from "@desiauction/settlement";
import { and, asc, eq, gte, inArray, lt, lte, max, ne, or, sql } from "drizzle-orm";

import type {
  DigestFn,
  DocumentRow,
  ExportRow,
  FinopsEventEnvelope,
  FinopsStore,
  FinopsStreamType,
  FinopsTx,
  JobRow,
  JobState,
  OrgDirectoryPort,
  PeriodDayRow,
  PeriodRow,
  ReferencePort,
  SeriesRow,
  SettlementSourcePort,
  Watermark,
} from "..";

// The Postgres adapter for the finops ports (IP-6_ARCHITECTURE §5). The domain
// declares the shapes; this file is the only place that knows they are rows.
// Nothing here decides anything: it stores what the writer commits and returns
// what the writer folds. THERE IS NO SETTLEMENT WRITE HERE — the settlement
// source below is SELECT-only, and no finops module imports the settlement
// store or writer.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const sha256: DigestFn = (bytes) => createHash("sha256").update(bytes).digest("hex");

function envelopeOf(row: {
  streamType: string;
  streamId: string;
  seq: number;
  type: string;
  atMs: number;
  actor: string;
  correlationId: string;
  commandId: string;
  payload: unknown;
}): FinopsEventEnvelope {
  return {
    streamType: row.streamType as FinopsStreamType,
    streamId: row.streamId,
    seq: row.seq,
    type: row.type,
    atMs: row.atMs,
    actor: row.actor,
    correlationId: row.correlationId,
    commandId: row.commandId,
    payload: row.payload as Record<string, unknown>,
  };
}

const EVENT_COLUMNS = {
  streamType: finopsEvents.streamType,
  streamId: finopsEvents.streamId,
  seq: finopsEvents.seq,
  type: finopsEvents.type,
  atMs: finopsEvents.atMs,
  actor: finopsEvents.actor,
  correlationId: finopsEvents.correlationId,
  commandId: finopsEvents.commandId,
  payload: finopsEvents.payload,
};

function jobRowOf(row: typeof finopsJobs.$inferSelect): JobRow {
  return {
    jobId: row.id,
    orgId: row.orgId,
    kind: row.kind as JobRow["kind"],
    dedupeKey: row.dedupeKey,
    state: row.state,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    notBeforeMs: row.notBeforeMs,
    leasedUntilMs: row.leasedUntilMs,
    lastError: row.lastError,
    payload: row.payload as Record<string, unknown>,
  };
}

function transaction(tx: Tx): FinopsTx {
  return {
    /** The unique (stream_type, stream_id, seq) makes a concurrent writer LOUD. */
    async appendEvent(input) {
      const [row] = await tx
        .select({ max: sql<number>`coalesce(max(${finopsEvents.seq}), 0)::int` })
        .from(finopsEvents)
        .where(
          and(
            eq(finopsEvents.streamType, input.streamType),
            eq(finopsEvents.streamId, input.streamId),
          ),
        );
      const seq = (row?.max ?? 0) + 1;
      await tx.insert(finopsEvents).values({
        id: newId(),
        orgId: input.orgId,
        streamType: input.streamType,
        streamId: input.streamId,
        seq,
        type: input.type,
        atMs: input.atMs,
        actor: input.actor,
        correlationId: input.correlationId,
        commandId: input.commandId,
        payload: input.payload,
      });
      return seq;
    },

    /** In the same transaction as the event: audit failure fails the action. */
    async writeAudit(input) {
      await tx.insert(auditLog).values({
        id: newId(),
        actor: input.actor,
        action: input.action,
        scopeType: "org",
        scopeId: input.orgId,
        subject: input.subject,
        meta: {
          source: input.source,
          correlationId: input.correlationId,
          eventSeq: String(input.eventSeq),
          ...(input.reason !== undefined && input.reason !== "" ? { reason: input.reason } : {}),
        },
      });
    },

    async putProfile(row) {
      await tx
        .insert(finopsProfiles)
        .values({
          id: row.orgId,
          orgId: row.orgId,
          legalName: row.legalName,
          posture: row.posture,
          gstin: row.gstin,
          autoReceipt: row.autoReceipt,
          version: row.version,
          declaredBy: row.declaredBy,
        })
        .onConflictDoUpdate({
          target: finopsProfiles.id,
          set: {
            legalName: row.legalName,
            posture: row.posture,
            gstin: row.gstin,
            autoReceipt: row.autoReceipt,
            version: row.version,
            declaredBy: row.declaredBy,
          },
        });
    },

    async putSeries(row) {
      await tx
        .insert(finopsSeries)
        .values({
          id: row.seriesId,
          orgId: row.orgId,
          kind: row.kind,
          fy: row.fy,
          prefix: row.prefix,
          status: row.status,
          documentCount: row.documentCount,
          registerDigest: row.registerDigest,
        })
        .onConflictDoUpdate({
          target: finopsSeries.id,
          set: {
            status: row.status,
            documentCount: row.documentCount,
            registerDigest: row.registerDigest,
          },
        });
    },

    async putDocuments(seriesId, rows) {
      await tx.delete(finopsDocuments).where(eq(finopsDocuments.seriesId, seriesId));
      if (rows.length === 0) {
        return;
      }
      await tx.insert(finopsDocuments).values(
        rows.map((row) => ({
          id: row.docId,
          orgId: row.orgId,
          seriesId: row.seriesId,
          number: row.number,
          kind: row.kind,
          partyType: row.partyType,
          partyId: row.partyId,
          partyLabel: row.partyLabel,
          amount: row.amount,
          corrects: row.corrects,
          sourceRef: row.sourceRef,
          profileSeq: row.profileSeq,
          watermark: row.watermark,
          contentDigest: row.contentDigest,
          issuedAtSeq: row.issuedAtSeq,
          issuedBy: row.issuedBy,
        })),
      );
    },

    async putDispatch(row) {
      await tx
        .insert(finopsDispatches)
        .values({
          id: row.dispatchId,
          orgId: row.orgId,
          status: row.status,
          channel: row.channel,
          recipientRef: row.recipientRef,
          templateId: row.templateId,
          templateVersion: row.templateVersion,
          subjectRef: row.subjectRef,
          providerRef: row.providerRef,
          providerEventRef: row.providerEventRef,
          failureCode: row.failureCode,
          requestedBy: row.requestedBy,
        })
        .onConflictDoUpdate({
          target: finopsDispatches.id,
          set: {
            status: row.status,
            providerRef: row.providerRef,
            providerEventRef: row.providerEventRef,
            failureCode: row.failureCode,
          },
        });
    },

    async putExport(row) {
      await tx
        .insert(finopsExports)
        .values({
          id: row.exportId,
          orgId: row.orgId,
          status: row.status,
          kind: row.kind,
          params: row.params,
          requestedBy: row.requestedBy,
          artifactRef: row.artifactRef,
          artifactDigest: row.artifactDigest,
          rowCount: row.rowCount,
          watermark: row.watermark,
          failureCode: row.failureCode,
        })
        .onConflictDoUpdate({
          target: finopsExports.id,
          set: {
            status: row.status,
            artifactRef: row.artifactRef,
            artifactDigest: row.artifactDigest,
            rowCount: row.rowCount,
            watermark: row.watermark,
            failureCode: row.failureCode,
          },
        });
    },

    async putPeriod(row) {
      await tx
        .insert(finopsPeriods)
        .values({
          id: row.periodId,
          orgId: row.orgId,
          fy: row.fy,
          status: row.status,
          openedBy: row.openedBy,
          openingWatermark: row.openingWatermark,
          lastWatermark: row.lastWatermark,
          evidence: row.evidence,
          closedAtSeq: row.closedAtSeq,
          openExceptions: row.openExceptions,
        })
        .onConflictDoUpdate({
          target: finopsPeriods.id,
          set: {
            status: row.status,
            lastWatermark: row.lastWatermark,
            evidence: row.evidence,
            closedAtSeq: row.closedAtSeq,
            openExceptions: row.openExceptions,
          },
        });
    },

    async putPeriodDays(periodId, rows) {
      await tx.delete(finopsPeriodDays).where(eq(finopsPeriodDays.periodId, periodId));
      if (rows.length === 0) {
        return;
      }
      await tx.insert(finopsPeriodDays).values(
        rows.map((row) => ({
          id: newId(),
          orgId: row.orgId,
          periodId: row.periodId,
          date: row.date,
          attestor: row.attestor,
          attestorKind: row.attestorKind,
          failures: row.failures,
          checks: row.checks,
          watermark: row.watermark,
          attestedAtSeq: row.attestedAtSeq,
        })),
      );
    },

    async putCursor(row) {
      await tx
        .insert(finopsCursors)
        .values({
          id: newId(),
          orgId: row.orgId,
          streamType: row.streamType,
          streamId: row.streamId,
          lastSeq: row.lastSeq,
          updatedAtMs: row.updatedAtMs,
        })
        .onConflictDoUpdate({
          target: [finopsCursors.orgId, finopsCursors.streamType, finopsCursors.streamId],
          set: { lastSeq: row.lastSeq, updatedAtMs: row.updatedAtMs },
        });
    },

    async deleteCursors(orgId) {
      await tx.delete(finopsCursors).where(eq(finopsCursors.orgId, orgId));
    },

    async enqueueJob(row) {
      const inserted = await tx
        .insert(finopsJobs)
        .values({
          id: row.jobId,
          orgId: row.orgId,
          kind: row.kind,
          dedupeKey: row.dedupeKey,
          state: row.state,
          attempts: row.attempts,
          maxAttempts: row.maxAttempts,
          notBeforeMs: row.notBeforeMs,
          leasedUntilMs: row.leasedUntilMs,
          lastError: row.lastError,
          payload: row.payload,
          updatedAtMs: row.notBeforeMs,
        })
        .onConflictDoNothing({ target: [finopsJobs.orgId, finopsJobs.dedupeKey] })
        .returning({ id: finopsJobs.id });
      return inserted.length > 0;
    },

    async updateJob(row, fenceLeasedUntilMs) {
      /**
       * THE FENCE. This was `where id = ?`, which is correct only while a lease
       * cannot lapse — and this one can: `drainJobsOnce` claims up to ten jobs
       * under ONE 60s lease and runs them sequentially, so a long export or a
       * day attestation can still be working when the lease expires and another
       * runner reclaims the job. Both then completed it, and the slow original
       * wrote last, stamping `done` over whatever the reclaimer had recorded
       * (audit PA-1 §16).
       *
       * The lease the caller claimed with IS the fence token — no new column
       * needed. A reclaim always writes a fresh `leased_until_ms`, so the
       * original's predicate stops matching the moment ownership moves.
       */
      const updated = await tx
        .update(finopsJobs)
        .set({
          state: row.state,
          attempts: row.attempts,
          notBeforeMs: row.notBeforeMs,
          leasedUntilMs: row.leasedUntilMs,
          lastError: row.lastError,
          // The CLOCK, not `notBeforeMs` — this column answers "when did this
          // row last change", and a retry's future run-at is a different fact.
          updatedAtMs: Date.now(),
        })
        .where(
          fenceLeasedUntilMs === undefined || fenceLeasedUntilMs === null
            ? eq(finopsJobs.id, row.jobId)
            : and(eq(finopsJobs.id, row.jobId), eq(finopsJobs.leasedUntilMs, fenceLeasedUntilMs)),
        )
        .returning({ id: finopsJobs.id });
      return updated.length > 0;
    },

    async purgeFinishedJobs(beforeMs) {
      // `done` only. A `dead` job is evidence that something needs a human and
      // is what `loadDeadJobs` and the daily checklist read.
      const gone = await tx
        .delete(finopsJobs)
        .where(and(eq(finopsJobs.state, "done"), lt(finopsJobs.updatedAtMs, beforeMs)))
        .returning({ id: finopsJobs.id });
      return gone.length;
    },

    async putSchedule(row) {
      await tx
        .insert(finopsSchedules)
        .values({ slot: row.slot, nextDueMs: row.nextDueMs, lastFiredMs: row.lastFiredMs })
        .onConflictDoUpdate({
          target: finopsSchedules.slot,
          set: { nextDueMs: row.nextDueMs, lastFiredMs: row.lastFiredMs },
        });
    },
  };
}

export function createFinopsStore(db: Db): FinopsStore {
  return {
    async transact(fn) {
      return db.transaction(async (tx) => fn(transaction(tx)));
    },

    async loadStream(streamType, streamId) {
      const rows = await db
        .select(EVENT_COLUMNS)
        .from(finopsEvents)
        .where(and(eq(finopsEvents.streamType, streamType), eq(finopsEvents.streamId, streamId)))
        .orderBy(asc(finopsEvents.seq));
      return rows.map(envelopeOf);
    },

    async findByCommandId(streamType, streamId, commandId) {
      const [row] = await db
        .select(EVENT_COLUMNS)
        .from(finopsEvents)
        .where(
          and(
            eq(finopsEvents.streamType, streamType),
            eq(finopsEvents.streamId, streamId),
            eq(finopsEvents.commandId, commandId),
          ),
        )
        .limit(1);
      return row === undefined ? null : envelopeOf(row);
    },

    async listStreamIds(orgId, streamType) {
      const rows = await db
        .selectDistinct({ streamId: finopsEvents.streamId })
        .from(finopsEvents)
        .where(and(eq(finopsEvents.orgId, orgId), eq(finopsEvents.streamType, streamType)))
        .orderBy(asc(finopsEvents.streamId));
      return rows.map((row) => row.streamId);
    },

    async loadProfile(orgId) {
      const [row] = await db
        .select()
        .from(finopsProfiles)
        .where(eq(finopsProfiles.orgId, orgId))
        .limit(1);
      return row === undefined
        ? null
        : {
            orgId: row.orgId,
            legalName: row.legalName,
            posture: row.posture,
            gstin: row.gstin,
            autoReceipt: row.autoReceipt,
            version: row.version,
            declaredBy: row.declaredBy,
          };
    },

    async loadSeries(seriesId) {
      const [row] = await db
        .select()
        .from(finopsSeries)
        .where(eq(finopsSeries.id, seriesId))
        .limit(1);
      return row === undefined ? null : seriesRowOf(row);
    },

    async loadSeriesFor(orgId, kind, fy) {
      const [row] = await db
        .select()
        .from(finopsSeries)
        .where(
          and(eq(finopsSeries.orgId, orgId), eq(finopsSeries.kind, kind), eq(finopsSeries.fy, fy)),
        )
        .limit(1);
      return row === undefined ? null : seriesRowOf(row);
    },

    async loadDocument(docId) {
      const [row] = await db
        .select()
        .from(finopsDocuments)
        .where(eq(finopsDocuments.id, docId))
        .limit(1);
      return row === undefined ? null : documentRowOf(row);
    },

    async loadDocuments(seriesId) {
      const rows = await db
        .select()
        .from(finopsDocuments)
        .where(eq(finopsDocuments.seriesId, seriesId))
        .orderBy(asc(finopsDocuments.number));
      return rows.map(documentRowOf);
    },

    async loadDispatch(dispatchId) {
      const [row] = await db
        .select()
        .from(finopsDispatches)
        .where(eq(finopsDispatches.id, dispatchId))
        .limit(1);
      return row === undefined
        ? null
        : {
            dispatchId: row.id,
            orgId: row.orgId,
            status: row.status,
            channel: row.channel,
            recipientRef: row.recipientRef,
            templateId: row.templateId,
            templateVersion: row.templateVersion,
            subjectRef: row.subjectRef,
            providerRef: row.providerRef,
            providerEventRef: row.providerEventRef,
            failureCode: row.failureCode,
            requestedBy: row.requestedBy,
          };
    },

    async loadExport(exportId) {
      const [row] = await db
        .select()
        .from(finopsExports)
        .where(eq(finopsExports.id, exportId))
        .limit(1);
      return row === undefined
        ? null
        : {
            exportId: row.id,
            orgId: row.orgId,
            status: row.status,
            kind: row.kind,
            params: row.params as ExportRow["params"],
            requestedBy: row.requestedBy,
            artifactRef: row.artifactRef,
            artifactDigest: row.artifactDigest,
            rowCount: row.rowCount,
            watermark: row.watermark as ExportRow["watermark"],
            failureCode: row.failureCode,
          };
    },

    async loadPeriod(periodId) {
      const [row] = await db
        .select()
        .from(finopsPeriods)
        .where(eq(finopsPeriods.id, periodId))
        .limit(1);
      return row === undefined ? null : periodRowOf(row);
    },

    async loadPeriodFor(orgId, fy) {
      const [row] = await db
        .select()
        .from(finopsPeriods)
        .where(and(eq(finopsPeriods.orgId, orgId), eq(finopsPeriods.fy, fy)))
        .limit(1);
      return row === undefined ? null : periodRowOf(row);
    },

    async loadPeriodDays(periodId) {
      const rows = await db
        .select()
        .from(finopsPeriodDays)
        .where(eq(finopsPeriodDays.periodId, periodId))
        .orderBy(asc(finopsPeriodDays.date));
      return rows.map((row) => ({
        periodId: row.periodId,
        orgId: row.orgId,
        date: row.date,
        attestor: row.attestor,
        attestorKind: row.attestorKind,
        failures: row.failures,
        checks: row.checks as PeriodDayRow["checks"],
        watermark: row.watermark as PeriodDayRow["watermark"],
        attestedAtSeq: row.attestedAtSeq,
      }));
    },

    async loadDispatchesByStatus(orgId, status) {
      const rows = await db
        .select()
        .from(finopsDispatches)
        .where(and(eq(finopsDispatches.orgId, orgId), eq(finopsDispatches.status, status)))
        .orderBy(asc(finopsDispatches.id));
      return rows.map((row) => ({
        dispatchId: row.id,
        orgId: row.orgId,
        status: row.status,
        channel: row.channel,
        recipientRef: row.recipientRef,
        templateId: row.templateId,
        templateVersion: row.templateVersion,
        subjectRef: row.subjectRef,
        providerRef: row.providerRef,
        providerEventRef: row.providerEventRef,
        failureCode: row.failureCode,
        requestedBy: row.requestedBy,
      }));
    },

    /*
     * The enqueue pass's discovery reads. One scan on `status` instead of one
     * query per organization — see the port for why the tenant loop went.
     * Only the two identifiers the pipelines actually enqueue on are selected;
     * the handlers load the full row inside their own job.
     */
    async listRequestedDispatches() {
      const rows = await db
        .select({ dispatchId: finopsDispatches.id, orgId: finopsDispatches.orgId })
        .from(finopsDispatches)
        .where(eq(finopsDispatches.status, "requested"))
        .orderBy(asc(finopsDispatches.id));
      return rows;
    },

    async listRequestedExports() {
      const rows = await db
        .select({ exportId: finopsExports.id, orgId: finopsExports.orgId })
        .from(finopsExports)
        .where(eq(finopsExports.status, "requested"))
        .orderBy(asc(finopsExports.id));
      return rows;
    },

    async loadExportsByOrg(orgId) {
      const rows = await db
        .select()
        .from(finopsExports)
        .where(eq(finopsExports.orgId, orgId))
        .orderBy(asc(finopsExports.id));
      return rows.map((row) => ({
        exportId: row.id,
        orgId: row.orgId,
        status: row.status,
        kind: row.kind,
        params: row.params as ExportRow["params"],
        requestedBy: row.requestedBy,
        artifactRef: row.artifactRef,
        artifactDigest: row.artifactDigest,
        rowCount: row.rowCount,
        watermark: row.watermark as ExportRow["watermark"],
        failureCode: row.failureCode,
      }));
    },

    async loadCursors(orgId) {
      const rows = await db
        .select()
        .from(finopsCursors)
        .where(eq(finopsCursors.orgId, orgId))
        .orderBy(asc(finopsCursors.streamType), asc(finopsCursors.streamId));
      return rows.map((row) => ({
        orgId: row.orgId,
        streamType: row.streamType,
        streamId: row.streamId,
        lastSeq: row.lastSeq,
        updatedAtMs: row.updatedAtMs,
      }));
    },

    /**
     * Claim due work: queued jobs past not_before, plus leased jobs whose lease
     * lapsed (crash recovery is a timeout). FOR UPDATE SKIP LOCKED keeps
     * concurrent runners from double-claiming; the lease keeps a crashed one
     * from stranding work.
     */
    async claimJobs(nowMs, leaseMs, limit, orgId) {
      return db.transaction(async (tx) => {
        const due = or(
          and(eq(finopsJobs.state, "queued"), lte(finopsJobs.notBeforeMs, nowMs)),
          and(eq(finopsJobs.state, "leased"), lte(finopsJobs.leasedUntilMs, nowMs)),
        );
        const candidates = await tx
          .select({ id: finopsJobs.id, state: finopsJobs.state })
          .from(finopsJobs)
          .where(orgId === undefined ? due : and(eq(finopsJobs.orgId, orgId), due))
          .orderBy(asc(finopsJobs.notBeforeMs))
          .limit(limit)
          .for("update", { skipLocked: true });
        if (candidates.length === 0) {
          return [];
        }
        const ids = candidates.map((row) => row.id);

        /**
         * A RECLAIM IS A FAILED ATTEMPT, AND IT USED TO BE FREE.
         *
         * A job in `leased` state that is due again lost its lease without
         * finishing — the worker crashed, was OOM-killed, or `die()`d. That is
         * an attempt, and it was not counted: `attempts` only ever incremented
         * in the drain's catch block, which never runs when the PROCESS dies.
         * So a job that reliably kills its worker looped for ever at
         * `attempts = 0`, never dead-lettered, and never appeared in
         * `loadDeadJobs` for anyone to see (audit PA-1 §16).
         *
         * Counting it here closes that, and the sweep below then retires the
         * ones that have used up their attempts — otherwise the count would
         * rise for ever and change nothing.
         */
        const reclaimed = candidates.filter((row) => row.state === "leased").map((row) => row.id);
        if (reclaimed.length > 0) {
          await tx
            .update(finopsJobs)
            .set({
              attempts: sql`${finopsJobs.attempts} + 1`,
              lastError: "lease expired without completion",
              updatedAtMs: nowMs,
            })
            .where(inArray(finopsJobs.id, reclaimed));
          await tx
            .update(finopsJobs)
            .set({ state: "dead", leasedUntilMs: null, updatedAtMs: nowMs })
            .where(
              and(
                inArray(finopsJobs.id, reclaimed),
                gte(finopsJobs.attempts, finopsJobs.maxAttempts),
              ),
            );
        }

        const claimed = await tx
          .update(finopsJobs)
          .set({ state: "leased", leasedUntilMs: nowMs + leaseMs, updatedAtMs: nowMs })
          // A job retired just above must not then be handed out.
          .where(and(inArray(finopsJobs.id, ids), ne(finopsJobs.state, "dead")))
          .returning();
        return claimed.map(jobRowOf);
      });
    },

    async loadJobs(orgId) {
      const rows = await db
        .select()
        .from(finopsJobs)
        .where(eq(finopsJobs.orgId, orgId))
        .orderBy(asc(finopsJobs.notBeforeMs));
      return rows.map(jobRowOf);
    },

    async loadDeadJobs(orgId) {
      const rows = await db
        .select()
        .from(finopsJobs)
        .where(and(eq(finopsJobs.orgId, orgId), eq(finopsJobs.state, "dead")))
        .orderBy(asc(finopsJobs.notBeforeMs));
      return rows.map(jobRowOf);
    },

    async countJobs() {
      const rows = await db
        .select({ state: finopsJobs.state, count: sql<number>`count(*)::int` })
        .from(finopsJobs)
        .groupBy(finopsJobs.state);
      const counts: Record<JobState, number> = { queued: 0, leased: 0, done: 0, dead: 0 };
      for (const row of rows) {
        counts[row.state] = row.count;
      }
      return counts;
    },

    async oldestQueuedNotBeforeMs() {
      const [row] = await db
        .select({ oldest: sql<number | null>`min(${finopsJobs.notBeforeMs})` })
        .from(finopsJobs)
        .where(eq(finopsJobs.state, "queued"));
      return row?.oldest ?? null;
    },

    async loadSchedules() {
      const rows = await db.select().from(finopsSchedules).orderBy(asc(finopsSchedules.slot));
      return rows.map((row) => ({
        slot: row.slot,
        nextDueMs: row.nextDueMs,
        lastFiredMs: row.lastFiredMs,
      }));
    },

    async hasAuditBreadcrumb(orgId, action) {
      // `scopeType` is pinned so this rides `audit_scope_idx`
      // (scope_type, scope_id, at) — that index LEADS on scope_type, so a
      // query filtering only scope_id and action cannot use it and Postgres
      // sequentially scans the whole audit log. Which would be a poor thing to
      // put on a loop that asks once per org per tick, on a table that only
      // ever grows. Every breadcrumb this asks about is written by
      // `writeAudit` with scopeType "org"; the argument is named orgId for the
      // same reason.
      const [row] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.scopeType, "org"),
            eq(auditLog.scopeId, orgId),
            eq(auditLog.action, action),
          ),
        )
        .limit(1);
      return row !== undefined;
    },

    async loadAuditBreadcrumbs(orgId, action) {
      const rows = await db
        .select({ at: auditLog.at, meta: auditLog.meta })
        .from(auditLog)
        .where(and(eq(auditLog.scopeId, orgId), eq(auditLog.action, action)))
        .orderBy(asc(auditLog.at));
      return rows.map((row) => ({
        atMs: row.at.getTime(),
        reason:
          (((row.meta ?? {}) as Record<string, unknown>)["reason"] as string | undefined) ?? null,
      }));
    },
  };
}

function documentRowOf(row: typeof finopsDocuments.$inferSelect): DocumentRow {
  return {
    docId: row.id,
    orgId: row.orgId,
    seriesId: row.seriesId,
    number: row.number,
    kind: row.kind,
    partyType: row.partyType,
    partyId: row.partyId,
    partyLabel: row.partyLabel,
    amount: row.amount,
    corrects: row.corrects,
    sourceRef: row.sourceRef,
    profileSeq: row.profileSeq,
    watermark: row.watermark as DocumentRow["watermark"],
    contentDigest: row.contentDigest,
    issuedAtSeq: row.issuedAtSeq,
    issuedBy: row.issuedBy,
  };
}

function seriesRowOf(row: typeof finopsSeries.$inferSelect): SeriesRow {
  return {
    seriesId: row.id,
    orgId: row.orgId,
    kind: row.kind,
    fy: row.fy,
    prefix: row.prefix,
    status: row.status,
    documentCount: row.documentCount,
    registerDigest: row.registerDigest,
  };
}

function periodRowOf(row: typeof finopsPeriods.$inferSelect): PeriodRow {
  return {
    periodId: row.id,
    orgId: row.orgId,
    fy: row.fy,
    status: row.status,
    openedBy: row.openedBy,
    openingWatermark: row.openingWatermark as Watermark,
    lastWatermark: row.lastWatermark as Watermark,
    evidence: row.evidence === null ? null : (row.evidence as Record<string, unknown>),
    closedAtSeq: row.closedAtSeq,
    openExceptions: row.openExceptions,
  };
}

/**
 * The frozen settlement log, READ-ONLY. There is no write method here and
 * there never will be: financial operations consumes `settlement_events` and
 * holds no path to mutate it (IP-6_ARCHITECTURE constitutional constraint 5;
 * the AuctionSourcePort precedent).
 */
export function createSettlementSource(db: Db): SettlementSourcePort {
  return {
    async listOrgStreamHeads(orgId) {
      const rows = await db
        .select({
          streamType: settlementEvents.streamType,
          streamId: settlementEvents.streamId,
          headSeq: max(settlementEvents.seq),
        })
        .from(settlementEvents)
        .where(eq(settlementEvents.orgId, orgId))
        .groupBy(settlementEvents.streamType, settlementEvents.streamId)
        .orderBy(asc(settlementEvents.streamType), asc(settlementEvents.streamId));
      return rows.map((row) => ({
        streamType: row.streamType,
        streamId: row.streamId,
        headSeq: row.headSeq ?? 0,
      }));
    },

    async loadEventsFrom(streamType, streamId, fromSeq) {
      const rows = await db
        .select({
          streamType: settlementEvents.streamType,
          streamId: settlementEvents.streamId,
          seq: settlementEvents.seq,
          type: settlementEvents.type,
          atMs: settlementEvents.atMs,
          actor: settlementEvents.actor,
          correlationId: settlementEvents.correlationId,
          commandId: settlementEvents.commandId,
          payload: settlementEvents.payload,
        })
        .from(settlementEvents)
        .where(
          and(
            eq(settlementEvents.streamType, streamType as "case" | "journal" | "payment"),
            eq(settlementEvents.streamId, streamId),
            sql`${settlementEvents.seq} > ${fromSeq}`,
          ),
        )
        .orderBy(asc(settlementEvents.seq));
      return rows.map((row): SettlementEventEnvelope => ({
        streamType: row.streamType,
        streamId: row.streamId,
        seq: row.seq,
        type: row.type,
        atMs: row.atMs,
        actor: row.actor,
        correlationId: row.correlationId,
        commandId: row.commandId,
        payload: row.payload as Record<string, unknown>,
      }));
    },

    /**
     * Receipt-due DISCOVERY (M-IP6-2): reads the settlement `payments`
     * projection — a verified-upstream convenience (§12). Every issuance
     * DECISION re-derives from the payment stream's fold; a stale or tampered
     * row here can only surface a candidate whose issuance then fails closed.
     */
    async listCapturedPayments(orgId) {
      const rows = await db
        .select({ id: payments.id, caseId: payments.caseId, teamId: payments.teamId })
        .from(payments)
        .where(and(eq(payments.orgId, orgId), sql`${payments.captured} > 0`))
        .orderBy(asc(payments.id));
      return rows.map((row) => ({ paymentId: row.id, caseId: row.caseId, teamId: row.teamId }));
    },

    async listOpenPayments(orgId) {
      const rows = await db
        .select({ id: payments.id, createdAt: payments.createdAt })
        .from(payments)
        .where(and(eq(payments.orgId, orgId), eq(payments.status, "created")))
        .orderBy(asc(payments.id));
      return rows.map((row) => ({ paymentId: row.id, createdAtMs: row.createdAt.getTime() }));
    },
  };
}

/** Party label snapshots at issue — read-only reference data (M-IP6-2). */
export function createOrgReference(db: Db): ReferencePort {
  return {
    async teamLabel(teamId) {
      const [row] = await db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
      return row?.name ?? null;
    },
  };
}

/** Org enumeration for the runner's per-org iteration (the sweep pattern). */
export function createOrgDirectory(db: Db): OrgDirectoryPort {
  return {
    async listOrgIds() {
      const rows = await db
        .select({ id: organizations.id })
        .from(organizations)
        .orderBy(asc(organizations.id));
      return rows.map((row) => row.id);
    },
  };
}
