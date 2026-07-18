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
      <div className="onboarding-panel">
        <OnboardingPanel step={step} phone={session.phone} name={session.name ?? ""} />
      </div>
    </main>
  );
}
