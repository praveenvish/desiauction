/**
 * Does this text hold Devanagari? A layout asks before setting a Hindi line as
 * tight as a Latin one: Devanagari carries marks ABOVE its headline (ि's loop,
 * a reph, the anusvara dot) that Latin capitals never have.
 */
export function hasDevanagari(text: string): boolean {
  return /\p{Script=Devanagari}/u.test(text);
}
