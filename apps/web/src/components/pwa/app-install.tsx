"use client";

import { useEffect } from "react";

import { registerServiceWorker, watchInstallability } from "../../lib/pwa";
import { reportClientError } from "../../lib/report-client-error";

/**
 * THE INSTALLED APP'S TWO BROWSER HOOKS, MOUNTED ONCE IN THE ROOT LAYOUT.
 * Renders nothing.
 *
 * `register` is true in production builds only (the layout reads it from
 * env.ts). In `next dev` a worker would sit between a developer and every page
 * they edit; the push switch can still register one there, deliberately, and
 * sw.js stores nothing a dev server sends. It is registered after the page's
 * `load` event, so the first visit's own downloads never compete with the
 * worker's install.
 */
export function AppInstall({ register }: { register: boolean }): null {
  useEffect(() => watchInstallability(), []);

  useEffect(() => {
    if (!register || !("serviceWorker" in navigator)) {
      return;
    }
    const start = () => {
      registerServiceWorker().catch((error: unknown) => {
        // The site works without a worker, so this is never shown to the
        // person. Private browsing and locked-down profiles refuse workers
        // with a SecurityError, which is the browser's choice and not news;
        // anything else (a 404, a script that fails to parse) is a broken
        // deploy of sw.js and is reported.
        if (!(error instanceof DOMException && error.name === "SecurityError")) {
          reportClientError(error, "promise");
        }
      });
    };
    if (document.readyState === "complete") {
      start();
      return;
    }
    window.addEventListener("load", start, { once: true });
    return () => {
      window.removeEventListener("load", start);
    };
  }, [register]);

  return null;
}
