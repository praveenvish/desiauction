"use client";

import { IconMoon, IconSun } from "@desiauction/ui";
import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "./theme-bootstrap";

/**
 * Console theme switch (doc 18 C-4). The root carries `data-theme`; Daylight is
 * the console default and Floodlight is the dark counterpart. Surfaces that pin
 * their own scope locally — the marketing bands, the auction board, the OBS
 * overlay — are unaffected, because they set `data-theme` on themselves.
 *
 * The choice is remembered per device. THEME_BOOTSTRAP (theme-bootstrap.ts,
 * inlined by the root layout) replays it before first paint, so there is no
 * flash of the wrong theme.
 */

export type ConsoleTheme = "daylight" | "floodlight";

function readTheme(): ConsoleTheme {
  return document.documentElement.getAttribute("data-theme") === "floodlight"
    ? "floodlight"
    : "daylight";
}

/**
 * The attribute IS the store: the bootstrap script, this button and any other
 * tab-level switch all write `data-theme` on the root, so the toggle subscribes
 * to that attribute rather than keeping a copy of it in state.
 */
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    observer.disconnect();
  };
}

/**
 * `row`: a labelled line in the phone menu, where the bar hands the switch
 * under 360px (header 9.5); `icon` is the bar's own 40px button.
 */
export function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "row" } = {}) {
  // The server cannot know the stored theme, so it (and the hydrating render)
  // sees null and draws the default icon; the client snapshot takes over after.
  const current = useSyncExternalStore(subscribeTheme, readTheme, () => null);
  const theme: ConsoleTheme = current ?? "daylight";

  const next: ConsoleTheme = theme === "daylight" ? "floodlight" : "daylight";

  return (
    <button
      type="button"
      className={variant === "row" ? "shell-drawer-link shell-theme-row" : "shell-icon-button"}
      data-testid={variant === "row" ? "theme-toggle-row" : "theme-toggle"}
      {...(variant === "icon"
        ? {
            "aria-label": next === "floodlight" ? "Switch to dark theme" : "Switch to light theme",
            title: next === "floodlight" ? "Dark" : "Light",
          }
        : {})}
      onClick={() => {
        document.documentElement.setAttribute("data-theme", next);
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Private mode / storage disabled: the switch still works for this view.
        }
      }}
    >
      {current === "floodlight" ? <IconSun size={20} /> : <IconMoon size={20} />}
      {variant === "row" ? (next === "floodlight" ? "Dark theme" : "Light theme") : null}
    </button>
  );
}
