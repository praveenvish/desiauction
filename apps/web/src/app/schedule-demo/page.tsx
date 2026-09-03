import type { Metadata } from "next";
import Link from "next/link";

import { DemoRequestForm } from "../../components/marketing/demo-request-form";
import { env } from "../../env";
import { DEMO_SOURCES } from "../../server/marketing/demo-requests";
import { hasBookableSlots } from "../../server/marketing/demo-slots";
import "../content.css";
import "./demo.css";

export const metadata: Metadata = {
  title: "Book a demo · DesiAuction",
  description:
    "See a real auction run end to end — squads, bidding, the gavel and the money afterwards. Tell us about your tournament and we'll walk you through it live.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/schedule-demo` },
};

/**
 * DEMO-1 — the page that used to be a mailto link.
 *
 * It said so itself, honestly, for as long as that was true: "no booking-
 * calendar backend". There is one now, and this is its front door. Public, no
 * auth, no tenant.
 *
 * WHAT THE PAGE PROMISES DEPENDS ON WHAT IS ACTUALLY ON OFFER. If somebody has
 * published availability, the page offers to let you pick a time. If nobody
 * has, it does not draw an empty calendar and hope — it says a person will come
 * back to you, which is the thing that will actually happen. The whole feature
 * degrades to the honest version of itself rather than to a lie.
 */
export const dynamic = "force-dynamic";

export default async function ScheduleDemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [bookable, params] = await Promise.all([hasBookableSlots(), searchParams]);

  // WHICH CTA SENT THEM. Validated against a closed list here AND again in the
  // action — the value is attacker-controlled (it is a query string on a public
  // page) and it is echoed into an operator's console, so an unrecognised one
  // becomes "other" rather than travelling as typed.
  const from = params["from"];
  const source =
    typeof from === "string" && (DEMO_SOURCES as readonly string[]).includes(from)
      ? from
      : "schedule-demo";

  return (
    <main className="content-page content-narrow">
      <h1>Book a demo</h1>
      <p className="content-lead">
        Twenty minutes, on a call, watching a real auction run: teams and purses, players going
        under the hammer, the gavel, and the receipts that come out the other side. Not slides.
      </p>

      <ol className="demo-steps">
        <li>
          <strong>Tell us about your tournament.</strong> How many teams, and when your auction is —
          a rough answer is fine.
        </li>
        <li>
          <strong>
            {bookable ? "Pick a time that suits you." : "We come back to you within a day."}
          </strong>{" "}
          {bookable
            ? "Slots are half an hour, evenings and weekends, Indian Standard Time."
            : "Usually much less. Evenings and weekends are no problem."}
        </li>
        <li>
          <strong>Watch it run.</strong> We use a tournament that has already finished, so you see
          the whole night — including the settlement afterwards, which is the part most people have
          never seen done properly.
        </li>
      </ol>

      <DemoRequestForm source={source} />

      <p className="prose-p demo-footnote">
        Would you rather just start? Every tournament gets the full platform, free, during beta —{" "}
        <Link href="/login" className="prose-link">
          set yours up now
        </Link>{" "}
        and ask us questions as they come up. If you only want to write to a person, we&apos;re at{" "}
        <a href="mailto:support@desiauction.in?subject=Demo%20request" className="prose-link">
          support@desiauction.in
        </a>
        .
      </p>
    </main>
  );
}
