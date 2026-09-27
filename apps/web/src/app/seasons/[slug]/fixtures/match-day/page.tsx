import { redirect } from "next/navigation";

/**
 * Match day became the Matches screen, which opens on today and filters by
 * ground (2026-09-27). Old links land on the same day there.
 */
export default async function MatchDayPage({
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
