"use client";

import { Card, Field, useToast } from "@desiauction/ui";
import { useEffect, useState } from "react";

/**
 * THE WAY IN TO THE BROADCAST SURFACES (DA-20).
 *
 * `/auction/board` (the venue projector) and `/auction/overlay` (the OBS
 * lower-third) were not linked from anywhere in the product. A grep for either
 * path across the whole app returned three hits: one prose comment in
 * marketing copy and two routing assertions in a unit test. The 850-line
 * cockpit rendered no outbound anchors at all. Two surfaces built for the
 * largest audience of the night were, in practice, unshipped — reachable only
 * by an organizer who happened to type the URL.
 *
 * They are also surfaces you OPEN SOMEWHERE ELSE: on the projector laptop, in
 * OBS's browser-source dialog. So a link alone is not enough — the URL has to
 * be copyable, and the overlay's `?sponsor=` parameter has to be settable
 * without knowing that query strings exist.
 */
export function BroadcastLinks({ slug }: { slug: string }) {
  const toast = useToast();
  const [origin, setOrigin] = useState("");
  const [sponsor, setSponsor] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const boardUrl = `${origin}/seasons/${slug}/auction/board`;
  const trimmedSponsor = sponsor.trim();
  const overlayUrl =
    trimmedSponsor === ""
      ? `${origin}/seasons/${slug}/auction/overlay`
      : `${origin}/seasons/${slug}/auction/overlay?sponsor=${encodeURIComponent(trimmedSponsor)}`;

  async function copy(url: string, what: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: `${what} link copied — paste it where it needs to run`, tone: "success" });
    } catch {
      toast({ title: "Couldn't copy — select the address and copy it manually.", tone: "danger" });
    }
  }

  return (
    <Card data-testid="broadcast-links">
      <h2>Screens for the room</h2>
      <p className="competitions-hint">
        Two chrome-free surfaces fed by the same live snapshot as this page. Open them on the
        projector laptop and in your streaming software.
      </p>

      <div className="broadcast-row" data-testid="broadcast-board">
        <div className="broadcast-row-main">
          <h3 className="broadcast-row-title">Venue board</h3>
          <p className="broadcast-row-note">
            The projector screen: who is on the block, the price, the clock, every purse.
          </p>
          <code className="broadcast-url" data-testid="broadcast-board-url">
            {boardUrl}
          </code>
        </div>
        <div className="broadcast-row-actions">
          <a
            className="share-auction-button"
            href={`/seasons/${slug}/auction/board`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-board"
          >
            Open board
          </a>
          <button
            type="button"
            className="share-auction-button"
            data-testid="copy-board-url"
            onClick={() => void copy(boardUrl, "Board")}
          >
            Copy link
          </button>
        </div>
      </div>

      <div className="broadcast-row" data-testid="broadcast-overlay">
        <div className="broadcast-row-main">
          <h3 className="broadcast-row-title">Broadcast overlay</h3>
          <p className="broadcast-row-note">
            A transparent lower-third for OBS or any streaming tool — add it as a Browser source.
          </p>
          <Field
            label="Sponsor credit (optional)"
            help="Printed as “Presented by …” on the stream."
            value={sponsor}
            onChange={(event) => {
              setSponsor(event.target.value);
            }}
            data-testid="overlay-sponsor"
          />
          <code className="broadcast-url" data-testid="broadcast-overlay-url">
            {overlayUrl}
          </code>
        </div>
        <div className="broadcast-row-actions">
          <a
            className="share-auction-button"
            href={
              trimmedSponsor === ""
                ? `/seasons/${slug}/auction/overlay`
                : `/seasons/${slug}/auction/overlay?sponsor=${encodeURIComponent(trimmedSponsor)}`
            }
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-overlay"
          >
            Open overlay
          </a>
          <button
            type="button"
            className="share-auction-button"
            data-testid="copy-overlay-url"
            onClick={() => void copy(overlayUrl, "Overlay")}
          >
            Copy link
          </button>
        </div>
      </div>
    </Card>
  );
}
