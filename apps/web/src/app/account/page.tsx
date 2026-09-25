import {
  AnnouncerProvider,
  IconBall,
  IconBell,
  IconDevice,
  IconFile,
  IconKey,
  IconLock,
  IconShieldCheck,
  IconUser,
  SectionCard,
  ToastProvider,
} from "@desiauction/ui";
import { SPORTS } from "@desiauction/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  accountEmail,
  accountSecurity,
  currentSession,
  logoutAction,
} from "../../server/auth/actions";
import { notificationSettings } from "../../server/messaging/actions";
import {
  ownPhotoUrl,
  playerProfileFor,
  sportProfilesFor,
  sportsPlayedBy,
  profileCompletenessFor,
} from "../../server/player/profile";
import { WHATSAPP_CONSENT_LABEL } from "../../lib/whatsapp-consent";
import { myRegistrations } from "../../server/competition/public";
import { AccountHero } from "./account-hero";
import {
  MessageLanguageChoice,
  NotificationSwitches,
  WhatsAppSwitch,
} from "./notification-switches";
import { PersonProfilePanel } from "./person-profile-panel";
import { SportProfiles } from "./sport-profiles";
import { ErasurePanel } from "./erasure-panel";
import { myErasureRequest } from "../../server/privacy/actions";
import { ProfilePanel } from "./profile-panel";
import { SecurityPanels } from "./security-panels";
import { SignOutButton } from "./sign-out-button";
import "./account.css";

export const metadata = { title: "Account · DesiAuction" };

/** The jump row under the hero — one chip per card, in reading order. */
const ACCOUNT_SECTIONS: { id: string; label: string; icon: ReactNode }[] = [
  { id: "profile", label: "Name & contact", icon: <IconUser /> },
  { id: "player", label: "Player profile", icon: <IconFile /> },
  { id: "sports", label: "How you play", icon: <IconBall /> },
  { id: "security", label: "Sign-in & security", icon: <IconLock /> },
  { id: "notifications", label: "Notifications", icon: <IconBell /> },
  { id: "data", label: "Privacy & data", icon: <IconShieldCheck /> },
];

export default async function AccountPage() {
  const session = await currentSession();
  if (session === null) {
    // PX-3 session-expiry UX: come back exactly here after signing in.
    redirect("/login?next=/account");
  }
  // Independent reads, together: they were eight awaits in a row, so the page
  // cost the SUM of eight round trips. Completeness needs the passkey count,
  // so it follows.
  const [
    security,
    settings,
    email,
    erasure,
    cricketProfile,
    sportProfiles,
    played,
    photoUrl,
    entries,
  ] = await Promise.all([
    accountSecurity(),
    notificationSettings(),
    accountEmail(),
    myErasureRequest(),
    playerProfileFor(session.personId),
    /*
     * One form per enabled sport, built from its pack. The specs are flattened
     * to plain `{ key, label }` here because the packs carry functions and a
     * function cannot cross into a client component.
     */
    sportProfilesFor(session.personId),
    // Which of them this person actually plays — a profile they filled in, or
    // a season they entered. Every pack is still built; `SportProfiles`
    // decides which to show and offers the rest one at a time.
    sportsPlayedBy(session.personId),
    // Their own photo, signed here rather than in the client panel.
    ownPhotoUrl(session.personId),
    // Whether they have entered a season at all — the photo line under the
    // hero promised a photo "with your first registration" to people who
    // had already made one. `cache`d, and the shell reads it too.
    myRegistrations(session.personId),
  ]);
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
  const sportsPlayed = sportForms.filter((form) => form.played).map((form) => form.spec.label);
  return (
    <AnnouncerProvider>
      <ToastProvider>
        <main className="acct">
          <AccountHero
            personId={session.personId}
            name={session.name}
            phone={session.phone}
            email={email.email ?? session.email}
            emailVerified={email.verified}
            photoUrl={photoUrl}
            sports={sportsPlayed}
            completeness={completeness}
            hasRegistrations={entries.length > 0}
            // Only facts that say something: "0 Sports played · 0 Passkeys"
            // were empty boasts in the hero.
            facts={[
              {
                key: "sports",
                icon: <IconBall />,
                value: String(sportsPlayed.length),
                label: sportsPlayed.length === 1 ? "Sport played" : "Sports played",
              },
              {
                key: "passkeys",
                icon: <IconKey />,
                value: String(security?.passkeys.length ?? 0),
                label: security?.passkeys.length === 1 ? "Passkey" : "Passkeys",
              },
              {
                key: "devices",
                icon: <IconDevice />,
                value: String(security?.sessions.length ?? 1),
                label: security?.sessions.length === 1 ? "Device signed in" : "Devices signed in",
              },
            ].filter((fact) => fact.value !== "0")}
            signOut={<SignOutButton logout={logoutAction} />}
          />

          {/* Settings read like settings: an index of the cards, then the cards —
              two columns on a laptop so the page is two screens, not seven. */}
          {/* A sticky section index beside ONE content column (wow pass). The
              two-column masonry left ~1,600px of blank left column. */}
          <div className="acct-body">
            <nav className="acct-nav" aria-label="Account sections">
              <ul>
                {ACCOUNT_SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>
                      <span aria-hidden>{section.icon}</span>
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="acct-columns">
              <div className="acct-column">
                <ProfilePanel phone={session.phone} name={session.name} email={email} />
                {/* PI-1: the durable identity. Prefills every future registration. */}
                <PersonProfilePanel profile={cricketProfile} />
                {/* SP-1 Phase 3: "how you play" has a different answer in each
                  sport — the ones this person plays, and the rest one at a time. */}
                <SportProfiles forms={sportForms} />
              </div>

              <div className="acct-column">
                {security !== null ? <SecurityPanels security={security} /> : null}

                {/*
                NOTIFICATIONS — disclosure AND real switches. The column exists
                (notification_preferences, migration 0023) and `maySend` reads it
                before every send, so these switches stop messages rather than
                recording an opinion. The disclosure stays beside them: knowing
                what we send is not the same as being able to stop it.
              */}
                <SectionCard
                  id="notifications"
                  icon={<IconBell />}
                  tone="blue"
                  title="Notifications"
                  description="Switch any of these off and we stop sending it, by text and by email."
                  className="acct-card"
                  data-testid="notifications-panel"
                >
                  <div className="acct-always">
                    <span className="acct-always-text">
                      <span className="acct-always-label">Sign-in codes</span>
                      <span className="acct-always-detail">
                        By SMS or email, only when you ask for one. They can&rsquo;t be turned off —
                        they are how you get into your account.
                      </span>
                    </span>
                    <span className="acct-always-tag">Always on</span>
                  </div>
                  {settings === null ? null : <NotificationSwitches settings={settings} />}
                  {settings === null ? null : (
                    <WhatsAppSwitch
                      optedIn={settings.whatsapp}
                      label={WHATSAPP_CONSENT_LABEL}
                      language={settings.language}
                    />
                  )}
                  {settings === null ? null : (
                    <MessageLanguageChoice language={settings.language} />
                  )}
                  <p className="acct-fineprint">
                    The big moments — a team buys you, you are named captain, you are in a lineup —
                    always land in <Link href="/inbox">your notifications</Link> too. We never sell
                    your number or use it for marketing. Reply <strong>STOP</strong> to any text to
                    stop them all, <strong>START</strong> to turn them back on.
                  </p>
                </SectionCard>

                {/*
                YOUR DATA — the deletion path the product did not have. A manual,
                staffed process is defensible at beta scale. An undiscoverable one
                is not. This is the discoverable one.
              */}
                <SectionCard
                  id="data"
                  icon={<IconShieldCheck />}
                  tone="red"
                  title="Privacy & data"
                  description="Ask us to delete your account. Your own profile is deleted; shared records — an auction you bid in, a receipt issued to you — keep the history but lose your name and number."
                  className="acct-card"
                  data-testid="your-data-panel"
                >
                  <ErasurePanel request={erasure} />
                  <p className="acct-fineprint">
                    Or email{" "}
                    <a href="mailto:privacy@desiauction.in?subject=Account%20deletion%20request">
                      privacy@desiauction.in
                    </a>{" "}
                    from this account, or <Link href="/support">raise it through support</Link>. We
                    reply within seven days either way.{" "}
                    <Link href="/legal/data-retention">Data Retention policy</Link>
                    {" · "}
                    <Link href="/legal/privacy">Privacy Policy</Link>
                  </p>
                </SectionCard>
              </div>
            </div>
          </div>
        </main>
      </ToastProvider>
    </AnnouncerProvider>
  );
}
