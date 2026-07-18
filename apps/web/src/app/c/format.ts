/** "2026-08-01".."2026-09-15" → "1 Aug – 15 Sep 2026" (IST-implied, doc 05). */
export function formatDateRange(startsOn: string | null, endsOn: string | null): string {
  const fmt = (iso: string, withYear: boolean): string => {
    const [y, m, d] = iso.split("-");
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
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
