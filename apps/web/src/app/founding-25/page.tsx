import type { Metadata } from "next";
import Link from "next/link";
import { IconCamera, IconShieldCheck } from "@desiauction/ui";

import { DemoRequestForm } from "../../components/marketing/demo-request-form";
import { env } from "../../env";
import { ContentPage } from "../../components/public/content-page";
import { SideCard } from "../../components/public/public-kit";
import "../content.css";
import "../schedule-demo/demo.css";

export const metadata: Metadata = {
  title: "Founding 25",
  description:
    "Twenty-five organisers run a real player auction with DesiAuction and help shape it. Apply with your tournament — we set it up with you and stay with you through the night.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/founding-25` },
};

/**
 * THE FOUNDING 25 — the launch cohort's front door (growth charter).
 *
 * It is the demo-request form with its own source (migration 0100), so an
 * application lands on the same desk, under the same throttles and retention,
 * as every other request. A second table would be a second queue for one
 * person to watch.
 *
 * WHAT IT PROMISES IS ONLY WHAT IS TRUE FOR EVERYONE PLUS A PERSON. The
 * platform is free to every tournament during beta, so "free" is not the
 * offer — being set up and accompanied is. And filming is the ask, made
 * plainly here and agreed in writing later: nothing on this page is consent,
 * and it says so.
 *
 * No seat counter. "25" is the size of the cohort, not a number of places
 * left; a countdown we do not keep honestly is a dark pattern.
 */
export default function FoundingTwentyFivePage() {
  return (
    <ContentPage
      eyebrow="Launch cohort"
      title={
        <>
          The Founding <em>25</em>
        </>
      }
      lede="We're picking twenty-five organisers to run a real player auction on DesiAuction — set up with us, run with us on the night, and the first to shape what we build next."
      prose={false}
      aside={
        <>
          <SideCard
            headingId="f25-what"
            title="What you get"
            icon={<IconShieldCheck size={20} weight="duotone" />}
          >
            <ol className="demo-steps">
              <li>
                <strong>Set up with you.</strong> We build the season together: teams, purses,
                player registration and the rules of your auction.
              </li>
              <li>
                <strong>A person on the night.</strong> Someone from DesiAuction on call through
                your auction, from the first bid to the last receipt.
              </li>
              <li>
                <strong>A say in what&apos;s next.</strong> What goes wrong on your night is what we
                fix first.
              </li>
            </ol>
          </SideCard>
          <SideCard
            headingId="f25-ask"
            title="What we ask"
            icon={<IconCamera size={20} weight="duotone" />}
            tone="accent"
          >
            <p>
              With your written permission, we film the night — the room, the big screen, the SOLD
              moments — and share it on our channels.
            </p>
            <p>
              Applying is not permission. We agree it in writing before anything is filmed, players
              appear only with their own consent, and you can withdraw it later.
            </p>
            <p className="demo-footnote">
              Only want the platform? It&apos;s free for every tournament during beta —{" "}
              <Link href="/login">set up yours</Link>.
            </p>
          </SideCard>
        </>
      }
    >
      <div className="demo-form-card">
        <DemoRequestForm source="founding-25" />
      </div>
    </ContentPage>
  );
}
