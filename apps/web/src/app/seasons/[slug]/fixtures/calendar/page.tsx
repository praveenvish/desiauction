import { redirect } from "next/navigation";

/**
 * The calendar became the Matches screen's week strip (2026-09-27). Old links —
 * bookmarks, messages, `?date=` — land on the same week there.
 */
export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const [{ slug }, { date }] = await Promise.all([params, searchParams]);
  redirect(
    `/seasons/${slug}/fixtures${date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ""}`,
  );
}
