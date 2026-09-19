"use client";

import { IconMoon, IconSun } from "@desiauction/ui";
import { useSyncExternalStore } from "react";

/**
 * Console theme switch (doc 18 C-4). The root carries `data-theme`; Daylight is
 * the console default and Floodlight is the dark counterpart. Surfaces that pin
 * their own scope locally — the marketing bands, the auction board, the OBS
 * overlay — are unaffected, because they set `data-theme` on themselves.
 *
 * The choice is remembered per device. `applyStoredTheme` (inlined by the root
 * layout) replays it before first paint so there is no flash of the wrong theme.
 */

export const THEME_STORAGE_KEY = "da-theme";

export type ConsoleTheme = "daylight" | "floodlight";

/** Inlined into the document head — must stay dependency-free and tiny. */
export const THEME_BOOTSTRAP = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="floodlight"||t==="daylight"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;

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

export function ThemeToggle() {
  // The server cannot know the stored theme, so it (and the hydrating render)
  // sees null and draws the default icon; the client snapshot takes over after.
  const current = useSyncExternalStore(subscribeTheme, readTheme, () => null);
  const theme: ConsoleTheme = current ?? "daylight";

  const next: ConsoleTheme = theme === "daylight" ? "floodlight" : "daylight";

  return (
    <button
      type="button"
      className="shell-icon-button"
      data-testid="theme-toggle"
      aria-label={next === "floodlight" ? "Switch to dark theme" : "Switch to light theme"}
      title={next === "floodlight" ? "Dark" : "Light"}
      onClick={() => {
        document.documentElement.setAttribute("data-theme", next);
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Private mode / storage disabled: the switch still works for this view.
        }
      }}
    >
      {current === "floodlight" ? <IconSun size={18} /> : <IconMoon size={18} />}
    </button>
  );
}
