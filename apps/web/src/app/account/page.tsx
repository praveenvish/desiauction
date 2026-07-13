import { Badge, Button, Card } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { currentSession, logoutAction } from "../../server/auth/actions";
import "./account.css";

export const metadata = { title: "Account · DesiAuction" };

export default async function AccountPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return (
    <main className="account">
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
    </main>
  );
}
