"use client";

import { Button } from "@desiauction/ui";
import { useEffect, useState } from "react";

/**
 * Share control for a public player page. The OG route calls this page "the
 * viral unit of a grassroots auction: a player posts their own card — 'I'm in
 * the pool, bid for me'" — and the page gave them nothing to post with. Its
 * only action was a back link.
 *
 * Same pattern as the organizer's ShareRegistration and the spectate share: URL
 * resolved on the client from the live origin (SSR-safe), shown in full so it
 * can be read and copied by hand, offered via clipboard and the native share
 * sheet. No new dependencies.
 */
export function SharePlayer({ playerName }: { playerName: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(window.location.href.split("?")[0] ?? window.location.href);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard refused (permissions, insecure origin) — the input above is
      // readable and selectable, which is the fallback.
      setCopied(false);
    }
  }

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: playerName, url });
      } catch {
        // dismissed — not an error
      }
      return;
    }
    await copy();
  }

  return (
    <div className="public-share" data-testid="share-player">
      <label className="public-share-label" htmlFor="share-player-url">
        Share this player card
      </label>
      <div className="public-share-row">
        <input
          id="share-player-url"
          className="public-share-input"
          value={url}
          readOnly
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          aria-label={`Public page for ${playerName}`}
        />
        <Button size="sm" variant="secondary" onClick={() => void copy()} disabled={url === ""}>
          {copied ? "Copied ✓" : "Copy"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void share()} disabled={url === ""}>
          Share
        </Button>
      </div>
      <p
        className="public-hint"
        role="status"
        // Announced only when it changes, so the copy is confirmed to a screen
        // reader rather than only to the eye watching the button label.
      >
        {copied ? "Link copied to your clipboard." : ""}
      </p>
    </div>
  );
}
