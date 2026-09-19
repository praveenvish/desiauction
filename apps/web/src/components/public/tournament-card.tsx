/**
 * THE TOURNAMENT CARD — one card, wherever a season is offered to the public.
 *
 * It replaces two renderings of the same row: the directory's card and the
 * landing page's separate live rail. They drifted, as two renderings do — the
 * rail knew about player counts and the directory did not, the directory knew
 * about live auctions and the rail did not — so a visitor saw the same season
 * described differently one click apart.
 *
 * What the card may show is bounded by what a stranger is allowed to know: the
 * public read model (`server/competition/public.ts`) decides that, and this
 * component renders only what it hands over. No phones, no money, no
 * registration lists.
 */
import { IconCalendar, IconPin, IconUsers } from "@desiauction/ui";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import "./tournament-card.css";
import { SportBanner } from "./public-kit";

export interface TournamentCardData {
  name: string;
  slug: string;
  orgName: string;
  sport: string;
  location: string | null;
  /** Already formatted for reading ("19 Sep – 21 Sep 2026"). */
  dates: string;
  /** Registration is open right now. */
  open: boolean;
  /** An auction is live or paused right now. */
  live: boolean;
  teamCount?: number;
  playerCount?: number;
  /** The organizer's crest, already signed by the media port. */
  logoUrl?: string | null;
  /** The season's cover photograph, already signed. */
  coverUrl?: string | null;
  /** Men's / Women's / Mixed. "open" renders nothing — it is the default. */
  entryCategory?: "open" | "men" | "women" | "mixed";
}

const CATEGORY_LABEL: Record<string, string> = {
  men: "Men's",
  women: "Women's",
  mixed: "Mixed",
};

/** The sport's own name for itself, title-cased for a chip. */
function sportLabel(sport: string): string {
  return sport
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Initials for a season with no crest — the same two letters the console uses. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

export function TournamentCard({
  tournament,
  /** `?ref=` is carried into the register link so share tracking survives login.
      Named `shareRef`, never `ref`: React treats a prop called `ref` as the
      element ref and it would never arrive here. */
  shareRef,
  /** The featured card on the landing page is wider and louder. */
  feature = false,
}: {
  tournament: TournamentCardData;
  shareRef?: string;
  feature?: boolean;
}) {
  const {
    name,
    slug,
    orgName,
    sport,
    location,
    dates,
    open,
    live,
    teamCount,
    playerCount,
    logoUrl,
    coverUrl,
    entryCategory,
  } = tournament;

  /**
   * How big the event is — omitting any count that is zero, and the whole row
   * when both are. "0 teams · 0 players" is true of every season on the day it
   * is published, and it reads as a failed load rather than as a new event.
   */
  const size =
    [
      teamCount === undefined || teamCount === 0
        ? null
        : `${teamCount} ${teamCount === 1 ? "team" : "teams"}`,
      playerCount === undefined || playerCount === 0
        ? null
        : `${playerCount} ${playerCount === 1 ? "player" : "players"}`,
    ]
      .filter((part): part is string => part !== null)
      .join(" • ") || null;

  const href = `/c/${slug}`;
  const category = entryCategory === undefined ? undefined : CATEGORY_LABEL[entryCategory];
  const action = live
    ? { label: "Watch live", href: `/seasons/${slug}/auction/spectate` }
    : open
      ? {
          label: "Register",
          href: `/seasons/${slug}/register${shareRef === undefined ? "" : `?ref=${shareRef}`}`,
        }
      : { label: "View tournament", href };

  return (
    <article className="tc" data-feature={feature ? "" : undefined}>
      <div className="tc-banner">
        {coverUrl == null || coverUrl === "" ? (
          <SportBanner sport={sport} seed={slug} />
        ) : (
          <Image className="tc-cover" src={coverUrl} alt="" width={800} height={320} />
        )}
        <span
          className="tc-status"
          data-tone={live ? "live" : open ? "open" : "closed"}
          data-testid="tournament-card-status"
        >
          {live ? "Live now" : open ? "Registration open" : "Registration closed"}
        </span>
      </div>

      <div className="tc-body">
        <div className="tc-head">
          <span className="tc-crest" aria-hidden>
            {logoUrl == null || logoUrl === "" ? (
              initials(name)
            ) : (
              <Image src={logoUrl} alt="" width={44} height={44} />
            )}
          </span>
          <div className="tc-title-block">
            {/* The whole card is not a link: it holds two destinations (the
                season and its action), and nesting those inside one anchor is
                what makes a card unusable with a keyboard. The heading link is
                the card's name, and the ::after stretches its hit area. */}
            <h3 className="tc-title">
              <Link className="tc-link" href={href}>
                {name}
              </Link>
            </h3>
            <p className="tc-org">{orgName}</p>
          </div>
        </div>

        <dl className="tc-facts">
          {location === null || location === "" ? null : (
            <div className="tc-fact">
              <dt>
                <IconPin width={15} height={15} aria-hidden />
                <span className="tc-sr">Where</span>
              </dt>
              <dd>{location}</dd>
            </div>
          )}
          <div className="tc-fact">
            <dt>
              <IconCalendar width={15} height={15} aria-hidden />
              <span className="tc-sr">When</span>
            </dt>
            <dd>{dates}</dd>
          </div>
          {size === null ? null : (
            <div className="tc-fact">
              <dt>
                <IconUsers width={15} height={15} aria-hidden />
                <span className="tc-sr">Size</span>
              </dt>
              <dd>{size}</dd>
            </div>
          )}
        </dl>

        <div className="tc-foot">
          <span className="tc-tags">
            <span className="tc-tag">{sportLabel(sport)}</span>
            {category === undefined ? null : <span className="tc-tag">{category}</span>}
          </span>
          <Link className="tc-action" href={action.href} data-primary={live || open ? "" : undefined}>
            {action.label}
          </Link>
        </div>
      </div>
    </article>
  );
}

/** The grid tournament cards sit in. */
export function TournamentGrid({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="tc-grid" data-testid={testId}>
      {children}
    </div>
  );
}
