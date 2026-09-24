"use client";

import { createContext, useContext, type ElementType, type ReactNode } from "react";

/**
 * THE APP'S ROUTER LINK, HANDED TO PRIMITIVES THAT CANNOT IMPORT IT.
 *
 * `@desiauction/ui` does not depend on Next, so a primitive that renders a link
 * can only render `<a>` — and a plain `<a>` to an in-app page is a FULL page
 * load: a fresh document, every root-layout read run again, every script
 * re-parsed and the whole tree re-hydrated. `ButtonLink` alone carried ~120
 * in-app hrefs (every "Next step" CTA on /home among them), so the product's
 * most-clicked buttons were its slowest navigations. The shells already solve
 * this with a `linkComponent` prop; this is the same idea for primitives that
 * appear everywhere, set once at the root instead of threaded through each
 * call site.
 *
 * Unprovided (tests, other hosts) it is `"a"`, exactly the old behaviour.
 */
const LinkComponentContext = createContext<ElementType>("a");

export function LinkComponentProvider({
  component,
  children,
}: {
  component: ElementType;
  children: ReactNode;
}) {
  return (
    <LinkComponentContext.Provider value={component}>{children}</LinkComponentContext.Provider>
  );
}

/**
 * Only a same-origin PAGE may take the client router. Everything else keeps the
 * browser's own navigation, because the router would fetch it as a page first
 * and then fall back to a full load anyway — or break it outright:
 *   - external, protocol-relative, `mailto:`/`tel:`, and bare `#fragment` hrefs;
 *   - `/api/…` and any path whose last segment has a file extension (the .ics
 *     invite, poster PNGs, CSV exports under a named file);
 *   - a `download`, or a `target` other than `_self`.
 * Route handlers without an extension (`/reports/export`, the poster routes)
 * are listed by the app in `ROUTE_HANDLER_PREFIXES` below.
 */
const ROUTE_HANDLER_PREFIXES = [
  "/api/",
  "/reports/export",
  "/admin/newsletter/export",
  "/healthz",
  "/readyz",
];

export function isRouterHref(
  href: string | undefined,
  { download, target }: { download?: unknown; target?: string | undefined } = {},
): href is string {
  if (href === undefined || !href.startsWith("/") || href.startsWith("//")) return false;
  if (download !== undefined && download !== false) return false;
  if (target !== undefined && target !== "_self") return false;
  const path = href.split(/[?#]/, 1)[0] ?? "";
  if (ROUTE_HANDLER_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)))
    return false;
  if (/\/posters\/(player|team|top|season|reveal)(\/|$)/.test(path)) return false;
  if (/\/screenshot$/.test(path)) return false;
  const last = path.slice(path.lastIndexOf("/") + 1);
  return !/\.[a-z0-9]{2,5}$/i.test(last);
}

/** The app's router link, or `"a"` when none was provided. Pair with `isRouterHref`. */
export function useLinkComponent(): ElementType {
  return useContext(LinkComponentContext);
}
