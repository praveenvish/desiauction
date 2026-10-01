import { notFound, redirect } from "next/navigation";

import { venuesView } from "../../../../server/competition/fixture-actions";

export const metadata = { title: "Venues" };

/**
 * Venues is a tab on the club page now (2026-09-27). This address stays, because
 * the schedule, the readiness centre and the fixture planner all link to it —
 * it answers exactly as before for anyone who may not manage venues (404: this
 * is a management desk, absent rather than locked) and sends everyone else to
 * the tab.
 */
export default async function VenuesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await venuesView(slug);
  if (view === null || !view.viewer.canManage) {
    notFound();
  }
  redirect(`/org/${slug}#venues`);
}
