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
import { useEffect, useState } from "react";

import { useOrigin } from "../../../../lib/use-hydrated";
import type { StreamKit } from "../../../../server/competition/stream-kit";
import { streamKitView } from "../../../../server/competition/stream-kit-actions";
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

  async function copy(text: string, copied: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: copied, tone: "success" });
    } catch {
      toast({ title: "Couldn't copy — select the text and copy it manually.", tone: "danger" });
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
      concept="neutral"
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
            onClick={() =>
              void copy(pane.url, `${pane.what} link copied — paste it where it needs to run`)
            }
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
        {screen === "overlay" ? <StreamDescription slug={slug} copy={copy} /> : null}
      </div>
    </SectionCard>
  );
}

/**
 * THE YOUTUBE TEXT FOR THE STREAM (SEO-1 Phase 7, docs/seo/OUTREACH-KIT.md §3).
 *
 * Shown with the overlay, because that is the moment an organizer is setting up
 * a stream. The description links to the season's public page: viewers find the
 * squads there, and the link is a backlink from a real channel. Loaded once,
 * when the pane first opens; an unpublished season gets a note instead, because
 * its public page does not exist and the link would be dead.
 */
function StreamDescription({
  slug,
  copy,
}: {
  slug: string;
  copy: (text: string, copied: string) => Promise<void>;
}) {
  const [kit, setKit] = useState<StreamKit | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    streamKitView(slug)
      .then((result) => {
        if (live) setKit(result);
      })
      .catch(() => {
        if (live) setKit(null);
      });
    return () => {
      live = false;
    };
  }, [slug]);

  if (kit === undefined) {
    return null;
  }
  if (kit === null) {
    return (
      <p className="bc-note" data-testid="stream-kit-unpublished">
        Streaming on YouTube? Publish the season first, and a ready-made description that links
        viewers to its public page appears here.
      </p>
    );
  }
  return (
    <div className="bc-kit" data-testid="stream-kit">
      <h3 className="bc-kit-title">For your YouTube stream</h3>
      <div className="bc-url-row">
        <code className="bc-url" data-testid="stream-kit-title">
          {kit.title}
        </code>
        <Button
          variant="secondary"
          size="sm"
          data-testid="copy-stream-title"
          onClick={() => void copy(kit.title, "Title copied — paste it into YouTube")}
        >
          <IconCopy size={16} />
          Copy title
        </Button>
      </div>
      <pre className="bc-kit-text" data-testid="stream-kit-description">
        {kit.description}
      </pre>
      <div className="bc-kit-actions">
        <Button
          variant="secondary"
          size="sm"
          data-testid="copy-stream-description"
          onClick={() => void copy(kit.description, "Description copied — paste it into YouTube")}
        >
          <IconCopy size={16} />
          Copy description
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="copy-stream-comment"
          onClick={() => void copy(kit.pinnedComment, "Comment copied — pin it once you're live")}
        >
          <IconCopy size={16} />
          Copy pinned comment
        </Button>
      </div>
      <p className="bc-note">
        Paste the description into the stream&apos;s YouTube description, and pin the comment once
        you&apos;re live.
      </p>
    </div>
  );
}
