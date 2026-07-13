import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { orgView } from "../../../server/orgs/actions";
import { MembersPanel } from "./members-panel";
import "../../orgs/orgs.css";

export const metadata = { title: "Organization · DesiAuction" };

export default async function OrgHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await orgView(slug);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (M-IP2-3 tenancy).
    notFound();
  }
  return (
    <ToastProvider>
      <main className="org-home">
        <div className="org-stack">
          <h1 data-testid="org-name">{view.org.name}</h1>
          <MembersPanel view={view} slug={slug} />
        </div>
      </main>
    </ToastProvider>
  );
}
