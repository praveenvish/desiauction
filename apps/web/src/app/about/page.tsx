import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ButtonLink, IconGavel, IconPin } from "@desiauction/ui";

import { env } from "../../env";
import { LEGAL_IDENTITY } from "../../content/company";
import { START_CLUB_LOGIN } from "../../lib/start-intent";
import { ContentPage } from "../../components/public/content-page";
import { SideCard } from "../../components/public/public-kit";
import "../content.css";

export const metadata: Metadata = {
  title: "About · DesiAuction",
  description: "What DesiAuction is, and why we built it.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/about` },
};

/** About us — mission and beta status. Public, no auth. */
export default function AboutPage() {
  return (
    <ContentPage
      eyebrow="Company"
      title={
        <>
          About <em>DesiAuction</em>
        </>
      }
      lede="DesiAuction is a platform for running tournament player auctions the way they deserve to be run: every bid server-verified, every rupee accounted for, every SOLD moment an occasion."
      aside={
        <>
          {/* The leftover column holds the facts a visitor checks a young
            company against, instead of five generic sport glyphs that said
            nothing about it. Every figure comes from company.ts or the product. */}
          <SideCard
            headingId="about-facts"
            title="At a glance"
            icon={<IconPin size={20} weight="duotone" />}
          >
            <dl className="pk-side-facts">
              <div>
                <dt>Based in</dt>
                <dd>Jaipur, Rajasthan</dd>
              </div>
              <div>
                <dt>Company</dt>
                <dd>{LEGAL_IDENTITY.legalName}</dd>
              </div>
              <div>
                <dt>Incorporated</dt>
                <dd>July 2022</dd>
              </div>
              <div>
                <dt>Sports</dt>
                <dd>12, from cricket to kabaddi</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>Public beta · free</dd>
              </div>
            </dl>
            <p>
              <Link href="/legal">Operator &amp; legal details</Link>
            </p>
          </SideCard>
          {/* The page used to end on a paragraph, which left a convinced reader
            nowhere to go: the two ways in, then the way to a person, beside
            the story rather than under a picture. */}
          <SideCard
            headingId="about-start"
            title="Run your first auction"
            icon={<IconGavel size={20} weight="duotone" />}
            tone="accent"
          >
            <p>Every tournament gets the full platform, free, during beta.</p>
            <div className="content-actions">
              <ButtonLink href={START_CLUB_LOGIN} variant="primary">
                Create your tournament
              </ButtonLink>
              <ButtonLink href="/schedule-demo" variant="secondary">
                Book a demo
              </ButtonLink>
            </div>
            <p>
              Questions first? <Link href="/support">Talk to support</Link>.
            </p>
          </SideCard>
        </>
      }
    >
      <div className="prose">
        <p className="prose-p">
          Auction night decides a tournament's teams — and too often it runs on a spreadsheet and a
          shared voice call, with disputes settled by whoever shouted first. We built DesiAuction so
          organizers, owners, players and spectators can all trust the same screen at the same time.
        </p>
        <p className="prose-p">
          We're in beta. Every tournament gets the full platform, free, while we earn your trust —
          and while we build the track record that a young platform has to earn honestly.
        </p>
        {/* Who is behind it, from the same identity the footer and the legal
            centre publish — not a second, hand-typed copy of the company name.
            Jaipur is where that company is registered (LEGAL_IDENTITY). */}
        <p className="prose-p">DesiAuction is built in Jaipur by {LEGAL_IDENTITY.legalName}.</p>
      </div>
      <figure className="about-shot">
        <Image
          src="/marketing/product/auction-board-v2.webp"
          alt="The big-screen board of a live auction on DesiAuction: money spent, the most expensive player, and each team's remaining purse and squad"
          width={1600}
          height={900}
          sizes="(max-width: 999px) 100vw, 760px"
        />
        <figcaption>
          The board the whole hall watches — a real screen, from a practice auction.
        </figcaption>
      </figure>
    </ContentPage>
  );
}
