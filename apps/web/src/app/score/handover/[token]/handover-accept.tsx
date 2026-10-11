"use client";
import { useState } from "react";
import { Button } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { scoringDevice } from "../../[fixtureId]/queue";
export function HandoverAccept({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/score/handover/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, deviceId: await scoringDevice() }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        fixtureId?: string;
        message?: string;
      };
      if (!response.ok || !result.ok || !result.fixtureId)
        throw new Error(result.message ?? "This handover link could not be accepted.");
      router.replace(`/score/${result.fixtureId}`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Connect to the internet and try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="score-home">
      <h1>Take over scoring</h1>
      <p>
        Sign in with an account authorised to score this match. The current scorer’s link expires
        after ten minutes and can be used once.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button data-testid="handover-accept" disabled={busy} onClick={() => void accept()}>
        {busy ? "Taking over…" : "Take over scoring"}
      </Button>
    </main>
  );
}
