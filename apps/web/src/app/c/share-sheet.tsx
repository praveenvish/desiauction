"use client";

import type { MoneyUnit } from "@desiauction/core";
import {
  Button,
  ButtonLink,
  IconCheck,
  IconCopy,
  IconMessageCircle,
  IconPhone,
  IconPlay,
  IconSend,
} from "@desiauction/ui";
import { useEffect, useRef, useState } from "react";

import { useHydrated, usePageAddress } from "../../lib/use-hydrated";
import { whatsappHref, withRef, type ShareLanguage } from "../../lib/share-message";
import { track } from "../../lib/telemetry";
import { ownPlayerStatusHref, ownTeamStatusHref } from "./share-actions";

/** Which Status poster the sheet may offer, if the viewer is entitled to it. */
export type StatusPoster =
  | { readonly kind: "player"; readonly slug: string; readonly number: string }
  | { readonly kind: "team"; readonly slug: string; readonly team: string };

/**
 * THE SHARE SHEET — the one control a public player or team page exists for.
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
export function ShareSheet({
  title,
  surface,
  outcome,
  messages,
  status,
  unit,
}: {
  /** What the native share sheet calls it: a player's or a team's name. */
  title: string;
  surface: "player" | "team";
  outcome: string;
  messages: Record<ShareLanguage, string>;
  status: StatusPoster;
  /** The season's unit, so the film's counting price reads "₹…" or "… pts". */
  unit: MoneyUnit;
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
  // The animated Status: offered only where this browser can encode an MP4
  // (WebCodecs H.264 — Chrome, Edge, Safari), made on the first tap and shared
  // on the second, because encoding takes a second and a phone only opens its
  // share sheet inside the tap that asked for it.
  const [canVideo, setCanVideo] = useState(false);
  // null: idle · "prepare": the server is drawing the film's layers (the long
  // part) · a number: the browser is encoding, in percent.
  const [making, setMaking] = useState<number | "prepare" | null>(null);
  const videoFile = useRef<File | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const message = messages[language];
  const props = { surface, outcome, lang: language };
  const { slug } = status;
  const subject = status.kind === "player" ? status.number : status.team;
  const fileName = `${slug}-${subject}-status.png`;

  useEffect(() => {
    let live = true;
    const ask =
      status.kind === "player"
        ? ownPlayerStatusHref(status.slug, status.number)
        : ownTeamStatusHref(status.slug, status.team);
    void ask.then((href) => {
      if (!live || href === null) {
        return;
      }
      setPosterHref(href);
      void import("../seasons/[slug]/posters/poster-motion")
        .then((motion) => motion.videoExportMode(1080, 1920))
        .then((mode) => {
          if (live && mode === "mp4") {
            setCanVideo(true);
          }
        })
        .catch(() => {
          // No video here; the image is offered either way.
        });
      void fetch(href)
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (live && blob !== null) {
            posterFile.current = new File([blob], fileName, {
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
    // `status` is a fresh object each render; its fields are what identify it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind, status.slug, subject]);

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
      await navigator.share({ title, text: message, url: withRef(url, "share") });
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
        file = new File([await response.blob()], fileName, {
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

  async function makeVideo() {
    if (posterHref === null) {
      return;
    }
    setMaking("prepare");
    try {
      const motion = await import("../seasons/[slug]/posters/poster-motion");
      await motion.loadCountFont();
      const sprite = await motion.loadSprite(`${posterHref}&motion=1`);
      const scene = motion.buildScene(sprite, unit);
      const blob = await motion.encodeSceneMp4(scene, (fraction) => {
        setMaking(Math.round(fraction * 100));
      });
      videoFile.current = new File([blob], fileName.replace(/\.png$/, ".mp4"), {
        type: "video/mp4",
      });
      setVideoReady(true);
      track("share.video_made", props);
      say("Your video is ready — tap Share video.");
    } catch {
      say("Couldn't make the video just now. The image works either way.");
    } finally {
      setMaking(null);
    }
  }

  async function shareVideo() {
    const file = videoFile.current;
    if (file === null) {
      return;
    }
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: `${message}\n${withRef(url, "status")}` });
        track("share.video_shared", props);
      } catch {
        // Dismissed.
      }
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 10_000);
    track("share.video_saved", props);
    say("Saved. Open WhatsApp → Status → pick the video.");
  }

  const ready = url !== "";

  return (
    <div
      className="share-sheet"
      data-testid={`share-${surface}`}
      data-ready={ready ? "" : undefined}
    >
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

      {posterHref === null || !canVideo ? null : (
        <Button
          variant="secondary"
          size="lg"
          className="share-sheet-wide"
          onClick={() => void (videoReady ? shareVideo() : makeVideo())}
          loading={making !== null}
          data-testid="share-video"
        >
          <IconPlay size={20} />{" "}
          {making === "prepare"
            ? "Preparing your video…"
            : making !== null
              ? `Making video ${String(making)}%`
              : videoReady
                ? "Share Status video"
                : "Make a Status video"}
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
