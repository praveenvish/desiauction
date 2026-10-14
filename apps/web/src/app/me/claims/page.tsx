import { EmptyState, SectionCard } from "@desiauction/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageTitle } from "../../../components/shell/page-title";
import { currentSession } from "../../../server/auth/actions";
import { openGuestClaimOffers } from "../../../server/scoring/guest-claim-offers";
import { ClaimAnswer } from "./claim-answer";
import "../../seasons/seasons.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Is this you?",
  robots: { index: false, follow: false },
};

/**
 * A scorer typed this person's number for a guest player. Nothing has moved:
 * the guest's match stats join this career only if they say it was them (F09).
 */
export default async function GuestClaimsPage() {
  const session = await currentSession();
  if (!session) redirect("/login?next=/me/claims");
  const offers = await openGuestClaimOffers(session.personId);
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <PageTitle
          title="Is this you?"
          subtitle="A scorer entered your mobile number for a guest player. Accept only if it was you."
        />
        {offers.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="Nothing to answer"
            description="When a scorer enters your number for a guest player, it shows up here."
          />
        ) : (
          offers.map((offer) => (
            <SectionCard key={offer.noticeId} title={offer.playedAs}>
              <p>
                {offer.teamName === null ? "" : `${offer.teamName} · `}
                {offer.seasonName} · {offer.clubName}
              </p>
              <ClaimAnswer noticeId={offer.noticeId} />
            </SectionCard>
          ))
        )}
      </div>
    </main>
  );
}
