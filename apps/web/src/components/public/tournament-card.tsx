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
import {
  IconArrowRight,
  IconCalendar,
  IconChevronRight,
  IconPin,
  IconUsers,
  SportIcon,
} from "@desiauction/ui";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import "./tournament-card.css";

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
        : `${String(teamCount)} ${teamCount === 1 ? "team" : "teams"}`,
      playerCount === undefined || playerCount === 0
        ? null
        : `${String(playerCount)} ${playerCount === 1 ? "player" : "players"}`,
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

  const hasCover = coverUrl != null && coverUrl !== "";
  const hasLogo = logoUrl != null && logoUrl !== "";
  const status = live ? "Live now" : open ? "Registration open" : "Registration closed";
  const tone = live ? "live" : open ? "open" : "closed";
  const meta = [dates, location === null || location === "" ? null : location]
    .filter((part): part is string => part !== null)
    .join(" · ");

  /*
   * WOW PASS (2026-09-25). A card with no cover used to spend a 5:2 banner on
   * the sport's stock glyph — the same bat twelve times down a page, which
   * read as "no content yet". Without a cover the banner is now a 72px band
   * tinted for the sport with a small glyph; the full banner is for a real
   * photograph. The crest shows only for a real logo (initials repeated the
   * title), the sport moved into the org line, and the footer lost its rule.
   * On a phone the card is a row: thumb, name, one meta line, status.
   */
  return (
    <article
      className="tc da-lift"
      data-feature={feature ? "" : undefined}
      data-cover={hasCover ? "" : undefined}
    >
      <div className="tc-banner" data-sport={sport}>
        {hasCover ? (
          <Image
            className="tc-cover"
            src={coverUrl}
            alt=""
            width={800}
            height={320}
            // The card's rendered width, per `.tc-grid` (columns of ≥290px) inside
            // the public page's 5vw gutters: ~90vw on a phone, ~45vw on a tablet,
            // ~420px at most on a desktop. Without it the srcset offered only
            // 828w and 1920w, so every high-density phone fetched the 1920px
            // cover (156 KB) for a 369px card.
            sizes="(max-width: 660px) 90vw, (max-width: 1000px) 45vw, 420px"
          />
        ) : (
          <span className="tc-glyph" aria-hidden>
            <SportIcon sport={sport} size={28} />
          </span>
        )}
        <span className="tc-status" data-tone={tone} data-testid="tournament-card-status">
          {status}
        </span>
      </div>

      <div className="tc-body">
        <div className="tc-head">
          {hasLogo ? (
            <span className="tc-crest" aria-hidden>
              <Image src={logoUrl} alt="" width={44} height={44} />
            </span>
          ) : null}
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
            <p className="tc-org">
              <SportIcon sport={sport} size={16} className="tc-org-sport" />
              <span className="tc-sr">{sportLabel(sport)}, </span>
              <span>
                {orgName}
                {category === undefined ? null : ` · ${category}`}
              </span>
            </p>
            {/* Phone row only: one meta line and the state as a dot. */}
            <p className="tc-line">
              <span className="tc-line-dot" data-tone={tone} aria-hidden />
              <span className="tc-sr">{status}. </span>
              {meta}
            </p>
          </div>
          <IconChevronRight size={20} className="tc-chevron" />
        </div>

        <dl className="tc-facts">
          {location === null || location === "" ? null : (
            <div className="tc-fact">
              <dt>
                <IconPin size={16} aria-hidden />
                <span className="tc-sr">Where</span>
              </dt>
              <dd>{location}</dd>
            </div>
          )}
          <div className="tc-fact">
            <dt>
              <IconCalendar size={16} aria-hidden />
              <span className="tc-sr">When</span>
            </dt>
            <dd>{dates}</dd>
          </div>
          {size === null ? null : (
            <div className="tc-fact">
              <dt>
                <IconUsers size={16} aria-hidden />
                <span className="tc-sr">Size</span>
              </dt>
              <dd>{size}</dd>
            </div>
          )}
        </dl>

        <div className="tc-foot">
          <Link
            className="tc-action"
            href={action.href}
            data-primary={live || open ? "" : undefined}
          >
            {action.label}
            <IconArrowRight size={16} />
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
  className,
}: {
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={["tc-grid", className].filter(Boolean).join(" ")} data-testid={testId}>
      {children}
    </div>
  );
}
