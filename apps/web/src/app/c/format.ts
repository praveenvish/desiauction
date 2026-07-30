/**
 * Month names are OURS, not the ICU locale's. `toLocaleDateString("en-IN", {
 * month: "short" })` returns a FOUR letter "Sept" for September while every
 * other month comes back at three, so a range straddling it rendered
 * "1 Aug – 15 Sept 2026" — two abbreviation styles inside one string. Dates are
 * the fact guests scan hardest on a card; the format has to be one shape.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "2026-08-01".."2026-09-15" → "1 Aug – 15 Sep 2026" (IST-implied, doc 05). */
export function formatDateRange(startsOn: string | null, endsOn: string | null): string {
  const fmt = (iso: string, withYear: boolean): string => {
    const [y, m, d] = iso.split("-");
    const month = MONTHS[Number(m) - 1] ?? "";
    const day = String(Number(d));
    return withYear ? `${day} ${month} ${y ?? ""}` : `${day} ${month}`;
  };
  if (startsOn === null && endsOn === null) {
    return "Dates to be announced";
  }
  if (startsOn !== null && endsOn !== null) {
    const sameYear = startsOn.slice(0, 4) === endsOn.slice(0, 4);
    return `${fmt(startsOn, !sameYear)} – ${fmt(endsOn, true)}`;
  }
  return fmt((startsOn ?? endsOn) as string, true);
}
