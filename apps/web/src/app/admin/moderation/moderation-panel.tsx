"use client";

import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  IconExternal,
  useToast,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  liftSeasonHoldAction,
  takeDownSeason,
  type ModerationResult,
} from "../../../server/admin/moderation-actions";
import type {
  HeldSeasonRow,
  ModerationDesk,
  PublicSeasonRow,
} from "../../../server/admin/moderation-views";

const REASON_MIN = 10;
const REASON_MAX = 500;

/**
 * Taking a page down, and giving it back.
 *
 * Each public season links to the page itself, so the desk judges what a
 * stranger actually sees. Taking one down sits behind a dialog that says
 * exactly what disappears and what does not, and will not submit without a
 * reason the organizer is going to read.
 */
export function ModerationPanel({ desk }: { desk: ModerationDesk }) {
  return (
    <>
      <Card data-testid="moderation-held">
        <h2>Taken down</h2>
        {desk.held.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="Nothing is taken down"
            description="Every season DesiAuction takes off the public web is listed here, with who did it and why."
          />
        ) : (
          <ul className="pass-queue">
            {desk.held.map((row) => (
              <HeldRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </Card>
      <Card data-testid="moderation-public">
        <h2>
          On the public web{" "}
          <span className="admin-count">
            {desk.query === ""
              ? `· ${String(desk.publishedTotal)}`
              : `· ${String(desk.publishedTotal)} matching`}
          </span>
        </h2>
        {desk.published.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title={desk.query === "" ? "No season is public" : "No public season matches"}
            description={
              desk.query === ""
                ? "When an organizer publishes a season, it appears here."
                : "Try the club's name, or part of the season's."
            }
          />
        ) : (
          <>
            <ul className="pass-queue">
              {desk.published.map((row) => (
                <PublicRow key={row.id} row={row} />
              ))}
            </ul>
            {desk.publishedTotal > desk.published.length ? (
              <p className="competitions-hint">
                Showing the newest {String(desk.published.length)}. Search to reach the rest.
              </p>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

function useRun() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (act: () => Promise<ModerationResult>, onDone: () => void) => {
    start(async () => {
      const result = await act();
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: result.message, tone: "success" });
      onDone();
      router.refresh();
    });
  };
  return { pending, run };
}

function PublicRow({ row }: { row: PublicSeasonRow }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const length = reason.trim().length;
  const valid = length >= REASON_MIN && length <= REASON_MAX;
  return (
    <li className="pass-row" data-testid={`moderation-public-${row.slug}`}>
      <div className="pass-row-head">
        <span className="pass-row-season">{row.name}</span>
        <Badge tone="success">Public</Badge>
      </div>
      <p className="competitions-hint">
        <Link href={`/admin/orgs/${row.orgSlug}`}>{row.orgName}</Link> · {row.sport} · created{" "}
        {row.createdAt.toISOString().slice(0, 10)}
      </p>
      <div className="pass-row-actions">
        <a
          className="admin-meta"
          href={`/c/${row.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`moderation-view-${row.slug}`}
        >
          View the public page
          <IconExternal size={14} className="icon-trail" />
        </a>
        <Button
          variant="danger"
          onClick={() => {
            setReason("");
            setOpen(true);
          }}
          data-testid={`take-down-${row.slug}`}
        >
          Take down…
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={`Take down ${row.name}?`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={!valid}
              onClick={() => {
                run(
                  () => takeDownSeason(row.slug, reason),
                  () => {
                    setOpen(false);
                  },
                );
              }}
              data-testid="take-down-confirm"
            >
              Take the page down
            </Button>
          </>
        }
      >
        <p>
          The public page, its player pages and share cards, and its directory and search listings
          go at once. The organizer cannot publish it again until the hold is lifted. Nothing is
          deleted: the club&rsquo;s season, registrations and auction carry on untouched.
        </p>
        <Field
          label="Reason"
          name={`take-down-reason-${row.id}`}
          value={reason}
          required
          maxLength={REASON_MAX}
          autoComplete="off"
          help={`The organizer reads this on their season. ${String(REASON_MIN)}–${String(REASON_MAX)} characters.`}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </Dialog>
    </li>
  );
}

function HeldRow({ row }: { row: HeldSeasonRow }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="pass-row" data-testid={`moderation-held-${row.slug}`}>
      <div className="pass-row-head">
        <span className="pass-row-season">{row.name}</span>
        <Badge tone="danger">Taken down</Badge>
      </div>
      <p className="competitions-hint">
        <Link href={`/admin/orgs/${row.orgSlug}`}>{row.orgName}</Link> ·{" "}
        {row.heldAt.toISOString().slice(0, 10)}
        {row.heldByName === null ? "" : ` · by ${row.heldByName}`}
      </p>
      <blockquote className="pass-row-note">{row.reason}</blockquote>
      <div className="pass-row-actions">
        <Button
          variant="secondary"
          onClick={() => {
            setNote("");
            setOpen(true);
          }}
          data-testid={`lift-hold-${row.slug}`}
        >
          Lift the hold…
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={`Lift the hold on ${row.name}?`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() => {
                run(
                  () => liftSeasonHoldAction(row.slug, note),
                  () => {
                    setOpen(false);
                  },
                );
              }}
              data-testid="lift-hold-confirm"
            >
              Lift the hold
            </Button>
          </>
        }
      >
        <p>
          The organizer may publish the season again. Lifting does not republish it — it stays off
          the public web until they choose to.
        </p>
        <Field
          label="Note (optional)"
          name={`lift-note-${row.id}`}
          value={note}
          maxLength={REASON_MAX}
          autoComplete="off"
          help="Recorded on the audit log beside the lift."
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </Dialog>
    </li>
  );
}
