import { Button, ButtonLink, Dialog } from "@desiauction/ui";
import { useState } from "react";
import type { DerivedResult, NameBook } from "@desiauction/core/scoring";
export function FinishSheet({
  result,
  names,
  finished,
  pending,
  ready,
  error,
  sharePath,
  nextMatch,
  onFinish,
  onBack,
}: {
  result: DerivedResult;
  names: NameBook;
  finished: boolean;
  pending: number;
  ready: boolean;
  error: string | null;
  sharePath: string;
  nextMatch: string | null;
  onFinish: () => void;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const accepted = finished && ready && pending === 0 && !error;
  const title = result.winnerTeamId
    ? `${names.teams[result.winnerTeamId]?.name ?? "Team"} won ${result.marginText}`
    : result.outcome === "tie"
      ? "Match tied"
      : "No result";
  return (
    <Dialog
      open
      onClose={onBack}
      title={accepted ? "Result saved" : finished ? "Finish waiting to sync" : "Target reached"}
      footer={
        <>
          <Button variant="ghost" onClick={onBack}>
            {finished ? "Back to match" : "Not over · back"}
          </Button>
          {finished ? (
            <Button
              disabled={!accepted}
              onClick={() => {
                const url = new URL(sharePath, location.origin).href;
                const sharing = navigator as {
                  share?: (data: ShareData) => Promise<void>;
                  clipboard?: Pick<Clipboard, "writeText">;
                };
                if (sharing.share)
                  void sharing.share({ title, text: title, url }).catch(() => undefined);
                else
                  void sharing.clipboard
                    ?.writeText(url)
                    .then(() => {
                      setCopied(true);
                    })
                    .catch(() => undefined);
              }}
            >
              {copied ? "Link copied" : "Share result"}
            </Button>
          ) : (
            <Button data-testid="finish-confirm" onClick={onFinish}>
              Finish and share
            </Button>
          )}
        </>
      }
    >
      <div data-testid="finish-sheet">
        <p className="finish-result">{title}</p>
        {finished && !accepted && (
          <p role="status">
            {error
              ? "Finish has not been accepted. Return to the match to resolve the issue."
              : "Finish is waiting for server acceptance. Keep this match open to sync."}
          </p>
        )}
        {nextMatch && (
          <ButtonLink data-testid="finish-next-match" href={nextMatch} variant="ghost">
            {accepted ? "Next match" : "Leave this match · open next fixture"}
          </ButtonLink>
        )}
        {nextMatch && !accepted && (
          <p>
            {finished
              ? "The finish is still waiting to sync. Return to this match to check acceptance."
              : "This match has not been finished. You can return here to finish it."}
          </p>
        )}
      </div>
    </Dialog>
  );
}
