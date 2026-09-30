import { compactFloorINR, exactINR } from "../lib/inr";

/**
 * THE HOME PAGE'S ONE EXAMPLE AUCTION.
 *
 * Every section of the landing tells the same night: the hero's broadcast, the
 * scroll-clock, the four seats and the season's career card all name the same
 * league, lot, player and price. A visitor who saw "Riya" sold for one price in
 * one section and "Aniket" for another in the next stopped trusting the page
 * (founder, 2026-09-30) — so the facts live here, once.
 *
 * It matches the real screenshots on the page (public/marketing/product/*,
 * captured from a practice auction by scripts/capture-marketing-screens.ts):
 * Sunday Smashers League, 17 lots, Aniket Sawant sold to Falcons for
 * ₹85,000, 5 of 17 sold when the board is shown. Everyone is fictional and the
 * page says so wherever a name appears.
 */

export const LEAGUE = {
  name: "Sunday Smashers League",
  lots: 17,
  purse: 500000,
  sport: "Cricket",
} as const;

export interface StoryTeam {
  name: string;
  initial: string;
  /** The team's colour on the board and in the broadcast strip. */
  color: string;
}

export const TEAMS: readonly StoryTeam[] = [
  { name: "Falcons", initial: "F", color: "#E6B24A" },
  { name: "Voyagers", initial: "V", color: "#6FA8FF" },
  { name: "Titans", initial: "T", color: "#FF7A66" },
  { name: "Strikers", initial: "S", color: "#B69CFF" },
];

export interface StoryPlayer {
  initials: string;
  name: string;
  role: string;
  /** Base price in rupees. */
  base: number;
  /** A headshot from the hero photograph, for the four players in it. */
  face?: string;
}

/** The pool, in lot order where the story needs it. */
export const POOL: readonly StoryPlayer[] = [
  {
    initials: "AS",
    name: "Aniket Sawant",
    role: "All-rounder",
    base: 20000,
    face: "/marketing/faces/aniket.webp",
  },
  {
    initials: "RM",
    name: "Riya Mehta",
    role: "Batter",
    base: 20000,
    face: "/marketing/faces/riya.webp",
  },
  {
    initials: "NK",
    name: "Neel Kapoor",
    role: "Batter",
    base: 15000,
    face: "/marketing/faces/neel.webp",
  },
  {
    initials: "PJ",
    name: "Pooja Joshi",
    role: "Bowler",
    base: 15000,
    face: "/marketing/faces/pooja.webp",
  },
  { initials: "OM", name: "Om Mishra", role: "Keeper", base: 15000 },
  { initials: "KS", name: "Kiran Shah", role: "Bowler", base: 10000 },
  { initials: "VD", name: "Vikram Desai", role: "All-rounder", base: 15000 },
  { initials: "AB", name: "Arjun Bhat", role: "Batter", base: 10000 },
  { initials: "MT", name: "Meera Thakur", role: "All-rounder", base: 15000 },
  { initials: "RS", name: "Rohan Singh", role: "Bowler", base: 10000 },
  { initials: "YP", name: "Yash Patil", role: "Batter", base: 10000 },
  { initials: "HG", name: "Harsh Gupta", role: "Keeper", base: 10000 },
  { initials: "SK", name: "Sana Khan", role: "Bowler", base: 10000 },
  { initials: "DV", name: "Dev Verma", role: "Batter", base: 10000 },
  { initials: "JN", name: "Jai Nair", role: "All-rounder", base: 10000 },
  { initials: "TR", name: "Tara Reddy", role: "Bowler", base: 10000 },
  { initials: "LC", name: "Lakshya Chawla", role: "Batter", base: 10000 },
];

const byName = (name: string): StoryPlayer => {
  const player = POOL.find((entry) => entry.name === name);
  if (player === undefined) throw new Error(`home-story: no player ${name}`);
  return player;
};

/** The lot the whole page follows: on air in the hero, sold at 7:42 pm. */
export const STAR_LOT = {
  lot: 3,
  player: byName("Aniket Sawant"),
  /** The bids, in order, and who made each one (the hero and the clock agree). */
  bids: [
    { amount: 20000, team: null },
    { amount: 35000, team: "Voyagers" },
    { amount: 50000, team: "Falcons" },
    { amount: 70000, team: "Titans" },
    { amount: 85000, team: "Falcons" },
  ],
  soldTo: "Falcons",
  price: 85000,
} as const;

/** The lot on the block when the page shows the four seats (after 5 sales). */
export const LIVE_LOT = {
  lot: 6,
  player: byName("Riya Mehta"),
  bid: 45000,
  leader: "Falcons",
  next: [
    { lot: 7, player: byName("Neel Kapoor") },
    { lot: 8, player: byName("Om Mishra") },
    { lot: 9, player: byName("Pooja Joshi") },
  ],
  sold: 5,
} as const;

/** Purses in rupees before and after the star lot (the broadcast strip). */
export const PURSES: Readonly<Record<string, { before: number; after?: number }>> = {
  Falcons: { before: 485000, after: 400000 },
  Voyagers: { before: 470000 },
  Titans: { before: 470000 },
  Strikers: { before: 500000 },
};

/** A price on the page, through the product's one rupee formatter. */
export function price(rupeesAmount: number): string {
  return exactINR(rupeesAmount * 100);
}

/** Purse LEFT, rounded down like every purse in the product ("₹4.85 L"). */
export function purseLeft(rupeesAmount: number): string {
  return compactFloorINR(rupeesAmount * 100);
}
