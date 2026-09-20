"use client";

import {
  Button,
  Field,
  IconCopy,
  IconExternal,
  IconTv,
  SectionCard,
  useToast,
} from "@desiauction/ui";
import { useState } from "react";

import { useOrigin } from "../../../../lib/use-hydrated";
import "./dashboard.css";

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
 *
 * One screen at a time behind a two-way switch (founder mockup): the venue
 * board or the broadcast overlay, each with its address and a copy button.
 */
type Screen = "board" | "overlay";

export function BroadcastLinks({ slug }: { slug: string }) {
  const toast = useToast();
  const origin = useOrigin();
  const [sponsor, setSponsor] = useState("");
  const [screen, setScreen] = useState<Screen>("board");

  const boardPath = `/seasons/${slug}/auction/board`;
  const trimmedSponsor = sponsor.trim();
  const overlayPath =
    trimmedSponsor === ""
      ? `/seasons/${slug}/auction/overlay`
      : `/seasons/${slug}/auction/overlay?sponsor=${encodeURIComponent(trimmedSponsor)}`;

  async function copy(url: string, what: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: `${what} link copied — paste it where it needs to run`, tone: "success" });
    } catch {
      toast({ title: "Couldn't copy — select the address and copy it manually.", tone: "danger" });
    }
  }

  const pane =
    screen === "board"
      ? {
          testId: "broadcast-board",
          note: "The projector screen: who is on the block, the price, the clock, every purse. Open it on the venue laptop or TV.",
          url: `${origin}${boardPath}`,
          href: boardPath,
          urlTestId: "broadcast-board-url",
          openTestId: "open-board",
          copyTestId: "copy-board-url",
          openLabel: "Open board",
          what: "Board",
        }
      : {
          testId: "broadcast-overlay",
          note: "A transparent lower-third for OBS, vMix or any streaming tool — add it as a Browser source.",
          url: `${origin}${overlayPath}`,
          href: overlayPath,
          urlTestId: "broadcast-overlay-url",
          openTestId: "open-overlay",
          copyTestId: "copy-overlay-url",
          openLabel: "Open overlay",
          what: "Overlay",
        };

  return (
    <SectionCard
      icon={<IconTv />}
      tone="green"
      title="Screens for the room"
      description="Two chrome-free surfaces fed by the same live snapshot as this page."
      data-testid="broadcast-links"
    >
      <div className="bc-switch" role="group" aria-label="Which screen">
        <button
          type="button"
          className="bc-switch-option"
          aria-pressed={screen === "board"}
          onClick={() => {
            setScreen("board");
          }}
        >
          Venue board (TV)
        </button>
        <button
          type="button"
          className="bc-switch-option"
          aria-pressed={screen === "overlay"}
          onClick={() => {
            setScreen("overlay");
          }}
        >
          Broadcast overlay
        </button>
      </div>
      <div className="bc-pane" data-testid={pane.testId}>
        {screen === "overlay" ? (
          <Field
            label="Sponsor credit (optional)"
            help="Printed as “Presented by …” on the stream."
            value={sponsor}
            onChange={(event) => {
              setSponsor(event.target.value);
            }}
            data-testid="overlay-sponsor"
          />
        ) : null}
        <div className="bc-url-row">
          <code className="bc-url" data-testid={pane.urlTestId}>
            {pane.url}
          </code>
          <Button
            variant="secondary"
            size="sm"
            data-testid={pane.copyTestId}
            onClick={() => void copy(pane.url, pane.what)}
          >
            <IconCopy size={16} />
            Copy link
          </Button>
        </div>
        <p className="bc-note">
          {pane.note}{" "}
          <a
            className="bc-open"
            href={pane.href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={pane.openTestId}
          >
            {pane.openLabel}
            <IconExternal size={14} />
          </a>
        </p>
      </div>
    </SectionCard>
  );
}
