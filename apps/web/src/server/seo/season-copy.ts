/**
 * A PUBLIC SEASON'S TITLE AND DESCRIPTION, WRITTEN FOR SEARCH (SEO-1 Phase 5).
 *
 * People search for a league the way they talk about it: "VPL 2026 auction",
 * "‹league› squads", "‹league› points table". The title says which of those
 * the page answers AT THIS POINT IN THE SEASON — registration first, then the
 * squads and results — and adds the year and the word "auction" only when the
 * season's own name does not already carry them.
 *
 * The description is built from facts the page itself shows: who runs it,
 * where, when, how many teams, and — once the auction is over — which team
 * paid the top price. Never a player's name: the page shows top buys by name,
 * but a search snippet travels further than a page, and a price and a team
 * answer the searcher just as well.
 *
 * Pure, so the wording is tested without a database.
 */
const MAX = 160;

export interface SeasonCopyInput {
  readonly name: string;
  readonly orgName: string;
  /** The sport's label ("Cricket"). */
  readonly sport: string;
  readonly location: string | null;
  readonly startsOn: string | null;
  /** The season's dates, as the page prints them ("1 – 30 Oct 2026"). */
  readonly dates: string;
  readonly open: boolean;
  readonly auctionDone: boolean;
  readonly teamCount: number;
  /** The top buy's team and price, formatted — present only after the auction. */
  readonly topBuy: { readonly teamName: string; readonly price: string } | null;
}

function base(input: SeasonCopyInput): string {
  const year = input.startsOn?.slice(0, 4) ?? null;
  return year !== null && !input.name.includes(year) ? `${input.name} ${year}` : input.name;
}

export function seasonTitle(input: SeasonCopyInput): string {
  const name = base(input);
  const saysAuction = /auction/i.test(input.name);
  if (input.auctionDone) {
    return saysAuction
      ? `${name} — teams, squads & results`
      : `${name} auction — teams, squads & results`;
  }
  if (input.open) return `${name} — player registration & auction`;
  return saysAuction ? `${name} — teams & players` : `${name} — teams & player auction`;
}

export function seasonDescription(input: SeasonCopyInput): string {
  const where = input.location === null ? "" : ` in ${input.location}`;
  const sentences = [
    `${input.orgName}'s ${input.sport.toLowerCase()} tournament${where}, ${input.dates}.`,
  ];
  if (input.open) sentences.push("Registration is open — sign up as a player.");
  if (input.auctionDone && input.topBuy !== null) {
    sentences.push(
      `${String(input.teamCount)} teams; ${input.topBuy.teamName} paid the top price, ${input.topBuy.price}.`,
    );
  } else if (input.teamCount > 0) {
    sentences.push(`${String(input.teamCount)} teams in the auction.`);
  }
  if (input.auctionDone) sentences.push("Squads, fixtures and the points table.");
  sentences.push("Run on DesiAuction.");

  // Whole sentences only, up to the length a result shows without cutting.
  let text = "";
  for (const sentence of sentences) {
    const next = text === "" ? sentence : `${text} ${sentence}`;
    if (next.length > MAX) break;
    text = next;
  }
  return text === "" ? (sentences[0] ?? "").slice(0, MAX) : text;
}
