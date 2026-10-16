/**
 * WHAT THE GOLD STRIP UNDER THE HERO SAYS — pure, so the words are tested.
 *
 * Every item is one fact, in sentence case (the strip sets them in capitals
 * with CSS, so a screen reader hears words, not letters), joined inside an
 * item by " · " and between items by the strip's own separator. Rules it used
 * to break:
 *
 *   - It said "● Live on DesiAuction" over seasons that were only PUBLISHED.
 *     A red-dot "live" is a claim that an auction is running right now, and
 *     nothing here knows that. The lead is now "On DesiAuction", which is what
 *     the list actually is.
 *   - "12 sports" was followed by all twelve names, the longest item on the
 *     strip saying the same thing twice. It is one item: the count, three
 *     names, and how many more.
 *   - "1 teams". Counts agree with their nouns.
 */

export interface TickerEntry {
  readonly name: string;
  readonly location: string | null;
  readonly orgName: string;
  readonly playerCount: number;
  readonly teamCount: number;
}

/** How many sports the strip names before "and N more". */
const SPORTS_NAMED = 3;

const count = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

export interface Ticker {
  /** The lead label, shown only when there are real seasons to lead into. */
  readonly lead: string | null;
  readonly items: readonly string[];
}

export function tickerItems(entries: readonly TickerEntry[], sports: readonly string[]): Ticker {
  const named = sports.slice(0, SPORTS_NAMED);
  const more = sports.length - named.length;
  const sportsLine =
    more > 0
      ? `${count(sports.length, "sport", "sports")} · ${named.join(", ")} and ${String(more)} more`
      : `${count(sports.length, "sport", "sports")} · ${named.join(", ")}`;
  return {
    lead: entries.length > 0 ? "On DesiAuction" : null,
    items: [
      ...entries.map((entry) =>
        [
          entry.name,
          entry.location ?? entry.orgName,
          count(entry.playerCount, "player", "players"),
          count(entry.teamCount, "team", "teams"),
        ].join(" · "),
      ),
      sportsLine,
      "Free during beta",
      "No app to install",
    ],
  };
}
