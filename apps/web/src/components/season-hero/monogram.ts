/** "Vishnoi Cricket Club" → "VC". First code point of up to two words. */
export function monogram(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => {
        const first = word.codePointAt(0);
        return first === undefined ? "" : String.fromCodePoint(first);
      })
      .join("")
      .toUpperCase() || "—"
  );
}
