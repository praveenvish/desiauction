import type { Metadata } from "next";
import Link from "next/link";

import { DemoRequestForm } from "../../components/marketing/demo-request-form";
import { env } from "../../env";
import { DEMO_SOURCES } from "../../server/marketing/demo-requests";
import { hasBookableSlots } from "../../server/marketing/demo-slots";
import { IconCalendar, IconPlay } from "@desiauction/ui";

import { ContentPage } from "../../components/public/content-page";
import { SideCard } from "../../components/public/public-kit";
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
    <ContentPage
      eyebrow="See it run"
      title={
        <>
          Book a <em>demo</em>
        </>
      }
      lede="Twenty minutes, on a call, watching a real auction run: teams and purses, players going under the hammer, the gavel, and the receipts that come out the other side. Not slides."
      prose={false}
      aside={
        <>
          {/* How it works, as a timeline beside the form rather than 12px
              text jammed above it. */}
          <SideCard
            headingId="demo-how"
            title="How it works"
            icon={<IconCalendar size={20} weight="duotone" />}
          >
            <ol className="demo-steps">
              <li>
                <strong>Tell us about your tournament.</strong> How many teams, and when your
                auction is — a rough answer is fine.
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
                <strong>Watch it run.</strong> We use a tournament that has already finished, so you
                see the whole night — including the settlement afterwards.
              </li>
            </ol>
          </SideCard>
          <SideCard
            headingId="demo-start"
            title="Rather just start?"
            icon={<IconPlay size={20} weight="duotone" />}
            tone="accent"
          >
            <p>
              Every tournament gets the full platform, free, during beta. Set yours up and ask us
              questions as they come up.
            </p>
            <p>
              <Link href="/login">Set up your tournament</Link>
            </p>
            <p className="demo-footnote">
              Only want to write to a person?{" "}
              <a href="mailto:support@desiauction.in?subject=Demo%20request" data-private>
                support@desiauction.in
              </a>
            </p>
          </SideCard>
        </>
      }
    >
      <div className="demo-form-card">
        <DemoRequestForm source={source} />
      </div>
    </ContentPage>
  );
}
