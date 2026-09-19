"use client";

import {
  Button,
  Field,
  IconCheckCircle,
  IconWallet,
  Pill,
  SectionCard,
  useToast,
} from "@desiauction/ui";
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
        <SectionCard
          icon={<IconWallet />}
          tone="amber"
          title="Open requests"
          description={`${String(queue.open.length)} waiting for an answer`}
          flush
          data-testid="pass-queue-open"
        >
          <ul className="admin-rows is-stacked">
            {queue.open.map((request) => (
              <PassRow key={request.id} request={request} />
            ))}
          </ul>
        </SectionCard>
      ) : null}
      {queue.recent.length > 0 ? (
        <SectionCard
          icon={<IconCheckCircle />}
          tone="green"
          title="Recently granted"
          flush
          data-testid="pass-queue-recent"
        >
          <ul className="admin-rows">
            {queue.recent.map((row) => (
              <li key={`${row.slug}-${row.resolvedAt}`}>
                <span className="admin-cell-main">
                  <span className="admin-name">{row.seasonName}</span>
                  <span className="admin-meta">
                    {row.resolvedAt.slice(0, 10)}
                    {row.resolvedByName === null ? "" : ` · by ${row.resolvedByName}`}
                  </span>
                </span>
                <Pill tone="green">
                  {row.fromTier} → {row.requestedTier}
                </Pill>
              </li>
            ))}
          </ul>
        </SectionCard>
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
        <Pill tone="blue">
          {request.fromTierName} → {request.requestedTierName}
        </Pill>
      </div>
      <p className="pass-row-sub">
        {request.orgName} · asked {request.requestedAt.slice(0, 10)} by{" "}
        {/* Falls back to a phone number: masked in a Report-a-problem shot. */}
        <span {...(request.requestedByName === null ? { "data-private": "" } : {})}>
          {request.requestedByName ?? request.requestedByPhone ?? "unknown"}
        </span>
      </p>
      {/* The deciding facts, not just the ask. */}
      <p className="pass-row-usage" data-testid={`pass-usage-${request.slug}`}>
        {request.teams} team{request.teams === 1 ? "" : "s"} · {request.players} approved player
        {request.players === 1 ? "" : "s"} today
      </p>
      {request.note !== null && request.note !== "" ? (
        <blockquote className="pass-row-note">{request.note}</blockquote>
      ) : null}
      <div className="pass-row-field">
        <Field
          label="Note (optional)"
          name={`note-${request.slug}`}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          help="Recorded on the audit row with your name."
        />
      </div>
      <div className="pass-row-actions is-pair">
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
