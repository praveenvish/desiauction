"use client";

import { Button, IconCheck, IconExternal, VisuallyHidden } from "@desiauction/ui";
import { useState } from "react";

import { useOrigin } from "../../../../lib/use-hydrated";

/**
 * "Tell your teammates" from the confirmation. The native share sheet where
 * there is one (a phone, which is where most players register); the clipboard
 * everywhere else. Same pattern as SharePlayer: the origin is read on the
 * client, so the button waits for hydration rather than sharing a bare path.
 */
export function ShareSeason({ path, title }: { path: string; title: string }) {
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);
  const url = origin === "" ? "" : `${origin}${path}`;

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
      } catch {
        // Dismissed — not an error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="touch"
        disabled={url === ""}
        data-testid="share-season"
        onClick={() => void share()}
      >
        {copied ? <IconCheck size={16} /> : <IconExternal size={16} />}
        {copied ? "Link copied" : "Share season"}
      </Button>
      <VisuallyHidden role="status">
        {copied ? "Season link copied to your clipboard." : ""}
      </VisuallyHidden>
    </>
  );
}
