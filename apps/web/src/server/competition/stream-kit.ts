/**
 * THE STREAM KIT (SEO-1 Phase 7, docs/seo/OUTREACH-KIT.md §3).
 *
 * The text an organizer pastes into YouTube when they stream the auction with
 * the overlay. Its link to the season's public page is a backlink from a real
 * channel, and it sends viewers to the page where the squads end up.
 *
 * Built only from what the public season page already shows, because it is
 * going to be published on YouTube. That is also why the reader returns null for
 * an unpublished season: its page is a 404, so the link would be dead.
 *
 * Pure, so the wording is tested without a database.
 */
export interface StreamKitInput {
  readonly name: string;
  readonly slug: string;
  /** The venue's city, else the season's free-text location. */
  readonly place: string | null;
  readonly teamCount: number;
  /** `env.PUBLIC_BASE_URL`, no trailing slash. */
  readonly base: string;
}

export interface StreamKit {
  readonly title: string;
  readonly description: string;
  readonly pinnedComment: string;
  readonly seasonUrl: string;
}

/** YouTube refuses a title over 100 characters. */
export const YOUTUBE_TITLE_LIMIT = 100;

export function streamKit(input: StreamKitInput): StreamKit {
  const name = input.name.trim();
  const place = input.place?.trim() ?? "";
  const seasonUrl = `${input.base}/c/${input.slug}`;

  const suffix = ` Player Auction LIVE${place === "" ? "" : ` | ${place}`}`;
  const room = YOUTUBE_TITLE_LIMIT - suffix.length;
  const title =
    name.length <= room
      ? `${name}${suffix}`
      : `${name.slice(0, Math.max(0, room - 1)).trimEnd()}…${suffix}`;

  const teams =
    input.teamCount > 0
      ? `${String(input.teamCount)} ${input.teamCount === 1 ? "team" : "teams"}. Every bid, every SOLD, as it happens.`
      : "Every bid, every SOLD, as it happens.";

  const description = [
    `${name}: the player auction, live.`,
    teams,
    `Teams, squads and results: ${seasonUrl}`,
    `Auction run on DesiAuction: ${input.base}`,
  ].join("\n\n");

  return {
    title,
    description,
    pinnedComment: `Final squads and every sale are on the season page: ${seasonUrl}`,
    seasonUrl,
  };
}
