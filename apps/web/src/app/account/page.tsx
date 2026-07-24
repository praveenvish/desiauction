import { Badge, Button, Card, PageIntro, ToastProvider } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { accountSecurity, currentSession, logoutAction } from "../../server/auth/actions";
import { ProfilePanel } from "./profile-panel";
import { SecurityPanels } from "./security-panels";
import "./account.css";

export const metadata = { title: "Account · DesiAuction" };

export default async function AccountPage() {
  const session = await currentSession();
  if (session === null) {
    // PX-3 session-expiry UX: come back exactly here after signing in.
    redirect("/login?next=/account");
  }
  const security = await accountSecurity();
  return (
    <ToastProvider>
      <main className="account">
        <div className="account-stack">
          <PageIntro actions={<Badge tone="success">Active session</Badge>} />
          <Card className="account-card">
            <dl>
              <dt>Phone</dt>
              <dd data-testid="account-phone">{session.phone}</dd>
              <dt>Name</dt>
              <dd data-testid="account-name">{session.name ?? "—"}</dd>
            </dl>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
          </Card>
          <ProfilePanel
            personId={session.personId}
            phone={session.phone}
            name={session.name}
            passkeyCount={security?.passkeys.length ?? 0}
          />
          {security !== null ? <SecurityPanels security={security} /> : null}
        </div>
      </main>
    </ToastProvider>
  );
}
