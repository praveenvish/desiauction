"use client";

import {
  Button,
  ButtonLink,
  IconCheck,
  IconCopy,
  IconGlobe,
  IconMessageCircle,
  IconSend,
  IconTile,
  useToast,
} from "@desiauction/ui";
import { useState } from "react";

import { useOrigin } from "../../../../lib/use-hydrated";

/**
 * Recruit-players share control (parity §E). The absolute URL is resolved on the
 * client from the live origin (SSR-safe), shown for transparency, and offered
 * via clipboard + the native share sheet (mobile). No new deps; QR is a separate
 * dependency decision.
 */
export function ShareRegistration({
  slug,
  open,
  seasonName,
}: {
  slug: string;
  open: boolean;
  /** Named in the ready-made WhatsApp message, so it reads like the club sent it. */
  seasonName?: string;
}) {
  const toast = useToast();
  const origin = useOrigin();
  const url = origin === "" ? "" : `${origin}/seasons/${slug}/register`;
  /*
   * THE MESSAGE A CLUB ACTUALLY SENDS. Recruitment in this market happens in
   * WhatsApp groups, and the bare link made every organizer write the same
   * sentence by hand. Written ready to forward: what it is, the link, and what
   * a player will need — the four things the registration form asks for — so
   * nobody opens it without their photo to hand. `wa.me` opens the app on a
   * phone and WhatsApp Web on a desktop.
   */
  const message = `🏏 Registrations are open${seasonName === undefined ? "" : ` for ${seasonName}`}! Register here: ${url} — takes a minute: your name, phone, playing role and a photo.`;
  const [copied, setCopied] = useState(false);

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
        await navigator.share({ title: "Register to play", text: message, url });
      } catch {
        // user dismissed the share sheet — not an error
      }
      return;
    }
    await copy();
  }

  // DA-35: the block kept offering a live Copy/Share for a link that lands
  // every player it recruits on "Registration is not open right now". Closure
  // is a fact the recruiting control has to know.
  if (!open) {
    return (
      // One line, not a panel: a closed link is a fact to know, not a task.
      <span
        className="share-reg-closed rd-share-closed"
        data-testid="share-registration"
        title="The link no longer takes new players. You can still add or import players here."
      >
        <span className="share-reg-dot" aria-hidden />
        <span data-testid="share-closed">
          Registration closed
          <span className="rd-share-closed-more">
            {" "}
            — the link no longer takes new players; you can still add or import them here
          </span>
        </span>
      </span>
    );
  }

  return (
    <div className="rd-share" data-testid="share-registration">
      <IconTile icon={<IconGlobe />} concept="players" size="sm" />
      <div className="rd-share-text">
        <label className="share-reg-label" htmlFor={`share-${slug}`}>
          Registration is open — share this link to recruit players
        </label>
        <input
          id={`share-${slug}`}
          className="rd-share-input"
          value={url}
          readOnly
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          aria-label="Public registration link"
        />
      </div>
      <div className="rd-share-actions">
        <Button size="sm" variant="secondary" onClick={() => void copy()} disabled={url === ""}>
          {copied ? (
            <>
              <IconCheck size={16} className="icon-lead" aria-hidden />
              Copied
            </>
          ) : (
            <>
              <IconCopy size={16} className="icon-lead" aria-hidden />
              Copy
            </>
          )}
        </Button>
        {url === "" ? null : (
          <ButtonLink
            size="sm"
            variant="secondary"
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="share-registration-whatsapp"
          >
            <IconMessageCircle size={16} className="icon-lead" aria-hidden />
            WhatsApp
          </ButtonLink>
        )}
        <Button size="sm" variant="ghost" onClick={() => void share()} disabled={url === ""}>
          <IconSend size={16} className="icon-lead" aria-hidden />
          Share
        </Button>
      </div>
    </div>
  );
}
