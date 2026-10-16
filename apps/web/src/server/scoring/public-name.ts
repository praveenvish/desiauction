import { initialsOf, isMinor } from "@desiauction/core";

/** A public identity is conservative when the match date cannot establish age. */
export function publicName(
  person: { name: string | null },
  registration: { dateOfBirth: string | null },
  matchDate: Date | null,
) {
  const shown = person.name ?? "Player";
  const initials = initialsOf(shown) || "?";
  const minor = matchDate === null || isMinor(registration.dateOfBirth, matchDate);
  return { name: minor ? initials : shown, initials, minor };
}
