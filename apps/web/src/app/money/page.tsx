import { Card, EmptyState } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";

export const metadata = { title: "My money · DesiAuction" };

// PX-2: the Money workspace ENTRY (shell scope §2). Obligations, payments and
// receipts render here when the settlement experience ships (PX-1 P-29). The
// copy states plainly that the workspace is coming — no fake balances.
export default async function MoneyPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/money");
  }
  return (
    <main>
      <Card>
        <EmptyState
          headingLevel={2}
          title="The money workspace opens with settlement"
          description="When you own a team in an auction, what you owe, what you've paid and your receipts will appear here. This area is being built during the beta."
        />
      </Card>
    </main>
  );
}
