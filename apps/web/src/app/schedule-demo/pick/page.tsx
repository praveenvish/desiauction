import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { demoBookings, demoRequests } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

import { SlotPicker } from "../../../components/marketing/slot-picker";
import { db } from "../../../server/db";
import { bookableDays } from "../../../server/marketing/demo-slots";
import "../../content.css";
import "../demo.css";

/** Never indexed: it is one person's booking flow, not a page with an audience. */
export const metadata: Metadata = {
  title: "Pick a time · DesiAuction",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * PICKING A TIME FOR A REQUEST THAT ALREADY EXISTS.
 *
 * The request id is in the query string, which is the honest reading of what it
 * is: a pointer to a row somebody just created in this same session, not a
 * credential. It confers nothing — every field it could reveal is a field the
 * same person typed a moment ago, and booking against it produces a token that
 * IS a credential and travels in a path segment.
 *
 * NO `loading.tsx` MAY BE ADDED ABOVE THIS ROUTE. A Suspense boundary over a
 * gated page commits a 200 before the gate runs, which turns `notFound()` and
 * `redirect()` into a flash of a page that should never have rendered. Gate
 * first, then stream.
 */
export default async function PickTimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params["r"];
  const requestId = typeof raw === "string" ? raw : null;
  if (requestId === null || requestId.length !== 26) {
    notFound();
  }

  const [request] = await db
    .select({ id: demoRequests.id, name: demoRequests.name })
    .from(demoRequests)
    .where(eq(demoRequests.id, requestId))
    .limit(1);
  if (request === undefined) {
    notFound();
  }

  // Already has a time? Send them to the booking itself rather than letting
  // them make a second one they will then have to reconcile.
  const [live] = await db
    .select({ id: demoBookings.id })
    .from(demoBookings)
    .where(and(eq(demoBookings.demoRequestId, requestId), isNull(demoBookings.cancelledAt)))
    .limit(1);
  if (live !== undefined) {
    redirect("/schedule-demo/booked");
  }

  const days = await bookableDays();

  return (
    <main className="content-page content-narrow">
      <h1>Pick a time</h1>
      {days.length === 0 ? (
        <>
          <p className="content-lead">
            Nothing free in the next fortnight — which is a good sign for the platform and an
            annoying one for you.
          </p>
          <p className="prose-p">
            We have your request and we&apos;ll come back to you within a working day with times
            that work. In the meantime you can{" "}
            <Link href="/login" className="prose-link">
              start your auction
            </Link>{" "}
            — it&apos;s free during beta, and you don&apos;t need us to begin.
          </p>
        </>
      ) : (
        <>
          <p className="content-lead">
            Half an hour, {request.name.split(" ")[0] ?? "on"} — we&apos;ll call the number you gave
            us and walk through a real auction end to end.
          </p>
          <SlotPicker days={days} requestId={requestId} submitLabel="Book this time" />
        </>
      )}
    </main>
  );
}
