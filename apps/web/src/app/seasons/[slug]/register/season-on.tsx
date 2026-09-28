import { ButtonLink, Card, IconArrowRight, PlayerImage, paintOnFill } from "@desiauction/ui";
import Link from "next/link";

/**
 * THE PLAYER'S SEASON, ONCE IT IS ON (2026-09-29).
 *
 * Every door to a player's season — home's "My seasons" row, the hero's "Your
 * season" — lands on /seasons/[slug]/register, and weeks into the season it
 * still read as a receipt of auction night: "Player registration", a gold
 * slab of a price, and nothing about the matches actually being played. Once
 * the player is signed and the club has published a match for their team,
 * the page is their season instead: who they play for and where that team
 * stands, the next match, the results, and the price as one figure beside
 * them rather than the page's headline.
 *
 * Presentational (no server imports), like the status panel it replaces for
 * this one state: the page resolves everything from the player's own row.
 */

export interface SeasonOnMatch {
  fixtureId: string;
  /** "Sun, 4 Oct" — already in words. */
  dayLabel: string;
  /** The tile: weekday, day and month. */
  tile: { weekday: string; day: string; month: string } | null;
  /** "3:00 pm", or null when the kickoff has no time. */
  time: string | null;
  opponentName: string;
  groundName: string | null;
  live: boolean;
  result: "won" | "lost" | "tied" | "no_result" | null;
}

export interface SeasonOnView {
  teamName: string;
  teamColor: string | null;
  /** "1st of 3 · 4 pts", or null for a lobby-shaped sport or before any team plays. */
  place: string | null;
  squadCount: number | null;
  next: SeasonOnMatch | null;
  /** Newest first, at most three. */
  results: SeasonOnMatch[];
  record: { played: number; won: number };
  toCome: number;
}

const RESULT_MARK = { won: "W", lost: "L", tied: "T", no_result: "NR" } as const;
const RESULT_WORD = { won: "Won", lost: "Lost", tied: "Tied", no_result: "No result" } as const;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "?").slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

export function SeasonOn({
  view,
  slug,
  listed,
  number,
  name,
  photoUrl,
  roleLabel,
  signedLabel,
  priceLabel,
  squadHref,
  orgName,
}: {
  view: SeasonOnView;
  slug: string;
  listed: boolean;
  number: string | null;
  name: string;
  photoUrl: string | null;
  roleLabel: string | null;
  /** "Sold for", or how they joined before the auction ("Captain"). */
  signedLabel: string;
  priceLabel: string | null;
  squadHref: string;
  orgName: string;
}) {
  const paint = paintOnFill(view.teamColor);
  const who = [name, roleLabel].filter((part): part is string => part !== null && part !== "");
  const teamFacts = [
    view.place,
    view.squadCount === null ? null : `${String(view.squadCount)} in the squad`,
  ].filter((part): part is string => part !== null);
  const summary = [
    `${String(view.record.played)} played`,
    `${String(view.record.won)} won`,
    view.toCome > 0 ? `${String(view.toCome)} to come` : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="reg-season" data-testid="registration-status">
      <Card className="reg-season-you" elevation="floating">
        <div className="reg-season-id">
          <span className="reg-season-photo">
            <PlayerImage
              name={name}
              size="xl"
              shape="round"
              fluid
              {...(photoUrl !== null ? { src: photoUrl } : {})}
            />
          </span>
          <div className="reg-season-who">
            {who.length > 0 ? <p className="reg-season-name">{who.join(" · ")}</p> : null}
            <h2 id="reg-season-team" className="reg-season-team">
              <span
                className="reg-season-crest"
                style={{ background: paint.background, color: paint.color }}
                aria-hidden
              >
                {initials(view.teamName)}
              </span>
              {view.teamName}
            </h2>
            {teamFacts.length > 0 ? (
              <p className="reg-season-facts" data-testid="my-team-place">
                {teamFacts.join(" · ")}
              </p>
            ) : null}
          </div>
          <p className="reg-season-price" data-testid="my-sold-price">
            <span className="reg-season-price-label">{signedLabel}</span>
            {priceLabel !== null ? (
              <strong className="reg-season-price-figure">{priceLabel}</strong>
            ) : null}
          </p>
        </div>
        <div className="reg-status-actions" data-testid="my-auction-result">
          <ButtonLink href={squadHref} size="touch" data-testid="see-my-squad">
            See your squad
          </ButtonLink>
          {listed && number !== null ? (
            <ButtonLink
              href={`/c/${slug}/p/${number}#share-heading`}
              size="touch"
              variant="secondary"
              data-testid="share-my-card"
            >
              Share my card
            </ButtonLink>
          ) : null}
        </div>
      </Card>

      <Card className="reg-season-matches" data-testid="my-season-matches">
        <div className="reg-season-head">
          <h2 id="reg-season-matches-title">Your matches</h2>
          {listed ? (
            <Link href={`/c/${slug}#season-heading`} className="reg-season-link">
              All matches
              <IconArrowRight size={14} aria-hidden />
            </Link>
          ) : null}
        </div>
        {view.next !== null ? (
          <div className="reg-season-next" data-theme="floodlight" data-testid="my-next-match">
            {view.next.tile !== null ? (
              <span className="reg-season-tile" aria-hidden>
                <span>{view.next.tile.weekday}</span>
                <strong>{view.next.tile.day}</strong>
                <span>{view.next.tile.month}</span>
              </span>
            ) : null}
            <span className="reg-season-next-text">
              <span className="reg-season-next-kicker">
                {view.next.live ? "Playing now" : "Next match"}
              </span>
              <strong>vs {view.next.opponentName}</strong>
              <span className="reg-season-next-meta">
                {[
                  view.next.tile === null ? view.next.dayLabel : null,
                  view.next.time,
                  view.next.groundName,
                ]
                  .filter((part): part is string => part !== null && part !== "")
                  .join(" · ")}
              </span>
            </span>
          </div>
        ) : null}
        {view.results.length > 0 ? (
          <ol className="reg-season-results">
            {view.results.map((match) => (
              <li key={match.fixtureId}>
                <span className="reg-season-day">{match.dayLabel}</span>
                <span className="reg-season-vs">vs {match.opponentName}</span>
                {match.result !== null ? (
                  <span
                    className="reg-season-mark"
                    data-result={match.result}
                    role="img"
                    aria-label={RESULT_WORD[match.result]}
                    title={RESULT_WORD[match.result]}
                  >
                    {RESULT_MARK[match.result]}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        <p className="reg-season-summary">{summary.join(" · ")}</p>
      </Card>

      <Card className="reg-season-foot">
        {listed && number !== null ? (
          <div className="reg-season-public" data-testid="my-public-page">
            <span>
              <strong>Your public player page</strong>
              <span>Name, role, photo and your team — never your mobile number.</span>
            </span>
            <Link className="reg-status-public-url" href={`/c/${slug}/p/${number}`}>
              Open your player page
              <IconArrowRight size={14} />
            </Link>
          </div>
        ) : null}
        <p className="reg-season-contact register-hint" data-testid="drop-out-contact">
          Something wrong? Contact {orgName}
          {number === null ? "" : ` and quote registration ${number}`}.
        </p>
      </Card>
    </div>
  );
}
