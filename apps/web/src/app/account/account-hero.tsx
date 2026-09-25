import { PROFILE_ITEMS, type ProfileCompleteness, type ProfileItem } from "@desiauction/core";
import {
  IconCheckCircle,
  IconChevronRight,
  IconCircle,
  IconMail,
  IconPhone,
  IconSpark,
  IconStar,
  Pill,
  PlayerImage,
  StatCard,
} from "@desiauction/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatPhone } from "../../lib/format-phone";

/**
 * The top of /account: who this account is, and how far its profile has got.
 *
 * Left, the identity card — their own photo (consent-gated and signed on the
 * server; the branded initials mark until a season registration brings one),
 * the name, each way they sign in, the sports they play and the one account
 * action that is not a setting (sign out). Right, the completeness meter as a
 * figure card, and under it the checklist whose unfinished items jump to the
 * card that finishes them.
 *
 * There is no "change photo" here on purpose: a photo arrives WITH the consent
 * a season registration records (photoConsent columns). An upload on this page
 * would store a face without that consent — so the page says where it comes
 * from instead of offering a button that cannot honour it.
 */

/**
 * The checklist's words (codes come from core, copy lives with the surface —
 * the publishBlockers pattern). Order mirrors PROFILE_ITEMS. `href` is the card
 * on this page that finishes the item; the photo has none (see above).
 */
const ITEM_LABELS: Record<ProfileItem, { label: string; hint?: string; href?: string }> = {
  name: { label: "Name set", href: "#profile" },
  photo: { label: "Profile photo", hint: "added when you register for a season" },
  role: { label: "Playing role", hint: "under Sports", href: "#sports" },
  date_of_birth: { label: "Date of birth", hint: "under Player profile", href: "#player" },
  style: { label: "Batting or bowling style", hint: "under Sports", href: "#sports" },
  location: { label: "City", hint: "under Player profile", href: "#player" },
  email: { label: "Verified email", hint: "for receipts and documents", href: "#profile" },
  passkey: { label: "Passkey", hint: "the fastest way to sign in", href: "#security" },
};

export interface AccountHeroProps {
  personId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  emailVerified: boolean;
  photoUrl: string | null;
  /** Labels of the sports this person plays (has a profile for, or entered). */
  sports: string[];
  completeness: ProfileCompleteness;
  /** Whether this person has entered any season — decides the photo line. */
  hasRegistrations: boolean;
  /** Three small facts under the name — sports, passkeys, devices. */
  facts: { key: string; icon: ReactNode; value: string; label: string }[];
  /** The sign-out form, which must be a client component to sweep localStorage. */
  signOut: ReactNode;
}

export function AccountHero({
  personId,
  name,
  phone,
  email,
  emailVerified,
  photoUrl,
  sports,
  completeness,
  hasRegistrations,
  facts,
  signOut,
}: AccountHeroProps) {
  const hasName = name !== null && name.trim() !== "";
  const missing = new Set(completeness.missing);
  const percent = Math.round((completeness.done / Math.max(1, completeness.total)) * 100);
  const progressLabel = `Profile ${String(completeness.done)} of ${String(completeness.total)}`;
  const left = completeness.total - completeness.done;

  return (
    <div className="acct-top">
      <section className="acct-id" aria-label="Your account">
        <span className="acct-id-glow" aria-hidden />
        <div className="acct-id-main">
          <div className="acct-id-photo">
            <span className="acct-id-photo-box">
              <PlayerImage
                name={hasName ? name : "New member"}
                seed={personId}
                src={photoUrl}
                size="xl"
                shape="round"
                fluid
                decorative
              />
            </span>
          </div>
          <div className="acct-id-text">
            <h2 className="acct-id-name" data-testid="account-name">
              {hasName ? name : "Your profile"}
            </h2>
            {/* Each way this account signs in, on its own line. The first is the
                account's anchor (a number, or — since 0062 — an email), so it
                carries `account-phone`, grouped the way every other surface
                prints a number. */}
            <ul className="acct-id-contacts">
              {phone !== null ? (
                <li>
                  <IconPhone size={16} aria-hidden />
                  <span data-testid="account-phone" data-private>
                    {formatPhone(phone)}
                  </span>
                  <Pill tone="green" dot>
                    Verified
                  </Pill>
                </li>
              ) : null}
              {email !== null ? (
                <li>
                  <IconMail size={16} aria-hidden />
                  <span
                    className="acct-id-email"
                    data-private
                    {...(phone === null ? { "data-testid": "account-phone" } : {})}
                  >
                    {email}
                  </span>
                  {emailVerified || phone === null ? (
                    <Pill tone="green" dot>
                      Verified
                    </Pill>
                  ) : (
                    <Pill tone="amber" dot>
                      Not confirmed
                    </Pill>
                  )}
                </li>
              ) : null}
            </ul>
            {sports.length > 0 ? (
              <ul className="acct-id-sports" aria-label="Sports you play">
                {sports.map((label) => (
                  <li key={label}>
                    <Pill tone="gold" icon={<IconStar />}>
                      {label}
                    </Pill>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        {facts.length === 0 ? null : (
          <ul className="acct-id-facts" aria-label="Your account at a glance">
            {facts.map((fact) => (
              <li key={fact.key}>
                <span className="acct-id-fact-icon" aria-hidden>
                  {fact.icon}
                </span>
                <span className="acct-id-fact-text">
                  <span className="acct-id-fact-value">{fact.value}</span>
                  <span className="acct-id-fact-label">{fact.label}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="acct-id-foot">
          <p className="acct-id-note">
            {/* "Arrives with your FIRST registration" was said to people who had
                already registered — without a photo, because the form's photo
                is optional. The promise is only true for someone yet to enter. */}
            {photoUrl !== null
              ? "Your photo comes from your season registration."
              : hasRegistrations
                ? "Add a photo on your next season registration — it shows here and on your card."
                : "Your photo arrives with your first season registration."}
          </p>
          <div className="acct-id-actions">
            <Link href="/me" className="acct-link">
              My sports <IconChevronRight size={14} aria-hidden />
            </Link>
            {signOut}
          </div>
        </div>
      </section>

      <div className="acct-strength">
        {/* PI-1: the real checklist — everything the product actually uses,
            derived per read by core's profileCompleteness. The label keeps the
            sentence the rest of the product (and its tests) reads. */}
        <StatCard
          icon={<IconSpark />}
          tone={left === 0 ? "green" : "gold"}
          // "Profile N of M" — the one way /home, /me and /account say it. It
          // was "1/8", "Profile 1 of 8", "Profile 1/8" and "13%" on three
          // screens; the percentage is still the bar, just not a fourth wording.
          value={left === 0 ? "Complete" : `${String(left)} left`}
          label={progressLabel}
          hint={
            left === 0
              ? "Everything the product uses is filled in"
              : "Each one saves a question at your next registration"
          }
          progress={percent}
          testId="profile-completion"
        />
        <ul className="acct-checklist" aria-label="Profile checklist">
          {PROFILE_ITEMS.map((item) => {
            const done = !missing.has(item);
            const { label, hint, href } = ITEM_LABELS[item];
            const body = (
              <>
                {done ? (
                  <IconCheckCircle size={16} className="acct-check-icon" aria-hidden />
                ) : (
                  <IconCircle size={16} className="acct-check-icon" aria-hidden />
                )}
                <span className="acct-check-text">
                  <span>{label}</span>
                  {!done && hint !== undefined ? (
                    <span className="acct-check-hint">{hint}</span>
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={item} data-done={done}>
                {!done && href !== undefined ? (
                  <a href={href} className="acct-check-row">
                    {body}
                  </a>
                ) : (
                  <span className="acct-check-row">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
