"use client";

import { useToast } from "@desiauction/ui";
import { useEffect, useRef } from "react";

const FLAG = "da_joined_org";

/**
 * "You're in." — the confirmation accepting an invitation never gave.
 *
 * `acceptInviteAction` redirected onto the club in silence, and an account with
 * no name was then bounced straight onward to /onboarding, whose heading is
 * written for a founder creating their first auction. The one thing the person
 * had actually just done was the one thing nothing on screen mentioned.
 *
 * Cookie rather than query parameter, matching `CreatedToast`: the org URL gets
 * copied and extended, and the flag has to survive the name gate interrupting
 * the destination. Read once, then deleted, so a refresh does not repeat it.
 * The ref guards Strict Mode's double invoke.
 */
export function JoinedToast() {
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
      title: name === "" ? "You're in" : `You've joined ${name}`,
      description: "Your invitation has been used up — it won't work again.",
      tone: "success",
    });
  }, [toast]);

  return null;
}
