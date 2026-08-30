"use client";

import { useFinopsAct } from "../use-finops-act";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  VisuallyHidden,
  type BadgeTone,
} from "@desiauction/ui";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  cancelDeliveryAction,
  confirmDeliveryAction,
  requeueJobAction,
  retryDeliveryAction,
  type DeliveryWorkspace,
} from "../../../../../server/financial-operations/actions";
import {
  DELIVERY_LANE_LABEL,
  DELIVERY_LANES,
  filterDeliveries,
} from "../../../../../server/financial-operations/deliveries";
import type { DeliveryView } from "../../../../../server/financial-operations/views";
import "../../../../seasons/[slug]/money/money.css";
import "../finance.css";

/**
 * PX-8 §2 — the Delivery workspace.
 *
 * The certified dispatch pipeline, one lane at a time. Every button maps to
 * exactly one existing writer; nothing here decides whether an action is legal
 * — the dispatch's own status does, and the platform re-decides it server-side
 * regardless of what this renders.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  requested: "info",
  sent: "warning",
  confirmed: "success",
  failed: "danger",
};

const CHANNEL_LABEL: Record<string, string> = {
  "in-app": "In-app",
  email: "Email",
  whatsapp: "WhatsApp",
  "org-webhook": "Webhook",
};

/** Statuses that have stopped moving — a wait time is meaningless on these. */
const TERMINAL = new Set(["confirmed", "failed"]);

/**
 * How long a delivery has been waiting, in words. The duration is resolved on
 * the server against the injected clock; this only formats it.
 */
function waitedFor(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour" : `${String(hours)} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${String(days)} days`;
}

function when(atMs: number): string {
  return new Date(atMs).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function DeliveriesPanel({
  slug,
  workspace,
}: {
  slug: string;
  workspace: DeliveryWorkspace;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const [dialog, setDialog] = useState<{ kind: "cancel" | "confirm"; row: DeliveryView } | null>(
    null,
  );
  const [note, setNote] = useState("");

  const lane = params.get("lane") ?? "";
  const { deliveries, viewer } = workspace;
  const rows = filterDeliveries(deliveries.rows, lane);

  const { busy, act, outcomeNote } = useFinopsAct();

  return (
    <div data-testid="deliveries-panel" data-hydrated={hydrated ? "true" : "false"}>
      {/* Where focus lands after a command, and what it says. */}
      {outcomeNote}
      {/* --- The lanes, each a filter you can link to ------------------------- */}
      <div className="lane-row" data-testid="lane-row">
        {DELIVERY_LANES.map((key) => (
          <Link
            key={key}
            href={`${pathname}?lane=${key}`}
            className="lane-tile"
            aria-current={lane === key ? "page" : undefined}
            data-testid={`lane-${key}`}
          >
            <span className="lane-count">{deliveries.counts[key] ?? 0}</span>
            <span className="lane-label">{DELIVERY_LANE_LABEL[key]}</span>
          </Link>
        ))}
      </div>
      {lane !== "" ? (
        <p className="section-note">
          Showing {DELIVERY_LANE_LABEL[lane] ?? lane} ·{" "}
          <Link href={pathname} data-testid="clear-lane">
            show every delivery
          </Link>
        </p>
      ) : null}
      {/* Say what "recorded as sent" is worth. The in-app channel confirms every
          dispatch unconditionally into a register only finance staff can read,
          and the email channel writes a file to a server directory — so an
          operator could see a full column of successes for receipts no customer
          ever received. */}
      <p className="section-note" data-testid="delivery-reach-note">
        These statuses describe what the platform did, not what the recipient saw. Documents
        aren&rsquo;t yet delivered to the people they name — if a customer needs their receipt, send
        it to them yourself.
      </p>

      {/* --- Retry status ----------------------------------------------------- */}
      {deliveries.retries.retrying.length > 0 ? (
        <Card>
          <h2>Retrying</h2>
          <p className="section-note">
            The runner backs off and tries again on its own schedule. These are waiting, not stuck.
          </p>
          <ul className="attention-list" data-testid="retrying-list">
            {deliveries.retries.retrying.map((job) => (
              <li className="attention-item" key={job.dedupeKey}>
                <span>
                  <Badge tone="warning">attempt {job.attempts}</Badge>{" "}
                  <span className="attention-subject">{job.kind}</span>
                  {job.lastError === null ? null : (
                    <span className="attention-subject"> — {job.lastError}</span>
                  )}
                </span>
                <span className="attention-action">next {when(job.notBeforeMs)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* --- The dead-letter queue -------------------------------------------- */}
      {deliveries.dead.length > 0 ? (
        <Card>
          <h2>Dead letters</h2>
          <p className="section-note">
            These exhausted every retry and stopped. Requeueing puts a job back on the queue from
            attempt zero — it does not skip the work, and nothing is lost by trying again.
          </p>
          <ul className="attention-list" data-testid="dead-list">
            {deliveries.dead.map((job) => (
              <li className="attention-item" key={job.jobId}>
                <span>
                  <Badge tone="danger">dead</Badge>{" "}
                  <span className="attention-subject">{job.kind}</span>
                  {job.lastError === null ? null : (
                    <span className="attention-subject"> — {job.lastError}</span>
                  )}
                </span>
                {viewer.canOperate ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void act(() => requeueJobAction(slug, job.jobId), "Job requeued.");
                    }}
                    data-testid={`requeue-${job.jobId}`}
                  >
                    Requeue
                  </Button>
                ) : (
                  <span className="attention-action">
                    You need the Accountant role to requeue a job
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* --- The deliveries themselves ---------------------------------------- */}
      <Card>
        <h2>Deliveries</h2>
        {rows.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title={deliveries.rows.length === 0 ? "No deliveries yet" : "Nothing in this lane"}
            description={
              deliveries.rows.length === 0
                ? "A delivery is requested when a document is issued and the org's policy says to send it. Nothing is sent from this screen."
                : "Pick another lane, or show every delivery."
            }
          />
        ) : (
          <div
            className="table-scroll money-scroll"
            tabIndex={0}
            role="region"
            aria-label="Delivery register"
          >
            <table className="money-table" data-testid="deliveries-table">
              <caption>
                <VisuallyHidden>
                  Every delivery, with its channel, status and retries
                </VisuallyHidden>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Document</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Attempts</th>
                  <th scope="col" className="num">
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.dispatchId} data-testid={`delivery-${row.dispatchId}`}>
                    <td data-label="Status">
                      <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>
                        {DELIVERY_LANE_LABEL[row.status] ?? row.status}
                      </Badge>
                      {row.failureCode === null ? null : (
                        <span className="section-note"> {row.failureCode}</span>
                      )}
                    </td>
                    {/* When it was asked for, and how long it has been waiting.
                        Without this a delivery stuck for seven days looked
                        exactly like one requested a minute ago. */}
                    <td data-label="Requested">
                      {row.requestedAtMs === null ? (
                        <span className="section-note">—</span>
                      ) : (
                        <>
                          <span>{when(row.requestedAtMs)}</span>
                          {row.waitingMs !== null && !TERMINAL.has(row.status) ? (
                            <span className="section-note">
                              {" "}
                              · waiting {waitedFor(row.waitingMs)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td data-label="Channel">{CHANNEL_LABEL[row.channel] ?? row.channel}</td>
                    {/* The document's number, not the word "document" — every
                        row's link used to read identically. */}
                    <td data-label="Document">
                      {row.subjectRef.startsWith("doc:") ? (
                        <Link
                          className="doc-link"
                          href={`/org/${slug}/money/documents/${row.subjectRef.slice(4)}`}
                        >
                          {row.subjectNumber ?? "This document"}
                        </Link>
                      ) : (
                        <span className="digest">{row.subjectRef}</span>
                      )}
                    </td>
                    {/* The team the receipt is addressed to, named. The raw ref
                        stays as the title so the id is recoverable for support.
                        `owner:<id>` names a TEAM, not a person — resolving it
                        against `people` matched nothing on every real dispatch. */}
                    <td data-label="Recipient">
                      {row.recipientName === null ? (
                        <span className="digest" title={row.recipientRef}>
                          {row.recipientRef}
                        </span>
                      ) : (
                        <span title={row.recipientRef}>{row.recipientName}</span>
                      )}
                    </td>
                    <td data-label="Attempts">
                      {row.job === null ? (
                        <span className="section-note">—</span>
                      ) : (
                        <span>
                          {row.job.attempts}/{row.job.maxAttempts}
                          {row.job.lastError === null ? null : (
                            <span className="section-note"> · {row.job.lastError}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td data-label="" className="num">
                      <div className="money-row-actions">
                        {/* A failed dispatch is terminal: the platform's retry
                            CLONES it into a new one. The label says so. */}
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
                            data-testid={`retry-${row.dispatchId}`}
                          >
                            Retry
                          </Button>
                        ) : null}
                        {viewer.canDispatch && row.status === "requested" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              setDialog({ kind: "cancel", row });
                              setNote("");
                            }}
                            data-testid={`cancel-${row.dispatchId}`}
                          >
                            Cancel
                          </Button>
                        ) : null}
                        {viewer.canDispatch && row.status === "sent" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              setDialog({ kind: "confirm", row });
                              setNote("");
                            }}
                            data-testid={`confirm-${row.dispatchId}`}
                          >
                            Confirm by hand
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

      <Dialog
        open={dialog !== null}
        onClose={() => {
          setDialog(null);
        }}
        title={dialog?.kind === "cancel" ? "Cancel this delivery" : "Confirm this delivery by hand"}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDialog(null);
              }}
            >
              Back
            </Button>
            <Button
              variant={dialog?.kind === "cancel" ? "danger" : "primary"}
              disabled={busy || note.trim() === ""}
              onClick={() => {
                const current = dialog;
                if (current === null) {
                  return;
                }
                void act(
                  () =>
                    current.kind === "cancel"
                      ? cancelDeliveryAction(slug, current.row.dispatchId, note)
                      : confirmDeliveryAction(slug, current.row.dispatchId, note),
                  current.kind === "cancel" ? "Delivery cancelled." : "Delivery confirmed by hand.",
                ).then((ok) => {
                  if (ok) {
                    setDialog(null);
                  }
                });
              }}
              data-testid="dialog-submit"
            >
              {dialog?.kind === "cancel" ? "Cancel delivery" : "Confirm delivery"}
            </Button>
          </>
        }
      >
        <p className="section-note">
          {dialog?.kind === "cancel"
            ? "Cancelling stops a delivery that has not gone out. It is recorded against your name with the reason you give."
            : "Some channels never tell us they arrived. Confirming by hand records YOUR word that it did — as a human note, never as provider truth."}
        </p>
        <Field
          label={dialog?.kind === "cancel" ? "Why?" : "What did you see?"}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          required
          data-testid="dialog-note"
        />
      </Dialog>
    </div>
  );
}
