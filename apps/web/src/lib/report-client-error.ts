"use client";

import {
  MAX_REPORTS_PER_PAGE,
  describeClientError,
  type ClientErrorSource,
} from "./client-error-report";

let sent = 0;
const seen = new Set<string>();

/**
 * Tell the server a failure happened in this browser. NEVER throws and never
 * waits: reporting a failure must not be a second one, and the page that is
 * reporting may be on its way out.
 */
export function reportClientError(thrown: unknown, source: ClientErrorSource): void {
  try {
    if (typeof window === "undefined" || sent >= MAX_REPORTS_PER_PAGE) {
      return;
    }
    const report = describeClientError(thrown, source, window.location.pathname);
    // A render loop throws the same error every frame. Once is the report.
    const key = `${report.name}:${report.message}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    sent += 1;
    const body = JSON.stringify(report);
    // A Blob, so the content type is one a beacon may send without a preflight.
    const beacon =
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon("/api/client-error", new Blob([body], { type: "text/plain" }));
    if (!beacon) {
      void fetch("/api/client-error", {
        method: "POST",
        body,
        headers: { "content-type": "text/plain" },
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Nothing to do, and nowhere better to say so.
  }
}
