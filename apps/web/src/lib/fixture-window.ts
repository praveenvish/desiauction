const WALL = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
function wallDate(iso: string): string {
  return WALL.format(new Date(`${iso}T00:00:00Z`));
}

/**
 * "6 matches need 6 match days at 1 per day, but the season runs 19 Sept –
 * 21 Sept. Add kickoff times …" — what is wrong AND the three ways to fix it.
 */
export function outsideWindowMessage(miss: {
  startsOn: string | null;
  endsOn: string | null;
  firstDate: string;
  lastDate: string;
  daysNeeded: number;
  perDay: number;
}): string {
  const season =
    miss.startsOn !== null && miss.endsOn !== null
      ? `${wallDate(miss.startsOn)} – ${wallDate(miss.endsOn)}`
      : miss.startsOn !== null
        ? `from ${wallDate(miss.startsOn)}`
        : `until ${miss.endsOn !== null ? wallDate(miss.endsOn) : ""}`;
  if (miss.endsOn !== null && miss.firstDate > miss.endsOn) {
    return `The schedule would start on ${wallDate(miss.firstDate)}, after the season ends (${season}). Pick a start date inside the season.`;
  }
  if (miss.startsOn !== null && miss.firstDate < miss.startsOn) {
    return `The schedule would start on ${wallDate(miss.firstDate)}, before the season begins (${season}). Pick a start date on or after ${wallDate(miss.startsOn)}.`;
  }
  return `This schedule needs ${String(miss.daysNeeded)} match day${miss.daysNeeded === 1 ? "" : "s"} (${String(miss.perDay)} match${miss.perDay === 1 ? "" : "es"} a day) and would run to ${wallDate(miss.lastDate)}, but the season is ${season}. Add more kickoff times (e.g. 10:00, 14:00, 18:00), tick more grounds, or extend the season's dates.`;
}
