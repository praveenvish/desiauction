/**
 * THE THEME'S PRE-PAINT SCRIPT, AND THE KEY IT READS — as plain strings.
 *
 * NOT IN theme-toggle.tsx, AND THAT IS THE WHOLE POINT OF THIS FILE. That
 * module is "use client", so every export a SERVER component imports from it
 * arrives as a client reference, not a value. The root layout inlined
 * `THEME_BOOTSTRAP` from there, and what reached every page was the proxy's
 * source: `function(){throw Error("Attempted to call THEME_BOOTSTRAP() from
 * the server…")}` — a syntax error. The script never ran: someone who chose
 * the dark theme saw the light one until hydration, on every full page load.
 * The layout imports from here; the client toggle imports from here too, so
 * there is one key.
 */

export const THEME_STORAGE_KEY = "da-theme";

/** Inlined by the root layout before first paint: dependency-free and tiny. */
export const THEME_BOOTSTRAP = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="floodlight"||t==="daylight"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;
