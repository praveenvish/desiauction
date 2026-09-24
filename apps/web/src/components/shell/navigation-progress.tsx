"use client";

import { isRouterHref } from "@desiauction/ui";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import "./navigation-progress.css";

/**
 * THE CLICK IS ANSWERED AT ONCE.
 *
 * Every route in this product renders on the server, and none has a
 * `loading.tsx` above its gate (see nextjs-suspense-breaks-gates: a boundary
 * above `notFound()`/`redirect()` commits a 200 first). So a click on a link
 * used to change NOTHING on screen until the next page's server response
 * arrived — a few hundred milliseconds on a good day, seconds on a phone on
 * 4G — and the page read as hung. Founder's words: "clicking, it stays there,
 * no loader or nothing".
 *
 * This bar starts on the click itself (before any network), creeps while the
 * router waits, and completes when the URL actually changes. It watches the
 * document rather than wrapping `<Link>`, so every link in the product —
 * rail, tabs, cards, footer, plain anchors — is covered without touching them.
 *
 * THE PAGE ANSWERS TOO, not only the bar. On a phone a tab click waits
 * 0.5–0.7 s for the server (measured, slow-4G profile) and a 3px bar at the top
 * edge is easy to miss while the page you are looking at sits unchanged. So a
 * click that will RENDER a page (an in-app route the router takes — not an
 * export, a download or a file) marks the document `data-nav-pending`: the
 * content region fades back after a short delay (fast clicks never flicker —
 * see navigation-progress.css) and is `aria-busy` until the new page commits.
 * This is the client-side stand-in for a `loading.tsx`, which cannot be used
 * above these pages without turning their 404s into 200s.
 *
 * What it deliberately does NOT start for: modified clicks (new tab), other
 * origins, downloads, `target` other than _self, hash-only jumps on the same
 * page, and a click on the page you are already on.
 */
export function NavigationProgress() {
  return (
    // `useSearchParams` needs a boundary; the bar is chrome, so it renders
    // nothing rather than suspend anything around it.
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}

type Phase = "idle" | "loading" | "done";

/**
 * Give up after this long. The listener runs in the CAPTURE phase — it has to,
 * because `<Link>` calls preventDefault to take over the navigation, so a
 * bubble-phase listener cannot tell a Link from a cancelled click — which means
 * an anchor whose own handler cancels navigation (rare here) starts a bar that
 * nothing completes. This is the ceiling on that.
 */
const SAFETY_MS = 10_000;

/** The same key the router-driven effect below compares, read from the window. */
function windowLocationKey(): string {
  return `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;
}

function isNavigationClick(event: MouseEvent): URL | null {
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a");
  if (anchor === null || !anchor.hasAttribute("href")) return null;
  if (anchor.hasAttribute("download")) return null;
  const frame = anchor.getAttribute("target");
  if (frame !== null && frame !== "" && frame !== "_self") return null;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  const here = new URL(window.location.href);
  // Same page, same query: a hash jump or a no-op click. Nothing will load.
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return url;
}

/**
 * Mark the document while a page is on its way. An attribute on <html> rather
 * than React state threaded into every shell: the shells live in
 * `@desiauction/ui` and own their content region, and CSS can reach it from here.
 */
function setPending(pending: boolean): void {
  document.documentElement.toggleAttribute("data-nav-pending", pending);
  const content = document.getElementById("main-content");
  if (pending) content?.setAttribute("aria-busy", "true");
  else content?.removeAttribute("aria-busy");
}

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [phase, setPhase] = useState<Phase>("idle");
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Finish when the URL the router renders has changed. The key is the whole
  // location, so a query-only navigation (filter bars) completes too.
  const location = `${pathname}?${search.toString()}`;
  const previous = useRef(location);

  // Start on the click — in the capture phase, before `<Link>` takes it over.
  useEffect(() => {
    function start(renders: boolean): void {
      setPending(renders);
      if (settle.current !== null) clearTimeout(settle.current);
      if (safety.current !== null) clearTimeout(safety.current);
      setPhase("loading");
      safety.current = setTimeout(() => {
        setPhase("idle");
        setPending(false);
      }, SAFETY_MS);
    }
    function onClick(event: MouseEvent): void {
      const url = isNavigationClick(event);
      if (url !== null) start(isRouterHref(url.pathname + url.search));
    }
    // Back/forward. Chrome also fires popstate for a same-page hash jump, which
    // loads nothing — so only a change of path or query counts.
    function onPopState(): void {
      if (windowLocationKey() !== previous.current) start(true);
    }
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (previous.current === location) return;
    previous.current = location;
    if (safety.current !== null) clearTimeout(safety.current);
    setPhase((current) => (current === "loading" ? "done" : current));
    setPending(false);
  }, [location]);

  // "done" plays the fill-and-fade, then the bar leaves the tree's layout.
  useEffect(() => {
    if (phase !== "done") return;
    settle.current = setTimeout(() => {
      setPhase("idle");
    }, 400);
    return () => {
      if (settle.current !== null) clearTimeout(settle.current);
    };
  }, [phase]);

  return <div className="nav-progress" data-phase={phase} aria-hidden="true" />;
}
