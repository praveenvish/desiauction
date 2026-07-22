import { BrandGlyph } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { myOrgs } from "../../server/orgs/actions";
import { OnboardingPanel } from "./onboarding-steps";
import "./onboarding.css";

export const metadata = { title: "Welcome · DesiAuction" };

// PX-3 first-time onboarding. Steps are DERIVED FROM SERVER STATE, never from
// client wizard state — refresh, sign-out, or a week's absence resumes the
// right step (CTO quality requirement: restartable, survives refresh).
//   Step 1  name missing        → profile completion (writes people.name)
//   Step 2  no organizations    → create / join-by-invite / skip
//   Done    both satisfied      → completion confirmation
export default async function OnboardingPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/onboarding");
  }
  const nameDone = session.name !== null && session.name.trim() !== "";
  const orgs = nameDone ? await myOrgs() : [];
  const step: "name" | "org" | "done" = !nameDone ? "name" : orgs.length === 0 ? "org" : "done";
  return (
    <main className="onboarding">
      <div className="onboarding-grid">
        {/* Desktop-only orientation column: reassurance + brand, so the form
            isn't a small card marooned in the wide console canvas. The form
            panel still carries every accessible word (aside is aria-hidden). */}
        <aside className="onboarding-aside" aria-hidden="true">
          <p className="onboarding-brand">
            <span className="onboarding-brand-glyph">
              <BrandGlyph size={22} />
            </span>
            DesiAuction
          </p>
          <p className="onboarding-aside-headline">
            You&rsquo;re a minute away from your first auction.
          </p>
          <ul className="onboarding-aside-marks">
            <li>Create or join an organization</li>
            <li>Invite co-organizers whenever you like</li>
            <li>Run server-verified live auctions</li>
          </ul>
        </aside>
        <div className="onboarding-panel">
          <OnboardingPanel step={step} phone={session.phone} name={session.name ?? ""} />
        </div>
      </div>
    </main>
  );
}
