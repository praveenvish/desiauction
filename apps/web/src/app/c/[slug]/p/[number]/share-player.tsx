"use client";

import {
  Button,
  ButtonLink,
  IconCheck,
  IconCopy,
  IconMessageCircle,
  IconPhone,
  IconSend,
} from "@desiauction/ui";
import { useEffect, useRef, useState } from "react";

import { useHydrated, usePageAddress } from "../../../../../lib/use-hydrated";
import { whatsappHref, withRef, type ShareLanguage } from "../../../../../lib/share-message";
import { track } from "../../../../../lib/telemetry";
import { ownStatusPosterHref } from "./actions";

/**
 * THE SHARE SHEET — the one control this page exists for.
 *
 * The card is the viral unit of a grassroots auction: a player posts it to a
 * Status and forwards it to three groups. This page used to offer a URL in a
 * text box and a Copy button, a desktop pattern on a page opened almost only on
 * phones. The sheet now offers what people actually do, in the order they do it:
 *
 * 1. SEND ON WHATSAPP — a `wa.me` link with the sentence and the link filled in,
 *    in English or Hindi. The link preview carries the picture.
 * 2. POST TO STATUS — the 9:16 poster image itself. Where the phone can share a
 *    FILE (Android Chrome, iOS Safari) it goes straight to the share sheet, so
 *    WhatsApp → My status is two taps; elsewhere it downloads. Offered only to
 *    the player and the organizer — the poster route's own rule, asked after
 *    mount (`ownStatusPosterHref`) so the page itself stays public and cached.
 * 3. COPY LINK, and MORE (the native sheet) where the browser has one.
 *
 * Every link carries `?ref=` for where it went, and every action records a
 * telemetry event with the card's state and nothing about who shared it.
 */
export function SharePlayer({
  playerName,
  slug,
  number,
  outcome,
  messages,
}: {
  playerName: string;
  slug: string;
  number: string;
  outcome: string;
  messages: Record<ShareLanguage, string>;
}) {
  const url = usePageAddress();
  const [language, setLanguage] = useState<ShareLanguage>("en");
  const [posterHref, setPosterHref] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // Known only in the browser, and never changes for the life of the page.
  const canNativeShare = useHydrated() && typeof navigator.share === "function";
  // The poster file, fetched ahead of the tap: a phone only opens its share
  // sheet inside the gesture that asked for it, and a two-second fetch between
  // the tap and `navigator.share` spends that gesture.
  const posterFile = useRef<File | null>(null);
  const message = messages[language];
  const props = { surface: "player", outcome, lang: language };

  useEffect(() => {
    let live = true;
    void ownStatusPosterHref(slug, number).then((href) => {
      if (!live || href === null) {
        return;
      }
      setPosterHref(href);
      void fetch(href)
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (live && blob !== null) {
            posterFile.current = new File([blob], `${slug}-${number}-status.png`, {
              type: "image/png",
            });
          }
        })
        .catch(() => {
          // The tap will fetch it instead.
        });
    });
    return () => {
      live = false;
    };
  }, [slug, number]);

  function say(text: string) {
    setNote(text);
    window.setTimeout(() => {
      setNote("");
      setCopied(false);
    }, 3000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(withRef(url, "link"));
      track("share.link_copied", props);
      setCopied(true);
      say("Link copied — paste it anywhere.");
    } catch {
      say("Couldn't copy. Press and hold the address bar to copy the link.");
    }
  }

  async function shareNative() {
    track("share.native_opened", props);
    try {
      await navigator.share({ title: playerName, text: message, url: withRef(url, "share") });
    } catch {
      // Dismissed — not an error.
    }
  }

  async function postToStatus() {
    if (posterHref === null) {
      return;
    }
    setBusy(true);
    try {
      let file = posterFile.current;
      if (file === null) {
        const response = await fetch(posterHref);
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        file = new File([await response.blob()], `${slug}-${number}-status.png`, {
          type: "image/png",
        });
        posterFile.current = file;
      }
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: `${message}\n${withRef(url, "status")}` });
          track("share.status_shared", props);
        } catch {
          // Dismissed.
        }
        return;
      }
      // No file sharing here (most desktops): save it, and say what to do next.
      const objectUrl = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = file.name;
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 10_000);
      track("share.status_saved", props);
      say("Saved. Open WhatsApp → Status → pick the image.");
    } catch {
      say("Couldn't make the image just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const ready = url !== "";

  return (
    <div className="share-sheet" data-testid="share-player" data-ready={ready ? "" : undefined}>
      <div className="share-sheet-head">
        <span className="share-sheet-label" id="share-message-label">
          Message
        </span>
        <div className="share-sheet-lang" role="group" aria-label="Message language">
          <button
            type="button"
            aria-pressed={language === "en"}
            onClick={() => {
              setLanguage("en");
            }}
          >
            English
          </button>
          <button
            type="button"
            lang="hi"
            aria-pressed={language === "hi"}
            onClick={() => {
              setLanguage("hi");
            }}
          >
            हिंदी
          </button>
        </div>
      </div>
      <p
        className="share-sheet-preview"
        aria-labelledby="share-message-label"
        lang={language}
        data-testid="share-message"
      >
        {message}
      </p>

      <ButtonLink
        href={ready ? whatsappHref(message, withRef(url, "whatsapp")) : undefined}
        target="_blank"
        rel="noopener noreferrer"
        size="lg"
        className="share-sheet-primary"
        aria-disabled={!ready}
        onClick={() => {
          track("share.whatsapp_opened", props);
        }}
        data-testid="share-whatsapp"
      >
        <IconMessageCircle size={20} /> Send on WhatsApp
      </ButtonLink>

      {posterHref === null ? null : (
        // Second only to the message: the image is what goes on a Status, so
        // it gets a row of its own rather than a cell its label wraps in.
        <Button
          variant="secondary"
          size="lg"
          className="share-sheet-wide"
          onClick={() => void postToStatus()}
          loading={busy}
          data-testid="share-status"
        >
          <IconPhone size={20} /> Post to Status
        </Button>
      )}

      <div className="share-sheet-actions">
        <Button
          variant="secondary"
          onClick={() => void copy()}
          disabled={!ready}
          data-testid="share-copy"
        >
          {copied ? <IconCheck size={18} /> : <IconCopy size={18} />} Copy link
        </Button>
        {canNativeShare ? (
          <Button variant="secondary" onClick={() => void shareNative()} disabled={!ready}>
            <IconSend size={18} /> More
          </Button>
        ) : null}
      </div>

      <p className="share-sheet-note" role="status">
        {note}
      </p>
    </div>
  );
}
