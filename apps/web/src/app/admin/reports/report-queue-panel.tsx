"use client";

import { Badge, Button, Card, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { triageReportAction } from "../../../server/admin/report-actions";
import type { ReportQueue, ReportQueueRow } from "../../../server/admin/report-views";

/**
 * TRIAGE, WITH THE REPORT IN FRONT OF YOU (FR-1 Phase 1).
 *
 * Everything in a row except the operator's buttons was typed by a stranger:
 * it renders as text nodes only, and the page link is shown as text rather than
 * made clickable, because it came from a browser we do not control.
 *
 * The screenshot is not fetched until somebody asks for it. Each view is an
 * access-log row, and a queue of fifty reports should not quietly be fifty
 * reads of people's screens.
 */

const CATEGORY_WORDS: Record<string, string> = {
  bug: "broken",
  confusing: "confusing",
  idea: "idea",
  other: "other",
};

const STATUS_WORDS: Record<string, string> = {
  new: "new",
  triaged: "looking into it",
  fixed: "fixed",
  wont_fix: "won't fix",
  duplicate: "duplicate",
};

const MOVES: readonly { value: string; label: string }[] = [
  { value: "triaged", label: "Looking into it" },
  { value: "fixed", label: "Fixed" },
  { value: "wont_fix", label: "Won't fix" },
  { value: "duplicate", label: "Duplicate" },
];

function when(date: Date): string {
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function ReportQueuePanel({ queue }: { queue: ReportQueue }) {
  return (
    <>
      {queue.open.length > 0 ? (
        <Card data-testid="report-queue-open">
          <h2>Open</h2>
          <ul className="report-queue">
            {queue.open.map((row) => (
              <ReportRow key={row.id} row={row} />
            ))}
          </ul>
        </Card>
      ) : null}
      {queue.closed.length > 0 ? (
        <Card data-testid="report-queue-closed">
          <h2>Closed</h2>
          <ul className="report-queue">
            {queue.closed.map((row) => (
              <ReportRow key={row.id} row={row} />
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function ReportRow({ row }: { row: ReportQueueRow }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showShot, setShowShot] = useState(false);

  const move = (status: string) => {
    start(async () => {
      const result = await triageReportAction(row.id, status);
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: result.summary, tone: "success" });
      router.refresh();
    });
  };

  const who = row.signedIn ? (row.reporterName ?? "Signed-in person, no name") : "Guest";

  return (
    <li className="report-row" id={row.id} data-testid={`problem-report-${row.id}`}>
      <div className="report-row-head">
        <div className="report-row-who">
          <p className="report-row-title">{who}</p>
          <p className="competitions-hint">
            {when(row.createdAt)}
            {row.replyEmail === null ? (
              " · no reply address"
            ) : (
              <>
                {" · "}
                <a href={`mailto:${row.replyEmail}`}>{row.replyEmail}</a>
              </>
            )}
          </p>
        </div>
        <div className="report-row-tags">
          <Badge tone={row.category === "bug" ? "danger" : "neutral"}>
            {CATEGORY_WORDS[row.category] ?? row.category}
          </Badge>
          <Badge tone={row.status === "new" ? "warning" : "neutral"}>
            {STATUS_WORDS[row.status] ?? row.status}
          </Badge>
        </div>
      </div>

      <p className="report-row-page">{row.pageUrl}</p>
      <p className="report-row-description">{row.description}</p>

      {Object.keys(row.context).length > 0 ? (
        <dl className="report-row-context">
          {Object.entries(row.context).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {row.hasScreenshot ? (
        showShot ? (
          <a
            href={`/admin/reports/${row.id}/screenshot`}
            target="_blank"
            rel="noreferrer"
            className="report-row-shot"
          >
            <img
              src={`/admin/reports/${row.id}/screenshot`}
              alt={`Screenshot sent with the report from ${who}`}
            />
          </a>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowShot(true);
            }}
          >
            Show screenshot
          </Button>
        )
      ) : (
        <p className="competitions-hint">No screenshot.</p>
      )}

      <div className="report-row-actions">
        {MOVES.filter((next) => next.value !== row.status).map((next) => (
          <Button
            key={next.value}
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => {
              move(next.value);
            }}
          >
            {next.label}
          </Button>
        ))}
      </div>
    </li>
  );
}
