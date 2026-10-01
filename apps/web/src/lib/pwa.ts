/**
 * THE INSTALLED APP, FROM THE PAGE'S SIDE (public/sw.js is the other side).
 *
 * Two things live here:
 *
 *   1. Registering the service worker. One function with one URL and one set
 *      of options, used by the root layout and by the push switch on Account.
 *      Two call sites that disagreed about the URL or `updateViaCache` would
 *      replace each other's registration on every visit.
 *   2. Whether to OFFER installing, and how. Android and desktop Chromium fire
 *      `beforeinstallprompt` once per page load and only then, so it is caught
 *      once by the root layout and kept here; a menu item rendered later reads
 *      it from here. iPhone never fires it: the only way in is Share → Add to
 *      Home Screen, so there the offer is the instructions.
 *
 * `installOffer` decides; it is pure so the decision is tested, not trusted.
 */

import { useSyncExternalStore } from "react";

export const SERVICE_WORKER_URL = "/sw.js";

/**
 * `updateViaCache: "none"`: the browser checks for a new worker against the
 * server, never its HTTP cache, so a fix (or the kill switch documented in
 * sw.js) reaches every device on its next visit.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "/",
    updateViaCache: "none",
  });
}

/** Chromium's install event. Not in the DOM typings: it was never standardised. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * What to offer:
 *   - "none"    already installed, or this browser cannot install (Firefox on
 *               a laptop) — offer nothing rather than a button that fails.
 *   - "prompt"  the browser's own install dialog is ready to open.
 *   - "ios"     an iPhone or iPad not yet installed: show the two taps.
 */
export type InstallOffer = "none" | "prompt" | "ios";

export interface InstallFacts {
  /** Running as the installed app (display-mode standalone, or iOS's flag). */
  readonly standalone: boolean;
  readonly ios: boolean;
  /** A captured `beforeinstallprompt` is waiting to be used. */
  readonly promptReady: boolean;
  /** `appinstalled` fired in this page's lifetime. */
  readonly installed: boolean;
}

export function installOffer(facts: InstallFacts): InstallOffer {
  if (facts.standalone || facts.installed) {
    return "none";
  }
  if (facts.promptReady) {
    return "prompt";
  }
  return facts.ios ? "ios" : "none";
}

/**
 * iPadOS reports itself as a Mac; a Mac with a touch screen does not exist, so
 * touch points are what tell them apart.
 */
export function isAppleMobile(userAgent: string, touchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
}

declare global {
  interface Window {
    /** What lib/pwa-bootstrap.ts caught before this module was listening. */
    __daInstall?: { prompt: Event | null; installed: boolean };
  }
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let offer: InstallOffer = "none";
const listeners = new Set<() => void>();

function recompute(): void {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const next = installOffer({
    standalone,
    ios: isAppleMobile(navigator.userAgent, navigator.maxTouchPoints),
    promptReady: deferred !== null,
    installed,
  });
  if (next !== offer) {
    offer = next;
    for (const listener of listeners) {
      listener();
    }
  }
}

/**
 * Listen for the browser saying the app can be (or just was) installed. Called
 * once, from the root layout, for the life of the tab. The event is NOT
 * cancelled: Chrome's own install affordances stay, and this adds a door to
 * the same dialog rather than replacing them.
 */
export function watchInstallability(): () => void {
  const onPrompt = (event: Event) => {
    deferred = event as BeforeInstallPromptEvent;
    recompute();
  };
  const onInstalled = () => {
    deferred = null;
    installed = true;
    recompute();
  };
  // Whatever fired before hydration (pwa-bootstrap.ts), then everything after.
  const early = window.__daInstall;
  if (early !== undefined) {
    deferred ??= early.prompt as BeforeInstallPromptEvent | null;
    installed ||= early.installed;
  }
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  recompute();
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

/**
 * Open the browser's install dialog. A captured prompt can be used once, so it
 * is spent here whatever the answer; Chromium fires a fresh one later if the
 * person dismissed it.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (event === null) {
    return "unavailable";
  }
  deferred = null;
  if (window.__daInstall !== undefined) {
    window.__daInstall.prompt = null;
  }
  recompute();
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    // The browser already spent this prompt (another tab, its own install
    // button). Nothing to show the person: the offer is gone either way.
    return "unavailable";
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current offer. The server, and the first client render, say "none". */
export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(
    subscribe,
    () => offer,
    () => "none",
  );
}
