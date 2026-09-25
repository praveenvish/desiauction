import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@desiauction/ui";

import { env } from "../../env";
import { LEGAL_IDENTITY } from "../../content/company";
import { START_CLUB_LOGIN } from "../../lib/start-intent";
import { ContentPage } from "../../components/public/content-page";
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
      art="montage"
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
      {/* The page used to end on a paragraph, which left a convinced reader
          nowhere to go. The two ways in, then the way to a person. */}
      <div className="content-actions">
        <ButtonLink href={START_CLUB_LOGIN} variant="primary">
          Create your tournament
        </ButtonLink>
        <ButtonLink href="/schedule-demo" variant="secondary">
          Book a demo
        </ButtonLink>
      </div>
      <p className="prose-p">
        Questions first?{" "}
        <Link href="/support" className="prose-link">
          Talk to support
        </Link>
        .
      </p>
    </ContentPage>
  );
}
