"use client";

import { Button } from "@desiauction/ui";
import { useState } from "react";

import { promptInstall, useInstallOffer } from "../../lib/pwa";
import { track } from "../../lib/telemetry";

/**
 * "THE APP ON THIS DEVICE" — Account › Notifications.
 *
 * It sits beside the push switch because on an iPhone the two are one
 * question: Safari shows notifications only for a site added to the Home
 * Screen. Absent when there is nothing to offer: already installed, or a
 * browser that cannot install.
 */
export function InstallAppPanel() {
  const offer = useInstallOffer();
  const [busy, setBusy] = useState(false);

  if (offer === "none") {
    return null;
  }
  return (
    <div className="acct-always" data-testid="install-app">
      <span className="acct-always-text">
        <span className="acct-always-label">Install the app</span>
        <span className="acct-always-detail">
          {offer === "ios"
            ? "Tap Share, then Add to Home Screen. DesiAuction opens from your Home Screen like any app, full screen, and can show notifications."
            : "DesiAuction on your home screen: opens full screen, starts faster, and takes almost no space."}
        </span>
      </span>
      {offer === "prompt" ? (
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          data-testid="install-app-button"
          onClick={() => {
            setBusy(true);
            void promptInstall()
              .then((outcome) => {
                track("app.install_prompted", { outcome, from: "account" });
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          Install
        </Button>
      ) : null}
    </div>
  );
}
