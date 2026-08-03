"use client";

import { useToast } from "@desiauction/ui";
import { useEffect, useState } from "react";

import type { AuctionStatus } from "@desiauction/core";

/**
 * What you are actually forwarding. "Watch … live" went out on completed,
 * scheduled and abandoned auctions alike — a WhatsApp message inviting someone
 * to watch a night that finished three weeks ago.
 */
const SHARE_VERB: Record<AuctionStatus, string> = {
  scheduled: "Coming up:",
  live: "Watch live:",
  paused: "Watch live:",
  completed: "Results:",
  reconciled: "Results:",
  abandoned: "Abandoned:",
};

/**
 * The conversion surface on the product's most-forwarded screen.
 *
 * Before this the whole page held two anchors — "Skip to content" and "Leave
 * auction" — so a guest who was enjoying the night had nowhere to send it and
 * nowhere to go. WhatsApp is the distribution channel for this market, hence a
 * first-class button beside the copy control rather than a share icon nobody
 * finds; `wa.me` opens the native app on a phone and web on a desktop.
 *
 * The URL is resolved from the live origin on the client (SSR-safe, and correct
 * behind whatever host the deployment answers on).
 */
export function ShareAuction({
  slug,
  auctionName,
  auctionStatus,
  testId = "share-auction",
}: {
  slug: string;
  auctionName: string;
  /** DA-20: the message said "live" whatever the night was actually doing. */
  auctionStatus: AuctionStatus;
  testId?: string;
}) {
  const toast = useToast();
  const [url, setUrl] = useState("");

  useEffect(() => {
    setUrl(`${window.location.origin}/seasons/${slug}/auction/spectate`);
  }, [slug]);

  const message = `${SHARE_VERB[auctionStatus]} ${auctionName} on DesiAuction`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied — paste it anywhere", tone: "success" });
    } catch {
      toast({ title: "Couldn't copy — long-press the address bar instead.", tone: "danger" });
    }
  }

  return (
    <div className="share-auction" data-testid={testId}>
      <p className="share-auction-lede">
        {auctionStatus === "completed" || auctionStatus === "reconciled"
          ? "Anyone can see the results — no account needed."
          : "Anyone can watch — no account needed."}
        <span className="share-auction-sub">Send the link; it opens straight to the stage.</span>
      </p>
      <div className="share-auction-actions">
        <button
          type="button"
          className="share-auction-button"
          data-testid="share-copy"
          onClick={() => {
            void copy();
          }}
        >
          Copy link
        </button>
        <a
          className="share-auction-button share-auction-button--whatsapp"
          data-testid="share-whatsapp"
          href={`https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on WhatsApp
        </a>
      </div>
    </div>
  );
}
