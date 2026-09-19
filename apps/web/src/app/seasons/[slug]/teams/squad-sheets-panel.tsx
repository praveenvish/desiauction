"use client";

import { Button, Card, Dialog, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  sendSquadSheetsAction,
  type SquadSheetsPanelView,
} from "../../../../server/competition/appointment-actions";

function people(count: number): string {
  return count === 1 ? "1 player" : `${String(count)} players`;
}

/**
 * "MEET YOUR SQUAD" — the whole team, to everyone on it, when the organizer
 * says the squads are set. Only the players who have not had the sheet for
 * their current team are sent it, so pressing again after a late change tells
 * the newcomers and nobody twice.
 */
export function SquadSheetsPanel({ slug, view }: { slug: string; view: SquadSheetsPanelView }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const result = await sendSquadSheetsAction(slug);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast({ title: result.error, tone: "danger" });
      return;
    }
    toast({
      title:
        result.sent === 0
          ? "Everyone has their squad sheet already."
          : `Squad sheets sent to ${people(result.sent)}.`,
      tone: "success",
    });
    router.refresh();
  };

  const hint =
    view.blocked ??
    (view.pending === 0
      ? view.sent > 0
        ? `Every squad member has their sheet (${people(view.sent)}). Anyone who joins a team later can be sent theirs here.`
        : "Once players are on teams, send each of them their squad: who they play with, the captain, the coach and their first match."
      : `${people(view.pending)} on ${view.teams === 1 ? "1 team" : `${String(view.teams)} teams`} ${view.pending === 1 ? "hasn't" : "haven't"} had their squad sheet yet. Each gets the full squad, the captain and coach, and their first match — by email and in their inbox.${view.sent > 0 ? ` ${people(view.sent)} already sent.` : ""}`);

  return (
    <Card data-testid="squad-sheets-panel">
      <h2>Send squad sheets</h2>
      <p className="competitions-hint" data-testid="squad-sheets-hint">
        {hint}
      </p>
      {view.blocked === null && view.pending > 0 ? (
        <div className="squad-sheets-actions">
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(true);
            }}
            data-testid="squad-sheets-send"
          >
            Send to {people(view.pending)}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Send squad sheets?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Not yet
            </Button>
            <Button onClick={() => void send()} loading={busy} data-testid="squad-sheets-confirm">
              Send
            </Button>
          </>
        }
      >
        <p className="competitions-hint">
          {view.pending === 1 ? "This player" : `These ${String(view.pending)} players`} will get
          their team&apos;s squad now. Send once the squads are final — a sheet can&apos;t be taken
          back, though anyone moved to another team later gets the new one.
        </p>
      </Dialog>
    </Card>
  );
}
