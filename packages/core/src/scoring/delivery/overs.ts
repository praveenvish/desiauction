import type { InningsState } from "./state";

/** Declared umpire counts affect boundaries, never actual delivery statistics. */
export function overLength(innings: InningsState, perOver: number): number {
  return innings.miscountedOvers[String(innings.completedOvers)] ?? perOver;
}
export function actualBallLimit(
  maxBalls: number,
  perOver: number,
  declarations: Readonly<Record<string, number>>,
): number | undefined {
  const fullOvers = Math.floor(maxBalls / perOver);
  const remainder = maxBalls % perOver;
  const partialLength = declarations[String(fullOvers)] ?? perOver;
  if (remainder > partialLength) return undefined;
  let limit = maxBalls;
  for (const [index, count] of Object.entries(declarations))
    if (Number(index) < fullOvers) limit += count - perOver;
  return Number.isSafeInteger(limit) && limit > 0 ? limit : undefined;
}
export function bowlingOverCount(innings: InningsState, bowlerId: string): number {
  return innings.overs.filter((over) => over.balls.some((ball) => ball.bowlerId === bowlerId))
    .length;
}
export function canParticipateInOver(
  innings: InningsState,
  bowlerId: string,
  quota: number | null,
): boolean {
  return (
    quota === null ||
    innings.overs[innings.completedOvers]?.balls.some((ball) => ball.bowlerId === bowlerId) ===
      true ||
    bowlingOverCount(innings, bowlerId) < quota
  );
}
