import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandGlyph } from "@desiauction/ui";

import { currentSession } from "../../server/auth/actions";
import { safeNext } from "../../server/auth/redirect";
import { OnboardingPanel } from "./onboarding-steps";
import "./onboarding.css";

export const metadata = { title: "Welcome · DesiAuction" };

// 2026-07-24 council collapse: onboarding is ONE question — your name (it goes
// on team sheets, receipts and the auction stage, so the product genuinely
// needs it). The old org-creation step is gone: organizations are born where
// the work is (/orgs), not as an entry toll. Wizard state stays DERIVED FROM
// SERVER STATE (PX-3's rule): refresh or a week's absence resumes correctly,
// and once the name exists this route simply steps aside.
//
// "Bare" means minimal chrome, not NO chrome. The page shipped with one button
// and zero links: someone who signed in on the wrong number had no way out of
// it but the URL bar. It now carries the two doors a dead end needs — the mark,
// home, and a way to sign out — and nothing else.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/onboarding");
  }
  // Where the gate interrupted them. Console segments that know their own
  // address pass it (see `requireOnboarded`); /home stays the invented default,
  // and `safeNext` folds anything attacker-shaped back to it.
  const { next } = await searchParams;
  const destination = safeNext(next);
  const nameDone = session.name !== null && session.name.trim() !== "";
  if (nameDone) {
    redirect(destination);
  }
  return (
    <main className="onboarding">
      <Link className="onboarding-mark" href="/">
        <span className="onboarding-mark-glyph" aria-hidden="true">
          <BrandGlyph size={22} />
        </span>
        DesiAuction
      </Link>
      <div className="onboarding-grid">
        {/* Desktop-only orientation column. The first mark is the ANSWER to the
            question being asked — why this product wants your name — so it is
            read out; the two below it are decoration and stay hidden. */}
        <aside className="onboarding-aside">
          <p className="onboarding-aside-headline">
            You&rsquo;re one question away from your first auction.
          </p>
          <ul className="onboarding-aside-marks">
            <li>Your name goes on team sheets and the stage</li>
            <li aria-hidden="true">Run server-verified live auctions</li>
            <li aria-hidden="true">Settle every rupee with numbered receipts</li>
          </ul>
        </aside>
        <div className="onboarding-panel">
          <OnboardingPanel phone={session.phone} next={destination} />
        </div>
      </div>
    </main>
  );
}
