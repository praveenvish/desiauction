"use client";

import { Button } from "@desiauction/ui";
import { useState } from "react";

import { promptInstall, useInstallOffer } from "../../lib/pwa";
import { track } from "../../lib/telemetry";

/**
 * "INSTALL THE APP" — Account › Notifications.
 *
 * It sits beside the push switch because on an iPhone the two are one
 * question: Safari shows notifications only for a site added to the Home
 * Screen. Absent when there is nothing to offer: already installed, or a
 * browser that cannot install.
 *
 * The icon is the real home-screen icon, so the row shows what will appear on
 * the phone. On an iPhone there is no button to press (Apple offers no
 * install dialog), so the row is the two taps, drawn with the same symbols
 * the person will be looking for on their screen.
 */
export function InstallAppPanel() {
  const offer = useInstallOffer();
  const [busy, setBusy] = useState(false);

  if (offer === "none") {
    return null;
  }
  return (
    <div className="acct-install" data-testid="install-app" data-offer={offer}>
      {/* Decorative: the label beside it already names the app. */}
      <img className="acct-install-icon" src="/brand/icon-192.png" alt="" width={48} height={48} />
      <div className="acct-install-body">
        <span className="acct-always-label">Install the app</span>
        <span className="acct-always-detail">{benefit(offer)}</span>
        {offer === "ios" ? (
          <ol className="acct-install-steps" aria-label="How to install on iPhone">
            <li>
              <span className="acct-install-step" aria-hidden>
                1
              </span>
              <span>
                Tap <ShareGlyph /> <strong>Share</strong>
              </span>
            </li>
            <li>
              <span className="acct-install-step" aria-hidden>
                2
              </span>
              <span>
                Choose <AddGlyph /> <strong>Add to Home Screen</strong>
              </span>
            </li>
          </ol>
        ) : null}
      </div>
      {offer === "prompt" ? (
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          className="acct-install-action"
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

/**
 * What installing gives, in this device's words. A laptop has no home screen:
 * Chrome installs to the Dock or Start menu and opens in a window of its own.
 * Read only once an offer exists, which is only ever after hydration, so the
 * server and the first client render cannot disagree about it.
 */
function benefit(offer: "prompt" | "ios"): string {
  if (offer === "ios") {
    return "Opens from your Home Screen, full screen, and can show notifications.";
  }
  return window.matchMedia("(pointer: coarse)").matches
    ? "Opens from your home screen, full screen and faster."
    : "Opens in its own window, from your Dock or Start menu.";
}

/** iOS's Share symbol: a tray with an arrow out of it. */
function ShareGlyph() {
  return (
    <svg
      className="acct-install-glyph"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
    </svg>
  );
}

/** iOS's Add to Home Screen symbol: a plus in a rounded square. */
function AddGlyph() {
  return (
    <svg
      className="acct-install-glyph"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}
