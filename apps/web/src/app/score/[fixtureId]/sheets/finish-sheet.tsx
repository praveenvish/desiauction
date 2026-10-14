import { Button, ButtonLink, Dialog } from "@desiauction/ui";
import { useState } from "react";
import type { DerivedResult, NameBook } from "@desiauction/core/scoring";
export function FinishSheet({
  result,
  names,
  finished,
  pending,
  sharePath,
  nextMatch,
  onFinish,
  onBack,
}: {
  result: DerivedResult;
  names: NameBook;
  finished: boolean;
  pending: number;
  sharePath: string;
  nextMatch: string | null;
  onFinish: () => void;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const title = result.winnerTeamId
    ? `${names.teams[result.winnerTeamId]?.name ?? "Team"} won ${result.marginText}`
    : result.outcome === "tie"
      ? "Match tied"
      : "No result";
  return (
    <Dialog
      open
      onClose={onBack}
      title={finished ? "Result saved" : "Target reached"}
      footer={
        <>
          <Button variant="ghost" onClick={onBack}>
            {finished ? "Back to match" : "Not over · back"}
          </Button>
          {finished ? (
            <Button
              disabled={pending > 0}
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
        {finished && pending > 0 && <p role="status">Saved on this phone · waiting to sync</p>}
        {nextMatch && (
          <ButtonLink data-testid="finish-next-match" href={nextMatch} variant="ghost">
            Next match
          </ButtonLink>
        )}
      </div>
    </Dialog>
  );
}
