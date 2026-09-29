"use client";

import { useEffect, useState } from "react";

import { lostRequest, type LostRequest } from "../lib/lost-request";

/**
 * WHEN SOMETHING THE PERSON ASKED FOR NEVER CAME BACK, SAY SO.
 *
 * A server action that is lost — the network dropped, the server restarted,
 * the page is older than the deploy — REJECTS, and almost nothing in the
 * console catches that: the button stopped spinning (lib/release) and nothing
 * else happened. No message, no hint that the change did not land, and no
 * suggestion of the one thing that fixes a stale page, which is loading it
 * again.
 *
 * One notice for the whole product, because the failure is the same wherever
 * it happens. It names no action ("your bid", "your save") because it cannot
 * know which; it says what is known and what to do.
 *
 * Self-contained on purpose — literal colours, inline styles, native buttons —
 * because it is mounted above every page's own providers and must not depend
 * on any of them having arrived.
 */
const COPY: Record<Exclude<LostRequest, null>, string> = {
  network: "That didn't go through — the connection dropped. Check that it's back, then try again.",
  "stale-page": "This page is out of date. Reload it, then try again.",
};

export function ActionFailureNotice() {
  const [kind, setKind] = useState<LostRequest>(null);

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const lost = lostRequest(event.reason);
      if (lost !== null) {
        // A stale page outranks a dropped connection: it is the one a retry
        // cannot fix.
        setKind((current) => (current === "stale-page" ? current : lost));
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (kind === null) {
    return null;
  }
  const button = {
    font: "inherit",
    fontWeight: 600,
    minHeight: 44,
    padding: "0 14px",
    borderRadius: 8,
    cursor: "pointer",
  } as const;
  return (
    <div
      role="alert"
      data-testid="action-failure-notice"
      data-kind={kind}
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        zIndex: 2147483000,
        width: "min(560px, calc(100vw - 32px))",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 12,
        background: "#1c1b17",
        color: "#faf8f2",
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.35)",
        fontSize: 15,
        lineHeight: 1.4,
      }}
    >
      <span style={{ flex: "1 1 240px" }}>{COPY[kind]}</span>
      <span style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          style={{
            ...button,
            border: "1px solid #f0b43c",
            background: "#f0b43c",
            color: "#1c1b17",
          }}
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => {
            setKind(null);
          }}
          style={{
            ...button,
            border: "1px solid rgba(250, 248, 242, 0.45)",
            background: "transparent",
            color: "#faf8f2",
          }}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
