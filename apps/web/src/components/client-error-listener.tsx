"use client";

import { useEffect } from "react";

import { reportClientError } from "../lib/report-client-error";

/**
 * The failures no error boundary sees: an exception in an event handler, and a
 * promise nobody caught. Neither crashes the page — the button simply does
 * nothing — which is exactly why nobody ever reported them.
 *
 * Renders nothing, listens passively, and removes itself on unmount.
 */
export function ClientErrorListener(): null {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      // A failed <img> or <script> load also fires "error" on window when
      // captured; those have no `error` and are not what this is for.
      if (event.error !== undefined && event.error !== null) {
        reportClientError(event.error, "window");
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportClientError(event.reason, "promise");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
