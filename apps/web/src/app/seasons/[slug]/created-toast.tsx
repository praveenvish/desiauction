"use client";

import { useToast } from "@desiauction/ui";
import { useEffect, useRef } from "react";

const FLAG = "da_created_season";

/**
 * "X created." — the confirmation a create had never given.
 *
 * `createCompetitionAction` redirects onto the new season and that was the whole
 * of the feedback: the page simply changed under you, and nothing on it named
 * the thing you had just made or said that the create had succeeded rather than
 * the browser having wandered somewhere.
 *
 * The signal is a short-lived cookie, not a query parameter — the season's URL
 * is copied and extended (`${url}/teams`) by people and by tests, so a flag
 * hanging off it would corrupt every one of those. Read once, then deleted, so
 * a refresh does not repeat it. The ref guards Strict Mode's double invoke.
 */
export function CreatedToast() {
  const toast = useToast();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) {
      return;
    }
    const match = new RegExp(`(?:^|; )${FLAG}=([^;]*)`).exec(document.cookie);
    if (match === null) {
      return;
    }
    fired.current = true;
    document.cookie = `${FLAG}=; path=/; max-age=0`;
    const name = decodeURIComponent(match[1] ?? "");
    toast({
      title: name === "" ? "Season created" : `${name} created`,
      description: "Set it up, then open registration when you are ready.",
      tone: "success",
    });
  }, [toast]);

  return null;
}
