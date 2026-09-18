"use client";

import { Badge, Button, Card, Dialog, Field, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatPhone } from "../../../lib/format-phone";
import { declineErasureAction, eraseAccountAction } from "../../../server/admin/erasure-actions";
import type { DeskRow, ErasureDesk } from "../../../server/privacy/desk";

/**
 * Deciding erasure requests, with what the erasure will do in front of you.
 *
 * Each open request says whether it CAN go ahead, and if not, why — a sole club
 * owner, somebody in a live auction, a platform operator — so the desk never
 * finds out from an error after typing the confirmation. The destructive act
 * sits behind a dialog that names the consequence and a typed word the button
 * will not accept without.
 */
export function ErasureDeskPanel({ desk }: { desk: ErasureDesk }) {
  return (
    <>
      {desk.open.length > 0 ? (
        <Card data-testid="erasure-open">
          <h2>Open requests</h2>
          <ul className="pass-queue">
            {desk.open.map((row) => (
              <ErasureRow key={row.id} row={row} />
            ))}
          </ul>
        </Card>
      ) : null}
      {desk.decided.length > 0 ? (
        <Card data-testid="erasure-decided">
          <h2>Recently decided</h2>
          <ul className="pass-recent">
            {desk.decided.map((row) => (
              <li key={row.id}>
                <Badge
                  tone={
                    row.status === "completed"
                      ? "success"
                      : row.status === "declined"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {row.status === "completed"
                    ? "Erased"
                    : row.status === "declined"
                      ? "Declined"
                      : "Withdrawn by the person"}
                </Badge>
                <span className="competitions-hint">
                  asked {row.requestedAt.toISOString().slice(0, 10)}
                  {row.decidedAt === null
                    ? ""
                    : ` · decided ${row.decidedAt.toISOString().slice(0, 10)}`}
                  {row.decisionNote === null ? "" : ` · ${row.decisionNote}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function ErasureRow({ row }: { row: DeskRow }) {
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
    <li className="pass-row" data-testid={`erasure-request-${row.personId}`}>
      <div className="pass-row-head">
        <span className="pass-row-season">{who}</span>
        {row.blocked === null ? (
          <Badge tone="info">
            {row.clubs === 0
              ? "No clubs"
              : `${String(row.clubs)} club${row.clubs === 1 ? "" : "s"}`}
          </Badge>
        ) : (
          <Badge tone="warning">Cannot erase yet</Badge>
        )}
      </div>
      <p className="competitions-hint">
        asked {row.requestedAt.toISOString().slice(0, 10)}
        {row.phone !== null ? ` · ${formatPhone(row.phone)}` : ""}
        {row.email !== null ? ` · ${row.email}` : ""}
      </p>
      {row.reason !== null ? <blockquote className="pass-row-note">{row.reason}</blockquote> : null}
      {row.blocked !== null ? (
        <p className="competitions-hint" role="note" data-testid="erasure-blocked">
          {row.blocked}
        </p>
      ) : null}
      <Field
        label="Note"
        name={`note-${row.id}`}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
        help="Required to decline — the person reads it on their account page. Optional when erasing."
      />
      <div className="pass-row-actions">
        <Button
          variant="danger"
          disabled={row.blocked !== null}
          onClick={() => {
            setConfirmation("");
            setConfirmOpen(true);
          }}
          data-testid={`erase-${row.personId}`}
        >
          Erase account…
        </Button>
        <Button
          variant="secondary"
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
