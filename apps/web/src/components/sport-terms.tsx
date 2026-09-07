"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * WHAT THIS SEASON CALLS THINGS (SP-1 Phase 4 groundwork).
 *
 * Phase 2 gave every pack a `terms` dictionary and deliberately left it
 * unconsumed: 85 components said "player" literally and wiring a dictionary
 * nobody read would have been an abstraction pretending to be a feature. Two
 * sports later it is read, and this is what reads it.
 *
 * WHY A CONTEXT RATHER THAN PROPS. The words are needed by panels four levels
 * below the page that knows the competition — the fixtures table, the squad
 * board, the plan drawer. Threading four strings through every one of those
 * signatures is a lot of plumbing for a value that never changes within a
 * screen. The page mounts this once from the competition it has already
 * resolved; everything under it asks.
 *
 * PLAIN DATA ONLY. The pack itself carries functions (a tiebreaker's `compute`,
 * a score field's `parse`) and cannot cross into a client component — the same
 * constraint Phases 2 and 3 hit. `terms` is four strings and an array, so it
 * crosses fine, and the server keeps the behaviour.
 *
 * THE DEFAULT IS NOT "cricket", it is "unknown sport". These words happen to be
 * cricket's, because cricket's are the ordinary English ones — but a surface
 * rendering outside a season is not a cricket surface, it is one that spans
 * sports and must not claim otherwise. /home and /admin are exactly that: they
 * list seasons of every sport at once, so they keep the neutral words on
 * purpose rather than by omission.
 */
export interface SportTerms {
  /** Singular and plural: ["Player", "Players"]. */
  readonly participant: readonly [string, string];
  readonly squad: string;
  readonly fixture: string;
  readonly ground: string;
}

const NEUTRAL: SportTerms = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Match",
  ground: "Ground",
};

const SportTermsContext = createContext<SportTerms>(NEUTRAL);

export function SportTermsProvider({
  terms,
  children,
}: {
  terms: SportTerms;
  children: ReactNode;
}) {
  return <SportTermsContext.Provider value={terms}>{children}</SportTermsContext.Provider>;
}

/**
 * This season's words. Outside a provider it returns the neutral set rather
 * than throwing: a shared panel rendered on a platform surface has no one sport
 * to speak for, and that is a real state, not a mistake.
 */
export function useSportTerms(): SportTerms {
  return useContext(SportTermsContext);
}
