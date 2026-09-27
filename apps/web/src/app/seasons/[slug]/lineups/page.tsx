import { redirect } from "next/navigation";

/**
 * Lineups moved into each match's panel on the Matches screen (2026-09-27): a
 * lineup is recorded per match, beside its score. `?fixture=` opens that match.
 */
export default async function LineupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ fixture?: string }>;
}) {
  const [{ slug }, { fixture }] = await Promise.all([params, searchParams]);
  redirect(
    `/seasons/${slug}/fixtures${fixture !== undefined && /^[0-9a-f-]{36}$/i.test(fixture) ? `?match=${fixture}` : ""}`,
  );
}
