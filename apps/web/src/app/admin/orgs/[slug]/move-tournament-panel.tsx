"use client";

import { Button, Dialog, Field, Select, SectionCard, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useStepUp, type GatedResult } from "../../../../components/admin/use-step-up";
import { moveTournamentAction } from "../../../../server/platform-ops/club-actions";
import type { MoveDesk, MoveSubject } from "../../../../server/platform-ops/move-tournament";

/*
 * MOVE TO ANOTHER CLUB — the superadmin's control for a tournament that was
 * started in the wrong club. A tournament moves with every season under it;
 * one season can also move alone (0109), leaving its tournament and the other
 * editions behind. The database refuses while an auction is
 * running or when the seasons hold money records, and the row says so before
 * anyone presses anything.
 */
export function MoveTournamentPanel({
  slug,
  clubName,
  desk,
}: {
  slug: string;
  clubName: string;
  desk: MoveDesk;
}) {
  const router = useRouter();
  const toast = useToast();
  const { run, dialog: stepUpDialog } = useStepUp();
  const [subject, setSubject] = useState<MoveSubject | null>(null);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, start] = useTransition();

  const open = (next: MoveSubject) => {
    setTarget("");
    setReason("");
    setSubject(next);
  };

  const targetName = desk.clubs.find((club) => club.slug === target)?.name ?? "";

  const submit = () => {
    if (subject === null) {
      return;
    }
    start(async () => {
      let movedTo: string | undefined;
      let message = "";
      let result: GatedResult;
      try {
        result = await run(async (): Promise<GatedResult> => {
          const outcome = await moveTournamentAction({
            slug,
            subjectKind: subject.kind,
            subjectId: subject.id,
            targetSlug: target,
            reason,
          });
          if (outcome.ok) {
            movedTo = outcome.targetSlug;
            message = outcome.message;
            return { ok: true };
          }
          return outcome;
        });
      } catch {
        toast({
          title: "We couldn't reach DesiAuction. Reload the page to see what changed.",
          tone: "danger",
        });
        return;
      }
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      setSubject(null);
      toast({ title: message, tone: "success" });
      if (movedTo !== undefined) {
        router.push(`/admin/orgs/${movedTo}`);
      } else {
        router.refresh();
      }
    });
  };

  const ready = target !== "" && reason.trim().length >= 10;

  return (
    <SectionCard
      title="Move to another club"
      tone="amber"
      description="Move a tournament — with every season, team, player and auction under it — into a different club. Links and public pages keep working."
      data-testid="move-desk"
    >
      {desk.subjects.length === 0 ? (
        <p className="admin-meta">{clubName} has no tournaments yet.</p>
      ) : (
        <ul className="admin-role-holders">
          {desk.subjects.map((row) => (
            <li key={`${row.kind}-${row.id}`} data-testid="move-subject">
              <strong>{row.name}</strong>
              {row.kind === "tournament" ? (
                <span className="admin-meta">
                  {" "}
                  · {row.seasons.length === 0 ? "no seasons yet" : row.seasons.join(", ")}
                </span>
              ) : row.partOf === null ? (
                <span className="admin-meta"> · one-off season</span>
              ) : (
                <span className="admin-meta"> · season of {row.partOf}</span>
              )}{" "}
              {row.blocked === null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    open(row);
                  }}
                  data-testid="move-open"
                >
                  Move…
                </Button>
              ) : (
                <span className="admin-meta">— can&apos;t move: {row.blocked}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={subject !== null}
        onClose={() => {
          setSubject(null);
        }}
        title={subject === null ? "" : `Move ${subject.name}`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSubject(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={!ready} data-testid="move-confirm">
              {targetName === "" ? "Move" : `Move to ${targetName}`}
            </Button>
          </>
        }
      >
        {subject === null ? null : (
          <>
            <p>
              {subject.kind === "tournament"
                ? subject.seasons.length > 0
                  ? `Every season moves with it: ${subject.seasons.join(", ")}.`
                  : "It has no seasons yet."
                : subject.partOf === null
                  ? "This season moves on its own."
                  : `Only this season moves. ${subject.partOf} and its other seasons stay in ${clubName}; in the new club this season joins its ${subject.partOf}, which is created there if it doesn't exist.`}{" "}
              Team owners and auctioneers become members of the new club so they keep access.
              Franchise and ground links from {clubName} are cleared, since those stay behind.
            </p>
            <Select
              label="Move to club"
              name="target"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
              }}
              data-testid="move-target"
            >
              <option value="">Choose…</option>
              {desk.clubs.map((club) => (
                <option key={club.slug} value={club.slug}>
                  {club.name} ({club.slug})
                </option>
              ))}
            </Select>
          </>
        )}
        <Field
          label="Reason"
          name="reason"
          maxLength={500}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          help="Written to both clubs' history. 10–500 characters."
          data-testid="move-reason"
        />
      </Dialog>
      {stepUpDialog}
    </SectionCard>
  );
}
