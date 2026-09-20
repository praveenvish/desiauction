/**
 * "YOUR MENU JUST CHANGED, AND HERE IS WHY" (RN-1 §3.6).
 *
 * The menu is built from what a person does, so accepting a team invite, being
 * appointed auctioneer, or being handed staff all rearrange it between one
 * page load and the next. Silent rearrangement is the confusion this whole
 * programme set out to remove: somebody who has never seen "My team" before
 * has no way to know whether it is new, or whether they had simply missed it.
 *
 * So the product says it once, names the item, and never mentions it again.
 *
 * Pure, because which change earns a sentence is a product decision and
 * belongs where a test can pin it. The "have you seen this" store is
 * device-local (localStorage) on purpose: it is a courtesy, not state anybody
 * else needs, and a second device announcing it a second time is a far smaller
 * failure than a migration for a sentence.
 */

export type RoleToken = "organizer" | "owner" | "auctioneer" | "player";

/** The order the rail uses, so the sentence and the menu agree. */
const ORDER: RoleToken[] = ["owner", "auctioneer", "organizer", "player"];

const ANNOUNCEMENT: Record<RoleToken, { title: string; item: string }> = {
  owner: { title: "You're now a team owner", item: "My team" },
  auctioneer: { title: "You're now an auctioneer", item: "Auction nights" },
  organizer: { title: "You can now run tournaments", item: "Tournaments" },
  player: { title: "You're registered to play", item: "My sports" },
};

export interface RoleChange {
  title: string;
  /** The menu item this added — named, so it can be looked for. */
  item: string;
  /** All the tokens now held, to store as "seen". */
  signature: string;
}

export function signatureOf(tokens: readonly RoleToken[]): string {
  return ORDER.filter((token) => tokens.includes(token)).join(",");
}

/**
 * What to announce, or null.
 *
 * `seen` is null on a device that has never stored one — a first visit, a new
 * browser, cleared storage. That is deliberately SILENT: with no previous
 * state there is no change to report, and announcing "you're now a team owner"
 * to somebody who has owned that team for a month is worse than saying nothing.
 *
 * Only ADDITIONS are announced. Losing a role is a real event, but it is the
 * revoking organizer's to explain, not a toast's — and a menu item quietly
 * disappearing is not a thing anybody hunts for.
 *
 * Several at once collapse to the most urgent, in the rail's own order: two
 * sentences about a menu is a worse menu.
 */
export function roleChangeFor(held: readonly RoleToken[], seen: string | null): RoleChange | null {
  const signature = signatureOf(held);
  if (seen === null || seen === signature) {
    return null;
  }
  const before = new Set(seen.split(",").filter(Boolean));
  const added = ORDER.filter((token) => held.includes(token) && !before.has(token));
  const first = added[0];
  if (first === undefined) {
    return null;
  }
  return { ...ANNOUNCEMENT[first], signature };
}
