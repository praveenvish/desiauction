"use client";

import { useEffect } from "react";

import { THEME_STORAGE_KEY } from "./theme-bootstrap";

/**
 * RE-APPLY THE REMEMBERED THEME WHERE THE ROOT LAYOUT CANNOT.
 *
 * Next serves a not-found that fails to render on the server under its own
 * `<html id="__next_error__">` shell. That is the fallback now (404s are
 * server-rendered: patches/next@15.5.25.patch), but it still happens when the
 * not-found render itself fails. The root layout's `<html data-theme>` and the
 * inline bootstrap that replays the visitor's choice are both absent from that
 * document — so someone who chose the dark theme met exactly one cream page,
 * the one telling them they are lost. An inline `<script>` rendered from the
 * page does not survive into that shell either; a mount effect does.
 *
 * The cost is one frame in the default theme before this runs, which is why it
 * is NOT how the rest of the site replays the theme — the layout's pre-paint
 * script stays the mechanism everywhere it can run.
 */
export function ThemeReplay() {
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "floodlight" || stored === "daylight") {
        document.documentElement.setAttribute("data-theme", stored);
      }
    } catch {
      // Private mode or blocked storage: the default theme is the right answer.
    }
  }, []);
  return null;
}
