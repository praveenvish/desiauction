import { AnnouncerProvider, Card, PageIntro, ToastProvider } from "@desiauction/ui";
import { SPORTS } from "@desiauction/core";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  accountEmail,
  accountSecurity,
  currentSession,
  logoutAction,
} from "../../server/auth/actions";
import { notificationSettings } from "../../server/messaging/actions";
import {
  playerProfileFor,
  sportProfilesFor,
  sportsPlayedBy,
  profileCompletenessFor,
} from "../../server/player/profile";
import { NotificationSwitches } from "./notification-switches";
import { PersonProfilePanel } from "./person-profile-panel";
import { SportProfiles } from "./sport-profiles";
import { EmailVerify } from "./email-verify";
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
  const settings = await notificationSettings();
  const email = await accountEmail();
  const cricketProfile = await playerProfileFor(session.personId);
  /*
   * One form per enabled sport, built from its pack. The specs are flattened to
   * plain `{ key, label }` here because the packs carry functions and a
   * function cannot cross into a client component.
   */
  const sportProfiles = await sportProfilesFor(session.personId);
  // Which of them this person actually plays — a profile they filled in, or a
  // season they entered. Every pack is still built; `SportProfiles` decides
  // which to show and offers the rest one at a time.
  const played = await sportsPlayedBy(session.personId);
  const sportForms = SPORTS.map((pack) => {
    const held = sportProfiles.find((profile) => profile.sport === pack.key);
    return {
      played: played.has(pack.key),
      spec: {
        key: pack.key,
        label: pack.label,
        roleRequired: pack.roles.required,
        roles: pack.roles.values.map((role) => ({ key: role.key, label: role.label })),
        attributes: pack.attributes.map((attribute) => ({
          key: attribute.key,
          label: attribute.label,
          options: attribute.options.map((option) => ({ key: option.key, label: option.label })),
        })),
      },
      defaultRole: held?.defaultRole ?? null,
      attributes: held?.attributes ?? {},
    };
  });
  const completeness = await profileCompletenessFor(
    session.personId,
    security?.passkeys.length ?? 0,
  );
  /*
   * The switches below announce their own state changes to a screen reader, and
   * `useAnnouncer` THROWS without this ancestor. That is a runtime error the
   * build and the 600-test integration suite cannot see, because it only
   * happens when the component actually renders in a browser — the e2e suite
   * caught it, which is the whole argument for having one.
   */
  return (
    <AnnouncerProvider>
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
              completeness={completeness}
              signOut={<SignOutButton logout={logoutAction} />}
            />
            {/* PI-1: the durable identity, right under the account identity it
              extends. Prefills every future registration. */}
            <PersonProfilePanel profile={cricketProfile} />
            {/* SP-1 Phase 3: "how you play" has a different answer in each
              sport. This used to render one panel per sport the PLATFORM runs,
              which was four and became eight; it now renders the ones this
              person plays, and offers the rest one at a time. */}
            <SportProfiles forms={sportForms} />
            {/* Beside the identity it belongs to, and above Security: this is a
              contact route the product will actually use, not a credential. */}
            <Card>
              <EmailVerify current={email.email} verified={email.verified} />
            </Card>
            {security !== null ? <SecurityPanels security={security} /> : null}

            {/*
            NOTIFICATIONS — disclosure AND, now, real switches.

            This card used to say, honestly, that stopping registration SMS was
            handled "by a person, not a switch — we would rather tell you that
            than show you a toggle that does nothing", because storing a
            preference needed a column nobody had written.

            The column exists now (notification_preferences, migration 0023) and
            `maySend` reads it before every send, so these switches stop
            messages rather than recording an opinion. The disclosure stays
            beside them: knowing what we send is not the same as being able to
            stop it, and a person deserves both.
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
                  By SMS, only when you ask for one. These cannot be turned off — they are how you
                  get into your account.
                </dd>
                <dt>Everything else</dt>
                <dd>
                  Stays in <Link href="/inbox">your notifications</Link> here in the app.
                </dd>
              </dl>
              <h3 className="account-subhead">What we may text you</h3>
              <p className="account-prose">
                Switch any of these off and we stop sending it. Sign-in codes are not on the list
                because turning them off would lock you out of your own account.
              </p>
              {settings === null ? null : <NotificationSwitches settings={settings} />}
              <p className="account-prose">
                You can also reply <strong>STOP</strong> to any message to stop all of them at once,
                and <strong>START</strong> to turn them back on.
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
                profile, we delete it. Where it appears in a shared, permanent record — an auction
                you bid in, a receipt issued to you — we anonymize your name and number instead of
                destroying the record, so the tournament&rsquo;s history stays intact for everyone
                else in it.
              </p>
              <p className="account-prose">
                <strong>To ask:</strong> email{" "}
                <a href="mailto:privacy@desiauction.in?subject=Account%20deletion%20request">
                  privacy@desiauction.in
                </a>{" "}
                from the number on this account, or from an address we can verify against it. We
                reply within seven days. You can also{" "}
                <Link href="/support">raise it through support</Link> if you would rather not email.
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
    </AnnouncerProvider>
  );
}
