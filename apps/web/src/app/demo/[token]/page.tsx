import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BookingManager } from "../../../components/marketing/booking-manager";
import { bookingByToken } from "../../../server/marketing/demo-booking";
import { whenWords } from "../../../server/marketing/demo-booking-mail";
import { bookableDays } from "../../../server/marketing/demo-slots";
import "../../content.css";
import "../../schedule-demo/demo.css";

export const metadata: Metadata = {
  title: "Your demo · DesiAuction",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * SOMEBODY'S OWN BOOKING, HELD OPEN BY A TOKEN.
 *
 * The token in the path is the whole of the authorisation — there is no session
 * here and no tenant, so RLS has no principal to key on. It is 24 random bytes
 * stored as a SHA-256 digest, checked by hash, and it lives in a PATH SEGMENT
 * rather than a query string: query strings ride `Referer` into every third
 * party a page subsequently talks to.
 *
 * NO `loading.tsx` MAY BE ADDED ABOVE THIS ROUTE — a Suspense boundary commits
 * a 200 before this gate runs, and a stranger with a wrong token would see a
 * page shell instead of a 404.
 *
 * An unknown token gets `notFound()`, not a "wrong link" message: the two are
 * the same to somebody guessing, and only one of them tells them they are close.
 */
export default async function DemoBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await bookingByToken(token);
  if (booking === null) {
    notFound();
  }

  if (booking.cancelledAt !== null) {
    return (
      <main className="content-page content-narrow">
        <h1>This demo is cancelled</h1>
        <p className="content-lead demo-cancelled">
          The call on {whenWords(booking.slotStart)} was called off
          {booking.cancelledBy === "organizer" ? " by us" : ""}, and nobody will ring.
        </p>
        <p className="prose-p">
          Want another time?{" "}
          <Link href="/schedule-demo" className="prose-link">
            Ask for a demo again
          </Link>{" "}
          — it takes a minute, and the platform is free during beta either way.
        </p>
      </main>
    );
  }

  const days = await bookableDays();

  return (
    <main className="content-page content-narrow">
      <h1>Your demo</h1>
      <div className="demo-booking-card">
        <p className="demo-when">{whenWords(booking.slotStart)}</p>
        <p className="demo-when-sub">
          Half an hour, for {booking.orgName}. We&apos;ll call the number you gave us and walk
          through a real auction end to end.
        </p>
        <p className="demo-when-sub">
          <a href={`/demo/${token}/invite.ics`} className="prose-link">
            Add it to your calendar
          </a>
        </p>
      </div>

      <BookingManager token={token} days={days} />
    </main>
  );
}
