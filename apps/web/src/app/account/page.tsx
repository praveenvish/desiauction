import { Card, PageIntro, ToastProvider } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { accountSecurity, currentSession, logoutAction } from "../../server/auth/actions";
import { ProfilePanel } from "./profile-panel";
import { SecurityPanels } from "./security-panels";
import { SignOutButton } from "./sign-out-button";
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
          {/*
            The "Active session" badge that used to sit here consulted nothing:
            it was a constant, rendered beside a page you cannot reach without a
            session. The sessions panel below states the same fact from the
            database, per device. A badge that is always true is not a status.

            The bare <dl> that followed it (Phone / Name, no heading) said the
            same two things the Profile card says 150px lower — the first of the
            two with no heading at all, so a screen-reader user met a definition
            list between the h1 and "Profile". One identity card now.
          */}
          <PageIntro />
          <ProfilePanel
            personId={session.personId}
            phone={session.phone}
            name={session.name}
            passkeyCount={security?.passkeys.length ?? 0}
            signOut={<SignOutButton logout={logoutAction} />}
          />
          {security !== null ? <SecurityPanels security={security} /> : null}

          {/*
            NOTIFICATIONS — disclosure, not a toggle.

            The product sends real SMS to non-organisers: an approve, reject or
            waitlist decision texts every affected registrant
            (server/competition/registration-notify.ts). There was no opt-in
            record, no stated channel, no STOP handling and no mention of any of
            it anywhere a user could find. Storing a preference needs a column,
            and a migration is out of scope here — so this section states
            exactly what is sent and how to stop it, and does NOT pretend to be
            a switch. A toggle that cannot persist would be a worse lie than
            silence. The real fix (a preference column, honoured by the sender)
            is tracked and unbuilt.
          */}
          <Card className="account-card" data-testid="notifications-panel">
            <h2>Notifications</h2>
            <p className="account-prose">
              We use your mobile number for two things, and nothing else. We never sell it, and we
              never use it for marketing.
            </p>
            <dl className="account-facts">
              <dt>Sign-in codes</dt>
              <dd>
                By SMS, only when you ask for one. These cannot be turned off — they are how you get
                into your account.
              </dd>
              <dt>Registration decisions</dt>
              <dd>
                By SMS, when an organizer approves, waitlists or declines a season registration you
                submitted. One message per decision.
              </dd>
              <dt>Everything else</dt>
              <dd>
                Stays in <Link href="/inbox">your notifications</Link> here in the app. No SMS, no
                email.
              </dd>
            </dl>
            <p className="account-prose">
              To stop registration SMS, <Link href="/support">contact support</Link> and we will
              mark your number. During the beta this is handled by a person, not a switch — we would
              rather tell you that than show you a toggle that does nothing.
            </p>
          </Card>

          {/*
            YOUR DATA — the deletion path the product did not have.

            Zero hits for `deleteAccount|delete my account|erasure` across the
            whole source tree. The Data Retention policy is genuinely good and
            genuinely reasoned, and NOTHING implemented it or linked to it; the
            operative instruction ("email privacy@desiauction.in") sat in a legal
            page nobody opens. A manual, staffed process is defensible at beta
            scale. An undiscoverable one is not. This is the discoverable one.
          */}
          <Card className="account-card" data-testid="your-data-panel">
            <h2>Your data</h2>
            <p className="account-prose">
              You can ask us to delete your account. Where your data appears only in your own
              profile, we delete it. Where it appears in a shared, permanent record — an auction you
              bid in, a receipt issued to you — we anonymize your name and number instead of
              destroying the record, so the tournament&rsquo;s history stays intact for everyone
              else in it.
            </p>
            <p className="account-prose">
              <strong>To ask:</strong> email{" "}
              <a href="mailto:privacy@desiauction.in?subject=Account%20deletion%20request">
                privacy@desiauction.in
              </a>{" "}
              from the number on this account, or from an address we can verify against it. We reply
              within seven days. You can also <Link href="/support">raise it through support</Link>{" "}
              if you would rather not email.
            </p>
            <p className="account-prose account-links">
              <Link href="/legal/data-retention">Data Retention policy</Link>
              {" · "}
              <Link href="/legal/privacy">Privacy Policy</Link>
            </p>
          </Card>
        </div>
      </main>
    </ToastProvider>
  );
}
