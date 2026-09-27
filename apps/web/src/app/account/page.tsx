import {
  AnnouncerProvider,
  IconArrowLeft,
  IconBell,
  IconChevronRight,
  IconFile,
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
import { rolesOf } from "../../server/roles/roles";
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
import { HashSection } from "./hash-section";
import {
  ACCOUNT_SECTIONS,
  contactStatus,
  notificationsStatus,
  sectionOf,
  securityStatus,
  type AccountSection,
} from "./sections";
import "./account.css";

export const metadata = { title: "Account · DesiAuction" };

const SECTION_ICON: Record<AccountSection, ReactNode> = {
  profile: <IconUser />,
  player: <IconFile />,
  security: <IconLock />,
  notifications: <IconBell />,
  data: <IconShieldCheck />,
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await currentSession();
  if (session === null) {
    // PX-3 session-expiry UX: come back exactly here after signing in.
    redirect("/login?next=/account");
  }
  const params = await searchParams;
  const asked = sectionOf(typeof params["section"] === "string" ? params["section"] : null);
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
    roles,
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
    // The clubs they run and the teams they own — identity facts for the
    // hero (cached; the shell reads it too).
    rolesOf(session.personId),
  ]);
  const sportForms = SPORTS.map((pack) => {
    const held = sportProfiles.find((profile) => profile.sport === pack.key);
    /*
     * A role already given on a registration starts the form. The checklist
     * counts that role as set (it reads registrations too), so an empty
     * "Choose…" under a ticked "Playing role" contradicted itself.
     */
    const registered = entries.find(
      (entry) =>
        entry.sport === pack.key &&
        entry.role !== null &&
        pack.roles.values.some((role) => role.key === entry.role),
    )?.role;
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
      defaultRole: held?.defaultRole ?? registered ?? null,
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
  /*
   * ROLE-AWARE (round 4). An owner's /account asked for a playing role, a
   * batting style and "How you play", and linked "My sports" from a page that
   * is "My teams" everywhere else. Someone who runs, owns or conducts and has
   * never played gets the account's own items; the player forms stay one
   * click away, folded, for the day they enter a season.
   */
  const playsHere = entries.length > 0 || sportsPlayed.length > 0 || roles.plays;
  const nonPlayer =
    !playsHere &&
    (roles.owns.length > 0 || roles.organizes.length > 0 || roles.conducts.length > 0);
  const recordLink = playsHere
    ? { href: "/me", label: "My sports" }
    : roles.owns.length > 0
      ? { href: "/me", label: "My teams" }
      : null;
  /*
   * ROLE-VOICED SWITCHES (round 5). The catalogue's wording is a player's
   * ("when an organizer approves, waitlists or declines you"); an owner or a
   * club runner reads the same switch in their own terms. Presentation only —
   * the topics and what they gate are untouched.
   */
  const OWNER_DETAIL: Record<string, string> = {
    registration: "Only if you enter a season as a player yourself.",
    auction: "When an auction you take part in is about to start, and how it went.",
  };
  const switchSettings =
    settings === null || !nonPlayer
      ? settings
      : {
          ...settings,
          topics: settings.topics.map((entry) => ({
            ...entry,
            detail: OWNER_DETAIL[entry.topic] ?? entry.detail,
          })),
        };
  const sections = nonPlayer
    ? ACCOUNT_SECTIONS.filter((section) => section.key !== "player")
    : ACCOUNT_SECTIONS;
  // A laptop always shows one section beside the list; with none asked for,
  // the first. A phone shows the list alone until one is picked.
  const open: AccountSection =
    asked !== null && sections.some((section) => section.key === asked) ? asked : "profile";
  const missing = new Set(completeness.missing);
  const playerMissing = ["role", "style", "date_of_birth", "location"].filter((item) =>
    missing.has(item as never),
  ).length;
  const status: Record<AccountSection, { text: string; warn: boolean }> = {
    profile: {
      text: contactStatus(session.phone, email.email ?? session.email, email.verified),
      warn: (email.email ?? session.email) === null || !email.verified,
    },
    player: {
      text: [
        sportsPlayed.join(", "),
        playerMissing > 0 ? `${String(playerMissing)} details missing` : "complete",
      ]
        .filter((part) => part !== "")
        .join(" · "),
      warn: playerMissing > 0,
    },
    security: {
      text: securityStatus(security?.passkeys.length ?? 0, security?.sessions.length ?? 0),
      warn: (security?.passkeys.length ?? 0) === 0,
    },
    notifications: {
      text:
        settings === null
          ? "What we send, and how"
          : notificationsStatus(settings.topics, settings.whatsapp, settings.language),
      warn: false,
    },
    data: {
      text:
        erasure !== null && erasure.status === "requested"
          ? "Deletion requested"
          : "Delete your account",
      warn: erasure !== null && erasure.status === "requested",
    },
  };
  const standing =
    [
      entries.length > 0
        ? `${String(entries.length)} season${entries.length === 1 ? "" : "s"}`
        : null,
      roles.organizes.length > 0
        ? `runs ${String(roles.organizes.length)} club${roles.organizes.length === 1 ? "" : "s"}`
        : null,
      roles.owns.length > 0
        ? `owns ${String(roles.owns.length)} team${roles.owns.length === 1 ? "" : "s"}`
        : null,
    ]
      .filter((part) => part !== null)
      .join(" · ") || null;

  const pane: Record<AccountSection, ReactNode> = {
    profile: (
      <>
        <ProfilePanel phone={session.phone} name={session.name} email={email} />
        {nonPlayer ? (
          <details className="acct-fold" data-testid="account-player-fold">
            <summary>
              <span>
                <strong>Playing too?</strong> Add a player profile — your next season registration
                starts filled in.
              </span>
            </summary>
            <div className="acct-fold-body">
              <PersonProfilePanel profile={cricketProfile} />
              <SportProfiles forms={sportForms} />
            </div>
          </details>
        ) : null}
      </>
    ),
    player: (
      <>
        {/* PI-1: the durable identity. Prefills every future registration. */}
        <PersonProfilePanel profile={cricketProfile} />
        {/* SP-1 Phase 3: how you play, per sport. */}
        <SportProfiles forms={sportForms} />
      </>
    ),
    security: security !== null ? <SecurityPanels security={security} /> : null,
    /*
     * NOTIFICATIONS — disclosure AND real switches. `maySend` reads the
     * preferences before every send, so these stop messages rather than
     * recording an opinion.
     */
    notifications: (
      <SectionCard
        id="notifications"
        icon={<IconBell />}
        tone="gold"
        title="Notifications"
        description="Switch any of these off and we stop sending it, by text and by email."
        className="acct-card"
        data-testid="notifications-panel"
      >
        <div className="acct-always">
          <span className="acct-always-text">
            <span className="acct-always-label">Sign-in codes</span>
            <span className="acct-always-detail">
              By SMS or email, only when you ask for one. They can&rsquo;t be turned off — they are
              how you get into your account.
            </span>
          </span>
          <span className="acct-always-tag">Always on</span>
        </div>
        {switchSettings === null ? null : <NotificationSwitches settings={switchSettings} />}
        {settings === null ? null : (
          <WhatsAppSwitch
            optedIn={settings.whatsapp}
            label={WHATSAPP_CONSENT_LABEL}
            language={settings.language}
          />
        )}
        {settings === null ? null : <MessageLanguageChoice language={settings.language} />}
        <p className="acct-fineprint">
          The big moments — a team buys you, you are named captain, you are in a lineup — always
          land in <Link href="/inbox">your notifications</Link> too. We never sell your number or
          use it for marketing. Reply <strong>STOP</strong> to any text to stop them all,{" "}
          <strong>START</strong> to turn them back on.
        </p>
      </SectionCard>
    ),
    /*
     * YOUR DATA — the deletion path. A manual, staffed process is defensible at
     * beta scale; an undiscoverable one is not.
     */
    data: (
      <SectionCard
        id="data"
        icon={<IconShieldCheck />}
        tone="gold"
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
          from this account, or <Link href="/support">raise it through support</Link>. We reply
          within seven days either way.{" "}
          <Link href="/legal/data-retention">Data Retention policy</Link>
          {" · "}
          <Link href="/legal/privacy">Privacy Policy</Link>
        </p>
      </SectionCard>
    ),
  };
  const openLabel = sections.find((section) => section.key === open)?.label ?? "Account";

  return (
    <AnnouncerProvider>
      <ToastProvider>
        {/* `data-picked`: a phone shows the list until a section is asked for,
            then that section alone, with the way back. A laptop shows both. */}
        <main className="acct" data-picked={asked !== null ? "true" : undefined}>
          <HashSection current={asked} />
          <AccountHero
            personId={session.personId}
            name={session.name}
            phone={session.phone}
            email={email.email ?? session.email}
            emailVerified={email.verified}
            photoUrl={photoUrl}
            sports={sportsPlayed}
            completeness={completeness}
            standing={standing}
            playerItems={!nonPlayer}
          />

          <div className="acct-hub">
            <nav className="acct-sections" aria-label="Account sections">
              <ul>
                {sections.map((section) => (
                  <li key={section.key}>
                    <Link
                      href={`/account?section=${section.key}`}
                      className="acct-section-link"
                      aria-current={section.key === open ? "page" : undefined}
                      data-testid={`account-section-${section.key}`}
                    >
                      <span className="acct-section-icon" aria-hidden>
                        {SECTION_ICON[section.key]}
                      </span>
                      <span className="acct-section-text">
                        <span className="acct-section-label">{section.label}</span>
                        <span
                          className="acct-section-status"
                          data-warn={status[section.key].warn ? "true" : undefined}
                        >
                          {status[section.key].text}
                        </span>
                      </span>
                      <IconChevronRight size={16} className="acct-section-go" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="acct-sections-foot">
                <SignOutButton logout={logoutAction} />
                {recordLink === null ? null : (
                  <Link href={recordLink.href} className="acct-link">
                    {recordLink.label} <IconChevronRight size={14} aria-hidden />
                  </Link>
                )}
              </div>
            </nav>

            <section className="acct-pane" aria-label={openLabel} data-section={open}>
              <Link href="/account" className="acct-back" scroll={false}>
                <IconArrowLeft size={18} aria-hidden />
                Account
              </Link>
              {pane[open]}
            </section>
          </div>
        </main>
      </ToastProvider>
    </AnnouncerProvider>
  );
}
