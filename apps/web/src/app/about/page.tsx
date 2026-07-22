import type { Metadata } from "next";

import { env } from "../../env";
import "../content.css";

export const metadata: Metadata = {
  title: "About · DesiAuction",
  description: "What DesiAuction is, and why we built it.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/about` },
};

/** About us — mission and beta status. Public, no auth. */
export default function AboutPage() {
  return (
    <main className="content-page content-narrow">
      <h1>About DesiAuction</h1>
      <p className="content-lead">
        DesiAuction is a platform for running tournament player auctions the way they deserve to be
        run: every bid server-verified, every rupee accounted for, every SOLD moment an occasion.
      </p>
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
      </div>
    </main>
  );
}
