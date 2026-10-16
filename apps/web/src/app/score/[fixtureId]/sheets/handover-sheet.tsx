import { useState } from "react";
import { Button, ButtonLink, Dialog } from "@desiauction/ui";
import { scoringDevice } from "../queue";
export function HandoverSheet({
  fixtureId,
  pending,
  onClose,
}: {
  fixtureId: string;
  pending: number;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null),
    [qr, setQr] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/score/${fixtureId}/handover-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: await scoringDevice() }),
      });
      const result = (await response.json()) as { ok?: boolean; token?: string; message?: string };
      if (!response.ok || !result.ok || !result.token)
        throw new Error(result.message ?? "The handover link could not be created.");
      const link = new URL(`/score/handover/${result.token}`, location.origin).href;
      const { toDataURL } = await import("qrcode");
      setQr(await toDataURL(link, { width: 240, margin: 2 }));
      setUrl(link);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Connect to the internet and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Hand over scoring"
      footer={
        <Button disabled={busy || pending > 0} onClick={() => void issue()}>
          {busy ? "Creating link…" : "Create handover link"}
        </Button>
      }
    >
      <div data-testid="handover-sheet">
        <p>
          The next scorer must sign in and have permission to score this match. The link expires in
          ten minutes and works once.
        </p>
        {pending > 0 && <p role="status">Send all saved balls before handing over.</p>}
        {error && <p role="alert">{error}</p>}
        <div data-report-problem-exclude>
          {qr && (
            <img
              data-testid="handover-qr"
              src={qr}
              width={240}
              height={240}
              alt="Scan to take over scoring"
            />
          )}
          {url && (
            <>
              <p>
                <ButtonLink href={url} variant="ghost" size="touch">
                  Open handover link
                </ButtonLink>
              </p>
              <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(url)}>
                Copy link
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
