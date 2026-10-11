"use client";
import { useSyncExternalStore, useState, useEffect, type ReactNode } from "react";
import { onScoringStop } from "./storage-events";
import { Button } from "@desiauction/ui";

export function inAppBrowser(userAgent: string): string | null {
  if (/WhatsApp/i.test(userAgent)) return "WhatsApp";
  if (/Instagram/i.test(userAgent)) return "Instagram";
  if (/FBAN|FBAV/i.test(userAgent)) return "Facebook";
  return null;
}
/** Only authorised scorer pages mount this gate; public viewers never do. */
export function InAppGate({ children }: { children: ReactNode }) {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(
    () =>
      onScoringStop(() => {
        setSignedOut(true);
      }),
    [],
  );
  const browser = useSyncExternalStore(
    () => () => {},
    () => inAppBrowser(navigator.userAgent),
    () => undefined,
  );
  const [copied, setCopied] = useState(false);
  if (signedOut) return <p role="status">Signed out. Sign in again to score.</p>;
  if (browser === undefined) return <p role="status">Checking scoring browser…</p>;
  if (!browser) return children;
  return (
    <main className="score-home" data-testid="in-app-gate">
      <h1>Open in Chrome to score</h1>
      <p>
        You opened this match inside {browser}. Open it in your phone’s browser to keep scoring
        entries saved and work offline.
      </p>
      <p>Use the menu at the top of this window and choose Open in browser.</p>
      <Button
        onClick={() => {
          void navigator.clipboard.writeText(location.href).then(() => {
            setCopied(true);
          });
        }}
      >
        {copied ? "Link copied" : "Copy match link"}
      </Button>
    </main>
  );
}
