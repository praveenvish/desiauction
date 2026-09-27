import { PROFILE_ITEMS, type ProfileCompleteness, type ProfileItem } from "@desiauction/core";
import { IconCheckCircle, IconChevronDown, IconCircle, Pill, PlayerImage } from "@desiauction/ui";
import Link from "next/link";

import { formatPhone } from "../../lib/format-phone";
import type { AccountSection } from "./sections";

/**
 * THE IDENTITY STRIP at the top of /account (2026-09-27): who this account is
 * and the ONE next thing that would make it more complete.
 *
 * It replaced a hero card (photo, contacts, sports, three figure tiles, a photo
 * note, two links) beside a second card that was the completeness meter and an
 * eight-item checklist — on a phone, a whole screen before the first setting.
 * The checklist is still here, folded under its count; what leads is the next
 * item, as a sentence with a door to the section that finishes it.
 *
 * There is no "change photo" on purpose: a photo arrives WITH the consent a
 * season registration records. An upload here would store a face without it.
 */

/** The checklist's words, and which section finishes each item. */
const ITEM_LABELS: Record<
  ProfileItem,
  { label: string; next: string; hint?: string; section?: AccountSection }
> = {
  name: { label: "Name set", next: "Set your name", section: "profile" },
  photo: {
    label: "Profile photo",
    next: "Add a photo on your next registration",
    hint: "added when you register for a season",
  },
  role: { label: "Playing role", next: "Set your playing role", section: "player" },
  date_of_birth: { label: "Date of birth", next: "Add your date of birth", section: "player" },
  style: {
    label: "Batting or bowling style",
    next: "Add how you bat or bowl",
    section: "player",
  },
  location: { label: "City", next: "Add your city", section: "player" },
  email: {
    label: "Verified email",
    next: "Add and confirm an email",
    hint: "for receipts and documents",
    section: "profile",
  },
  passkey: {
    label: "Passkey",
    next: "Add a passkey",
    hint: "the fastest way to sign in",
    section: "security",
  },
};

/** What an account that does not play is asked to finish. */
const ACCOUNT_ITEMS: readonly ProfileItem[] = ["name", "email", "passkey"];

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
  /** One short line of who they are here: "1 season · runs 1 club". */
  standing: string | null;
  /**
   * False for someone who runs a club, owns a team or conducts — and does not
   * play: their checklist is the account's own items (name, email, passkey).
   */
  playerItems?: boolean;
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
  standing,
  playerItems = true,
}: AccountHeroProps) {
  const hasName = name !== null && name.trim() !== "";
  const missing = new Set(completeness.missing);
  const items = playerItems
    ? PROFILE_ITEMS
    : PROFILE_ITEMS.filter((item) => ACCOUNT_ITEMS.includes(item));
  const total = items.length;
  const doneCount = items.filter((item) => !missing.has(item)).length;
  const left = total - doneCount;
  // "Profile N of M" — the one way /home, /me and /account say it.
  const progressLabel = playerItems
    ? `Profile ${String(doneCount)} of ${String(total)}`
    : `Account ${String(doneCount)} of ${String(total)}`;
  // The next item worth doing: the first missing one this page can finish.
  const next =
    items.find((item) => missing.has(item) && ITEM_LABELS[item].section !== undefined) ??
    items.find((item) => missing.has(item));
  const nextLabel = next === undefined ? null : ITEM_LABELS[next];
  const circumference = 2 * Math.PI * 15;
  const arc = (doneCount / Math.max(1, total)) * circumference;

  return (
    <section className="acct-strip" aria-label="Your account">
      <div className="acct-strip-id">
        <span className="acct-strip-photo">
          <PlayerImage
            name={hasName ? name : "New member"}
            seed={personId}
            src={photoUrl}
            size="lg"
            shape="round"
            fluid
            decorative
          />
        </span>
        <div className="acct-strip-text">
          <h2 className="acct-strip-name" data-testid="account-name">
            {hasName ? name : "Your profile"}
          </h2>
          {/* Each way this account signs in. The first is the account's anchor
              (a number, or — since 0062 — an email), so it carries
              `account-phone`, grouped the way every surface prints a number. */}
          <p className="acct-strip-line">
            {phone !== null ? (
              <span className="acct-strip-contact">
                <span data-testid="account-phone" data-private>
                  {formatPhone(phone)}
                </span>
                <Pill tone="green" dot>
                  Verified
                </Pill>
              </span>
            ) : null}
            {email !== null ? (
              <span className="acct-strip-contact">
                <span
                  className="acct-strip-email"
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
              </span>
            ) : null}
            {sports.length > 0 || standing !== null ? (
              <span className="acct-strip-standing">
                {[sports.join(", "), standing]
                  .filter((part) => part !== null && part !== "")
                  .join(" · ")}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="acct-next" data-testid="profile-completion" data-done={left === 0}>
        <svg className="acct-next-ring" viewBox="0 0 36 36" aria-hidden>
          <circle cx="18" cy="18" r="15" className="acct-next-track" />
          <circle
            cx="18"
            cy="18"
            r="15"
            className="acct-next-arc"
            strokeDasharray={`${String(arc)} ${String(circumference)}`}
          />
        </svg>
        <div className="acct-next-text">
          <span className="acct-next-title">
            {nextLabel === null
              ? "Everything is filled in"
              : `Next: ${nextLabel.next.toLowerCase()}`}
          </span>
          <span className="acct-next-sub">
            {progressLabel}
            {left > 0
              ? playerItems
                ? " — each one saves a question at your next registration"
                : " — each one makes signing in and receipts smoother"
              : ""}
          </span>
        </div>
        {nextLabel?.section !== undefined ? (
          <Link
            href={`/account?section=${nextLabel.section}`}
            className="acct-next-go"
            scroll={false}
          >
            Do it
          </Link>
        ) : null}
        {left > 0 ? (
          <details className="acct-next-all">
            <summary aria-label={`See all ${String(total)} checklist items`}>
              <IconChevronDown size={16} aria-hidden />
            </summary>
            <ul className="acct-checklist" aria-label="Profile checklist">
              {items.map((item) => {
                const done = !missing.has(item);
                const { label, hint, section } = ITEM_LABELS[item];
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
                    {!done && section !== undefined ? (
                      <Link
                        href={`/account?section=${section}`}
                        className="acct-check-row"
                        scroll={false}
                      >
                        {body}
                      </Link>
                    ) : (
                      <span className="acct-check-row">{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
