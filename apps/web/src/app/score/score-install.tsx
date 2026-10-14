"use client";
import { Button } from "@desiauction/ui";
import { useState } from "react";
import { promptInstall, useInstallOffer } from "../../lib/pwa";
export function ScoreInstall() {
  const offer = useInstallOffer();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (offer === "none") return null;
  return (
    <section className="score-install" aria-labelledby="score-install-title">
      <h2 id="score-install-title">Keep scoring close</h2>
      <p>Install the app to open it from your home screen.</p>
      {offer === "ios" ? (
        <p>Tap Share, then Add to Home Screen.</p>
      ) : (
        <Button
          loading={busy}
          onClick={() => {
            setFailed(false);
            setBusy(true);
            void promptInstall()
              .catch(() => {
                setFailed(true);
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          Install the app
        </Button>
      )}
      {failed ? <p role="status">Installation could not open. Try again.</p> : null}
    </section>
  );
}
