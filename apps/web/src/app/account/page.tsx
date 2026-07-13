import { Badge, Button, Card, ToastProvider } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { accountSecurity, currentSession, logoutAction } from "../../server/auth/actions";
import { SecurityPanels } from "./security-panels";
import "./account.css";

export const metadata = { title: "Account · DesiAuction" };

export default async function AccountPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  const security = await accountSecurity();
  return (
    <ToastProvider>
      <main className="account">
        <div className="account-stack">
          <Card className="account-card">
            <div className="account-head">
              <h1>Signed in</h1>
              <Badge tone="success">Active session</Badge>
            </div>
            <dl>
              <dt>Phone</dt>
              <dd data-testid="account-phone">{session.phone}</dd>
              <dt>Name</dt>
              <dd>{session.name ?? "— (set during registration)"}</dd>
            </dl>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
          </Card>
          {security !== null ? <SecurityPanels security={security} /> : null}
        </div>
      </main>
    </ToastProvider>
  );
}
