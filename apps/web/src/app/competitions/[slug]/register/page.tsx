import { Badge, Card } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { currentSession } from "../../../../server/auth/actions";
import { registrationLanding } from "../../../../server/competition/actions";
import { RegisterForm } from "./register-form";
import "../../competitions.css";

export const metadata = { title: "Register · DesiAuction" };

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await currentSession();
  if (session === null) {
    redirect(`/login?next=/competitions/${slug}/register`);
  }
  const landing = await registrationLanding(slug);
  return (
    <main className="register">
      <div className="register-panel">
        <h1>Player registration</h1>
        {landing === null ? (
          <Card>
            <p role="alert">This competition is not available.</p>
          </Card>
        ) : landing.mine !== null ? (
          <Card data-testid="registration-status">
            <p>
              You&apos;re registered for <strong>{landing.competitionName}</strong> as{" "}
              <Badge tone="neutral">{landing.mine.role.replace(/_/g, " ")}</Badge>
            </p>
            <p>
              Status:{" "}
              <Badge tone="info" data-testid="my-registration-status">
                {landing.mine.status}
              </Badge>
            </p>
          </Card>
        ) : !landing.open ? (
          <Card>
            <p role="alert" data-testid="registration-closed">
              Registration for <strong>{landing.competitionName}</strong> is not open right now.
            </p>
          </Card>
        ) : (
          <Card data-testid="register-card">
            <p>
              Register for <strong>{landing.competitionName}</strong>. Your verified mobile is your
              identity — no forms to repeat.
            </p>
            <RegisterForm slug={slug} />
          </Card>
        )}
      </div>
    </main>
  );
}
