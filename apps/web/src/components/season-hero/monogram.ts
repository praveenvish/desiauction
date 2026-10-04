import { initialsOf } from "@desiauction/core";

/** "Vishnoi Cricket Club" → "VC". First code point of up to two words. */
export function monogram(name: string): string {
  return initialsOf(name, { words: "first-two" }) || "—";
}
