"use client";

import {
  Button,
  Dialog,
  Field,
  IconCheckCircle,
  IconChevronDown,
  IconTrash,
  Pill,
  SectionCard,
  useToast,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatPhone } from "../../../lib/format-phone";
import { declineErasureAction, eraseAccountAction } from "../../../server/admin/erasure-actions";
import type { DeskRow, ErasureDesk } from "../../../server/privacy/desk";
import { ERASURE_PROMISE_DAYS, erasureDaysLeft } from "./erasure-sla";
import { formatDate } from "../../../lib/format-date";

/**
 * Deciding erasure requests, with what the erasure will do in front of you.
 *
 * Each open request says whether it CAN go ahead, and if not, why — a sole club
 * owner, somebody in a live auction, a platform operator — so the desk never
 * finds out from an error after typing the confirmation. The destructive act
 * sits behind a dialog that names the consequence and a typed word the button
 * will not accept without.
 */
export function ErasureDeskPanel({ desk, nowMs }: { desk: ErasureDesk; nowMs: number }) {
  return (
    <>
      {desk.open.length > 0 ? (
        <SectionCard
          icon={<IconTrash />}
          tone="neutral"
          title="Open requests"
          description={`${String(desk.open.length)} waiting, oldest first · a reply is promised within ${String(ERASURE_PROMISE_DAYS)} days`}
          flush
          data-testid="erasure-open"
        >
          <ul className="admin-rows">
            {desk.open.map((row) => (
              <ErasureRow key={row.id} row={row} nowMs={nowMs} />
            ))}
          </ul>
        </SectionCard>
      ) : null}
      {desk.decided.length > 0 ? (
        // History, folded: a count line, opened on demand. Nineteen rows of
        // "asked · decided · Erased" were near-zero information at full height.
        <details className="admin-fold" data-testid="erasure-decided">
          <summary>
            <span className="admin-fold-icon" aria-hidden>
              <IconCheckCircle size={16} />
            </span>
            <span className="admin-fold-title">
              <strong>Recently decided · {String(desk.decided.length)}</strong>
              <span className="admin-meta">
                {String(desk.decided.filter((row) => row.status === "completed").length)} erased ·{" "}
                {String(desk.decided.filter((row) => row.status === "declined").length)} declined
              </span>
            </span>
            <IconChevronDown size={16} className="admin-fold-caret" />
          </summary>
          <ul className="admin-rows">
            {desk.decided.map((row) => (
              <li key={row.id}>
                <span className="admin-meta">
                  asked {formatDate(row.requestedAt)}
                  {row.decidedAt === null ? "" : ` · decided ${formatDate(row.decidedAt)}`}
                  {row.decisionNote === null ? "" : ` · ${row.decisionNote}`}
                </span>
                <Pill
                  tone={
                    row.status === "completed"
                      ? "green"
                      : row.status === "declined"
                        ? "amber"
                        : "neutral"
                  }
                  dot
                >
                  {row.status === "completed"
                    ? "Erased"
                    : row.status === "declined"
                      ? "Declined"
                      : "Withdrawn by the person"}
                </Pill>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

/** The account page's promise, drawn: how long this request has left. */
function SlaPill({ requestedAt, nowMs }: { requestedAt: Date; nowMs: number }) {
  const left = erasureDaysLeft(requestedAt.getTime(), nowMs);
  if (left < 0) {
    return (
      <Pill tone="red" dot testId="erasure-sla">
        Overdue by {String(-left)} day{left === -1 ? "" : "s"}
      </Pill>
    );
  }
  return (
    <Pill tone={left <= 2 ? "amber" : "neutral"} dot testId="erasure-sla">
      {left === 0 ? "Due today" : `${String(left)} day${left === 1 ? "" : "s"} left`}
    </Pill>
  );
}

function ErasureRow({ row, nowMs }: { row: DeskRow; nowMs: number }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [note, setNote] = useState("");

  const run = (
    act: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>,
  ) => {
    start(async () => {
      const result = await act();
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: result.message, tone: "success" });
      setConfirmOpen(false);
      router.refresh();
    });
  };

  const who = row.name ?? (row.phone !== null ? formatPhone(row.phone) : (row.email ?? "Unnamed"));
  return (
    <li className="pass-row admin-erase-row" data-testid={`erasure-request-${row.personId}`}>
      {/* One request, two lines: who and how long is left, then the decision
          on the same row — not a card with a labelled field and a help
          paragraph under every request. */}
      <div className="admin-erase-who">
        <span className="pass-row-head">
          {/* With no name on file, `who` IS the number or the address. */}
          <span className="pass-row-season" {...(row.name === null ? { "data-private": "" } : {})}>
            {who}
          </span>
          <SlaPill requestedAt={row.requestedAt} nowMs={nowMs} />
          {row.blocked === null ? null : (
            <Pill tone="amber" dot>
              Cannot erase yet
            </Pill>
          )}
        </span>
        <span className="pass-row-sub">
          asked {formatDate(row.requestedAt)}
          {" · "}
          {row.clubs === 0 ? "no clubs" : `${String(row.clubs)} club${row.clubs === 1 ? "" : "s"}`}
          {row.phone !== null ? (
            <>
              {" · "}
              <span data-private>{formatPhone(row.phone)}</span>
            </>
          ) : null}
          {row.email !== null ? (
            <>
              {" · "}
              <span data-private>{row.email}</span>
            </>
          ) : null}
        </span>
        {row.reason !== null ? (
          <blockquote className="pass-row-note">{row.reason}</blockquote>
        ) : null}
        {row.blocked !== null ? (
          <p className="pass-row-sub admin-warning" role="note" data-testid="erasure-blocked">
            {row.blocked}
          </p>
        ) : null}
      </div>
      <div className="admin-erase-decide">
        <label className="admin-sr-only" htmlFor={`note-${row.id}`}>
          Note
        </label>
        <input
          id={`note-${row.id}`}
          name={`note-${row.id}`}
          className="admin-erase-note"
          value={note}
          placeholder="Note — needed to decline"
          aria-describedby={`note-help-${row.id}`}
          autoComplete="off"
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <span id={`note-help-${row.id}`} className="admin-sr-only">
          Required to decline — the person reads it on their account page. Optional when erasing.
        </span>
        {/* Quiet in the row; the danger is said, in red, in the dialog. */}
        <button
          type="button"
          className="admin-quiet-danger"
          disabled={row.blocked !== null}
          onClick={() => {
            setConfirmation("");
            setConfirmOpen(true);
          }}
          data-testid={`erase-${row.personId}`}
        >
          <IconTrash size={16} />
          Erase account…
        </button>
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          onClick={() => {
            run(() => declineErasureAction(row.id, note));
          }}
          data-testid={`decline-erasure-${row.personId}`}
        >
          Decline
        </Button>
      </div>
      <Dialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
        }}
        title={`Erase ${who}?`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={confirmation.trim() !== "ERASE"}
              onClick={() => {
                run(() => eraseAccountAction(row.id, confirmation, note));
              }}
              data-testid="erase-confirm"
            >
              Erase permanently
            </Button>
          </>
        }
      >
        <p>
          This signs them out everywhere and cannot be undone. Their profile, passkeys and photo are
          deleted. Their name, number and email are removed from every club they were in; their
          registrations, bids and receipts stay as anonymous records.
        </p>
        <Field
          label="Type ERASE to confirm"
          name="erase-confirmation"
          value={confirmation}
          autoComplete="off"
          onChange={(event) => {
            setConfirmation(event.target.value);
          }}
        />
      </Dialog>
    </li>
  );
}
