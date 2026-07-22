"use client";

import { Button, useToast } from "@desiauction/ui";
import { useEffect, useState } from "react";

/**
 * Recruit-players share control (parity §E). The absolute URL is resolved on the
 * client from the live origin (SSR-safe), shown for transparency, and offered
 * via clipboard + the native share sheet (mobile). No new deps; QR is a separate
 * dependency decision.
 */
export function ShareRegistration({ slug }: { slug: string }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/competitions/${slug}/register`);
  }, [slug]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Registration link copied", tone: "success" });
      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      toast({ title: "Couldn't copy — select the link and copy manually.", tone: "danger" });
    }
  }

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Register to play", url });
      } catch {
        // user dismissed the share sheet — not an error
      }
      return;
    }
    await copy();
  }

  return (
    <div className="share-reg" data-testid="share-registration">
      <label className="share-reg-label" htmlFor={`share-${slug}`}>
        Recruit players — share this registration link
      </label>
      <div className="share-reg-row">
        <input
          id={`share-${slug}`}
          className="share-reg-input"
          value={url}
          readOnly
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          aria-label="Public registration link"
        />
        <Button size="sm" variant="secondary" onClick={() => void copy()} disabled={url === ""}>
          {copied ? "Copied ✓" : "Copy"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void share()} disabled={url === ""}>
          Share
        </Button>
      </div>
    </div>
  );
}
