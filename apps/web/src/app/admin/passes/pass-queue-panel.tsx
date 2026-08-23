"use client";

import { Badge, Button, Card, Field, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { answerPassRequest } from "../../../server/admin/pass-actions";
import type { PassQueue } from "../../../server/admin/passes";

/**
 * Answering, with the facts in front of you.
 *
 * Each row carries what the season ACTUALLY holds — teams and pool — beside
 * what was asked for, because "they want Association" is not a decision and
 * "they have six teams on a four-team pass and their auction is on the 14th"
 * is. The organizer's own note sits with it, unabridged.
 */
export function PassQueuePanel({ queue }: { queue: PassQueue }) {
  return (
    <>
      {queue.open.length > 0 ? (
        <Card data-testid="pass-queue-open">
          <h2>Open requests</h2>
          <ul className="pass-queue">
            {queue.open.map((request) => (
              <PassRow key={request.id} request={request} />
            ))}
          </ul>
        </Card>
      ) : null}
      {queue.recent.length > 0 ? (
        <Card data-testid="pass-queue-recent">
          <h2>Recently granted</h2>
          <ul className="pass-recent">
            {queue.recent.map((row) => (
              <li key={`${row.slug}-${row.resolvedAt}`}>
                <span className="pass-recent-season">{row.seasonName}</span>
                <span className="competitions-hint">
                  {row.fromTier} → {row.requestedTier} · {row.resolvedAt.slice(0, 10)}
                  {row.resolvedByName === null ? "" : ` · by ${row.resolvedByName}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function PassRow({ request }: { request: PassQueue["open"][number] }) {
  const toast = useToast();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const answer = (outcome: "granted" | "declined") => {
    start(async () => {
      const result = await answerPassRequest(request.slug, outcome, note);
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: result.summary, tone: "success" });
      router.refresh();
    });
  };

  return (
    <li className="pass-row" data-testid={`pass-request-${request.slug}`}>
      <div className="pass-row-head">
        <span className="pass-row-season">{request.seasonName}</span>
        <Badge tone="info">
          {request.fromTierName} → {request.requestedTierName}
        </Badge>
      </div>
      <p className="competitions-hint">
        {request.orgName} · asked {request.requestedAt.slice(0, 10)} by{" "}
        {request.requestedByName ?? request.requestedByPhone ?? "unknown"}
      </p>
      {/* The deciding facts, not just the ask. */}
      <p className="pass-row-usage" data-testid={`pass-usage-${request.slug}`}>
        {request.teams} team{request.teams === 1 ? "" : "s"} · {request.players} approved player
        {request.players === 1 ? "" : "s"} today
      </p>
      {request.note !== null && request.note !== "" ? (
        <blockquote className="pass-row-note">{request.note}</blockquote>
      ) : null}
      <Field
        label="Note (optional)"
        name={`note-${request.slug}`}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
        help="Recorded on the audit row with your name."
      />
      <div className="pass-row-actions">
        <Button
          onClick={() => {
            answer("granted");
          }}
          loading={pending}
          data-testid={`grant-${request.slug}`}
        >
          Grant {request.requestedTierName}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            answer("declined");
          }}
          loading={pending}
          data-testid={`decline-${request.slug}`}
        >
          Decline
        </Button>
      </div>
    </li>
  );
}
