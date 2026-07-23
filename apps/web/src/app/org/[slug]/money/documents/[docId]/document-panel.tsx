"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  useToast,
  VisuallyHidden,
  type BadgeTone,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  retryDeliveryAction,
  type DocumentWorkspace,
  type FinopsResult,
} from "../../../../../../server/financial-operations/actions";
import { DOC_KIND_LABEL } from "../../../../../../server/financial-operations/register";
import { DELIVERY_LANE_LABEL } from "../../../../../../server/financial-operations/deliveries";
import "../../../../../seasons/[slug]/money/money.css";
import "../../finance.css";

/**
 * PX-8 §4 — Operations detail: one document, end to end.
 *
 * The settlement facts it was made FROM, every delivery attempted for it, its
 * audit timeline, and the LIVE reproduction verdict — the platform re-renders
 * the document from the log and compares it with the digest sealed at issue.
 * Nothing here re-computes an amount; the one action is the platform's own retry.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  requested: "info",
  sent: "warning",
  confirmed: "success",
  failed: "danger",
};

const EVENT_LABEL: Record<string, string> = {
  DocumentIssued: "Document issued",
  CorrectionIssued: "Correction issued",
  DispatchRequested: "Delivery requested",
  DispatchSent: "Delivery sent",
  DispatchConfirmed: "Delivery confirmed",
  DispatchFailed: "Delivery failed",
  DispatchRecovered: "Delivery recovered from the log",
};

const CHANNEL_LABEL: Record<string, string> = {
  "in-app": "In-app",
  email: "Email",
  whatsapp: "WhatsApp",
  "org-webhook": "Webhook",
};

function when(atMs: number): string {
  return new Date(atMs).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function DocumentPanel({ slug, workspace }: { slug: string; workspace: DocumentWorkspace }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const { detail, viewer } = workspace;
  const { snapshot, settlement, deliveries, timeline } = detail;
  const document = snapshot.document;

  const act = async (run: () => Promise<FinopsResult>, done: string) => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (result.ok) {
      toast({ title: done, tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  };

  return (
    <div data-testid="document-panel" data-hydrated={hydrated ? "true" : "false"}>
      {/* --- The transaction --------------------------------------------------- */}
      <Card>
        <div className="competition-title-row">
          <div>
            <h2 data-testid="doc-number">{snapshot.formatted}</h2>
            <p className="section-note">
              {DOC_KIND_LABEL[document.kind] ?? document.kind} · {document.partyLabel}
            </p>
          </div>
          <span
            title={`${String(document.amount)} paise`}
            className="stat-value"
            data-testid="doc-amount"
          >
            {formatPaiseINR(paise(document.amount))}
          </span>
        </div>
        {document.corrects === null ? null : (
          <p className="section-note" data-testid="corrects">
            This corrects{" "}
            <Link href={`/org/${slug}/money/documents/${document.corrects}`}>another document</Link>
            . The original is never altered.
          </p>
        )}
      </Card>

      {/* --- Evidence: does it still reproduce? -------------------------------- */}
      <Card>
        <h2>Evidence</h2>
        <p className="section-note">
          The platform re-renders this document from the log on every read and compares it with the
          digest sealed when it was issued. This verdict is live — never a stored flag.
        </p>
        <p
          className="check-list"
          data-testid="reproduction-verdict"
          data-reproducible={snapshot.reproducible}
        >
          <Badge tone={snapshot.reproducible ? "success" : "danger"}>
            {snapshot.reproducible ? "Reproduces" : "DOES NOT REPRODUCE"}
          </Badge>
          <span>
            {snapshot.reproducible
              ? "Re-rendering from the log produced exactly the sealed bytes. Nothing has been altered."
              : `The re-render did not match what was sealed${
                  snapshot.reproductionReason === null ? "" : ` — ${snapshot.reproductionReason}`
                }. Do not rely on this document; raise it.`}
          </span>
        </p>
        <dl className="kv-grid" data-testid="doc-evidence">
          <div>
            <dt>Content digest</dt>
            <dd className="digest" data-testid="content-digest">
              {document.contentDigest}
            </dd>
          </div>
          <div>
            <dt>Issued at event</dt>
            <dd>#{document.issuedAtSeq}</dd>
          </div>
          <div>
            <dt>Finance profile version</dt>
            <dd>pinned at event #{settlement.profileSeq}</dd>
          </div>
        </dl>
      </Card>

      {/* --- Settlement reference ---------------------------------------------- */}
      <Card>
        <h2>Settlement reference</h2>
        <p className="section-note">
          What this document was made from. Finance quotes settlement — it never decides money. The
          watermark is the exact point in settlement&apos;s history this document stands on.
        </p>
        <dl className="kv-grid" data-testid="settlement-ref">
          <div>
            <dt>Source</dt>
            <dd className="digest">{settlement.sourceRef ?? "—"}</dd>
          </div>
          {Object.entries(settlement.watermark).map(([stream, seq]) => (
            <div key={stream}>
              <dt>{stream.split(":")[0]}</dt>
              <dd className="digest">
                {(stream.split(":")[1] ?? "").slice(-10)} @ #{seq}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* --- Delivery history + retry ------------------------------------------ */}
      <Card>
        <h2>Delivery history</h2>
        {deliveries.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="Never sent"
            description="No delivery has been requested for this document. Deliveries are requested by the organization's issuance policy, not from this screen."
          />
        ) : (
          <div className="table-scroll">
            <table className="money-table" data-testid="doc-deliveries">
              <caption>
                <VisuallyHidden>Every delivery attempted for this document</VisuallyHidden>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Attempts</th>
                  <th scope="col" className="num">
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((row) => (
                  <tr key={row.dispatchId} data-testid={`doc-delivery-${row.dispatchId}`}>
                    <td data-label="Status">
                      <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>
                        {DELIVERY_LANE_LABEL[row.status] ?? row.status}
                      </Badge>
                      {row.failureCode === null ? null : (
                        <span className="section-note"> {row.failureCode}</span>
                      )}
                    </td>
                    <td data-label="Channel">{CHANNEL_LABEL[row.channel] ?? row.channel}</td>
                    <td data-label="Recipient">
                      <span className="digest">{row.recipientRef}</span>
                    </td>
                    <td data-label="Attempts">
                      {row.job === null
                        ? "—"
                        : `${String(row.job.attempts)}/${String(row.job.maxAttempts)}`}
                      {row.job?.lastError === undefined || row.job.lastError === null ? null : (
                        <span className="section-note"> · {row.job.lastError}</span>
                      )}
                    </td>
                    <td data-label="" className="num">
                      <div className="money-row-actions">
                        {viewer.canDispatch && row.status === "failed" ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              void act(
                                () => retryDeliveryAction(slug, row.dispatchId),
                                "Retried — a new delivery was requested.",
                              );
                            }}
                            data-testid={`doc-retry-${row.dispatchId}`}
                          >
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* --- Audit timeline ----------------------------------------------------- */}
      <Card>
        <h2>Audit timeline</h2>
        <p className="section-note">
          Every event that touched this document, in the order it happened. This is the log itself —
          it is never rewritten, and everything above is folded from exactly these rows.
        </p>
        <ul className="audit-rail" data-testid="doc-timeline">
          {timeline.map((entry) => (
            <li key={`${entry.stream}-${String(entry.seq)}-${String(entry.atMs)}`}>
              <span className="audit-at">{when(entry.atMs)}</span>
              <span>{EVENT_LABEL[entry.type] ?? entry.type}</span>
              <span className="audit-stream">
                {entry.stream}#{entry.seq}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
