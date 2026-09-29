"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
 * IT GOES AWAY BY ITSELF when it has stopped being true. A dropped connection
 * is about one moment: the notice leaves after a while, and when the person
 * moves to another screen — otherwise it would still be saying "that didn't go
 * through" over the retry that did. A stale page stays stale on every screen
 * until it is reloaded, so that one waits to be answered.
 *
 * AT THE TOP, not the bottom: the bottom of a phone is where the live room
 * keeps its bid buttons, and a notice about one lost request must never sit
 * on top of the next bid.
 *
 * Self-contained on purpose — literal colours, inline styles, native buttons —
 * because it is mounted above every page's own providers and must not depend
 * on any of them having arrived.
 */
const COPY: Record<Exclude<LostRequest, null>, string> = {
  network: "That didn't go through — the connection dropped. Check that it's back, then try again.",
  "stale-page": "This page is out of date. Reload it, then try again.",
};

/** How long a dropped-connection notice stays before it leaves by itself. */
const NETWORK_NOTICE_MS = 15_000;

export function ActionFailureNotice() {
  const [kind, setKind] = useState<LostRequest>(null);
  // The screen the request was lost ON, so that the notice can stay behind
  // when the person moves to another one.
  const [lostOn, setLostOn] = useState<string | null>(null);
  const pathname = usePathname();
  // A page that is being LEFT aborts whatever it had in flight, and Safari
  // words an aborted request exactly like a lost one. Nothing said while the
  // page is on its way out would be true, or seen.
  const leaving = useRef(false);

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (leaving.current) {
        return;
      }
      const lost = lostRequest(event.reason);
      if (lost !== null) {
        // A stale page outranks a dropped connection: it is the one a retry
        // cannot fix.
        setKind((current) => (current === "stale-page" ? current : lost));
        setLostOn(window.location.pathname);
      }
    };
    const onLeave = () => {
      leaving.current = true;
    };
    const onReturn = () => {
      // Restored from the back/forward cache: the same page, alive again.
      leaving.current = false;
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("pageshow", onReturn);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("pageshow", onReturn);
    };
  }, []);

  useEffect(() => {
    if (kind !== "network") {
      return;
    }
    const timer = window.setTimeout(() => {
      setKind((current) => (current === "network" ? null : current));
    }, NETWORK_NOTICE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [kind]);

  // Another screen: a dropped request on the last one is not news here.
  if (kind === null || (kind === "network" && lostOn !== pathname)) {
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
        top: "calc(12px + env(safe-area-inset-top, 0px))",
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
