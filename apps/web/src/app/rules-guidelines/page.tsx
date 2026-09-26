import type { Metadata } from "next";

import { IconEye, IconGavel, IconLedger, IconTrophy, IconTv } from "@desiauction/ui";
import Link from "next/link";

import { env } from "../../env";
import { ContentPage } from "../../components/public/content-page";
import { SideCard } from "../../components/public/public-kit";
import "../content.css";

export const metadata: Metadata = {
  title: "Rules & guidelines · DesiAuction",
  description: "Ground rules for running a fair player auction on DesiAuction.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/rules-guidelines` },
};

const RULES = [
  {
    title: "Every bid is final once accepted",
    body: 'A bid that lands on the server and is accepted by the auctioneer cannot be retracted. There is no "undo my own bid" — only the auctioneer\'s undo, for the current lot, before the next bid.',
    icon: <IconGavel size={24} weight="duotone" />,
  },
  {
    title: "One truth on every screen",
    body: "The cockpit, the public stage and every owner's device show the same state at the same time. If a device disconnects mid-auction, it reconnects to exactly where the room is — it never shows a stale bid as current.",
    icon: <IconTv size={24} weight="duotone" />,
  },
  {
    title: "Nothing is edited after the fact",
    body: "The auction and the money are an append-only record. A mistake is corrected with a new entry that explains itself, not by rewriting history.",
    icon: <IconLedger size={24} weight="duotone" />,
  },
  {
    title: "Spectators watch, they don't bid",
    body: "The public stage needs no sign-in and places no bids — it is a read-only mirror of the room, for players, families and fans.",
    icon: <IconEye size={24} weight="duotone" />,
  },
] as const;

/** Static organizer guidance — no tournament-specific rules (those are each
 * organizer's own), only the platform's own ground rules. Public, no auth. */
export default function RulesGuidelinesPage() {
  return (
    <ContentPage
      eyebrow="Ground rules"
      title={
        <>
          Rules &amp; <em>guidelines</em>
        </>
      }
      prose={false}
      aside={
        <SideCard
          headingId="your-rules"
          title="Your tournament, your rules"
          icon={<IconTrophy size={20} weight="duotone" />}
        >
          <p>
            Purse, base price, squad size and bidding format are set per tournament by its
            organizer. The help centre shows where each one lives.
          </p>
          <p>
            <Link href="/help/category/auction">Read the auction guide</Link>
          </p>
        </SideCard>
      }
      lede="DesiAuction doesn't set your tournament's auction rules — purse, base price, team counts and bidding format are yours to decide. These are the platform's own ground rules, the same for every tournament."
    >
      <h2 id="ground-rules" className="cl-list-title">
        Four ground rules
      </h2>
      <ol className="feature-cards da-stagger" aria-labelledby="ground-rules">
        {RULES.map((rule, index) => (
          <li key={rule.title} className="feature-card">
            <span className="feature-card-tile" aria-hidden>
              {rule.icon}
            </span>
            {/* One marker, not two (wow pass, round 2): the icon tile leads and
                the rule's number rides its title, instead of a mono "01"
                competing with the tile from the opposite corner. */}
            <h3>
              <span className="feature-card-num" aria-hidden>
                {String(index + 1)}.
              </span>{" "}
              {rule.title}
            </h3>
            <p>{rule.body}</p>
          </li>
        ))}
      </ol>
    </ContentPage>
  );
}
