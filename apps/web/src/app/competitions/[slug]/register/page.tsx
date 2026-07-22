import { Badge, ButtonLink, Card } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../../../server/auth/actions";
import { registrationLanding } from "../../../../server/competition/actions";
import { RegisterFlow } from "./register-flow";
import "../../competitions.css";
import "./register.css";

export const metadata = { title: "Register · DesiAuction" };

const STATUS_COPY: Record<
  string,
  { title: string; body: string; tone: "info" | "success" | "warning" | "danger" | "neutral" }
> = {
  submitted: {
    title: "Registration submitted",
    body: "The organizer is reviewing registrations. Check back here — your status updates the moment they decide.",
    tone: "info",
  },
  approved: {
    title: "You're in the player pool",
    body: "The organizer approved your registration. Next stop: auction day, where team owners bid to sign you. The organizer will share when and where.",
    tone: "success",
  },
  waitlisted: {
    title: "You're on the waitlist",
    body: "The competition is full for now. If a spot opens, the organizer moves waitlisted players up — keep an eye on this page.",
    tone: "warning",
  },
  rejected: {
    title: "Registration not approved",
    body: "This registration wasn't approved this time. If you think that's a mistake, reach the organizer through whoever shared the link.",
    tone: "danger",
  },
  withdrawn: {
    title: "Registration withdrawn",
    body: "This registration was withdrawn. If registration is still open you can ask the organizer to reinstate it.",
    tone: "neutral",
  },
  draft: {
    title: "Registration in draft",
    body: "The organizer holds this registration as a draft. Reach them for the next step.",
    tone: "neutral",
  },
};

// PX-5: the player registration experience. Steps are DERIVED from server
// truth (name → people.name, submission → registrations row); the only client
// draft is the pre-submit role choice, kept device-local so refresh and
// browser restarts resume mid-flow. Status view = the same page, post-submit.
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;
  // Share attribution: the `?ref` carried from a shared link (bounded server-side
  // at submit). Attribution is lost across the login hop for signed-out users —
  // acceptable; we don't touch the open-redirect-sensitive `next` path for it.
  const source = typeof ref === "string" ? ref : "";
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
            <div className="register-status-head">
              <Badge
                tone={STATUS_COPY[landing.mine.status]?.tone ?? "neutral"}
                data-testid="my-registration-status"
              >
                {landing.mine.status}
              </Badge>
              <h2>{STATUS_COPY[landing.mine.status]?.title ?? landing.mine.status}</h2>
            </div>
            <p className="register-hint">
              <strong>{landing.competitionName}</strong> · {landing.mine.role.replace(/_/g, " ")} ·
              registration {landing.mine.number}
            </p>
            <p className="register-hint">{STATUS_COPY[landing.mine.status]?.body}</p>
            <p className="register-hint">
              <Link href="/home">All your registrations live on Home</Link>.
            </p>
          </Card>
        ) : !landing.open ? (
          <Card>
            <p role="alert" data-testid="registration-closed">
              Registration for <strong>{landing.competitionName}</strong> is not open right now.
            </p>
            <p className="register-hint">
              <ButtonLink href={`/c/${slug}`} variant="ghost">
                Back to the competition page
              </ButtonLink>
            </p>
          </Card>
        ) : (
          <RegisterFlow
            slug={slug}
            competitionName={landing.competitionName}
            phone={session.phone}
            initialName={session.name ?? ""}
            source={source}
          />
        )}
      </div>
    </main>
  );
}
