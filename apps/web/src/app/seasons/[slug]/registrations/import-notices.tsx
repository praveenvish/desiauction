"use client";

import type { PlaceholderPhone } from "@desiauction/core";

import { formatPhone } from "../../../../lib/format-phone";

/**
 * WHAT THIS FILE WILL DO ABOUT PHONES AND ROLES, SAID BEFORE IT DOES IT.
 *
 * Only a name is required now. A file without numbers or roles imports — and
 * an organizer who did not notice the missing column must not find out on
 * auction night, so each gap is one plain sentence under the verdict.
 *
 * Made-up numbers (9000000001…) are listed by name: each one would have been
 * a real stranger's identity, so it imports as no phone, and the organizer can
 * tick any that are in fact real.
 */
export function ImportNotices({
  placeholders,
  flagged,
  withoutPhone,
  withoutRole,
  realPhones,
  onRealPhones,
}: {
  /** Set aside in THIS preview — the ones that will import without a phone. */
  placeholders: readonly PlaceholderPhone[];
  /**
   * Every number flagged since this file was read, ticked or not. Kept by the
   * dialog, because a number the organizer ticks stops being flagged and
   * would otherwise vanish from the list they ticked it in.
   */
  flagged: readonly PlaceholderPhone[];
  withoutPhone: number;
  withoutRole: number;
  /** Numbers the organizer ticked as real — they import as phones. */
  realPhones: readonly string[];
  onRealPhones: (next: string[]) => void;
}) {
  const vouched = new Set(realPhones);
  const blankPhones = withoutPhone - placeholders.length;
  const toggle = (phone: string, real: boolean) => {
    const next = new Set(vouched);
    if (real) {
      next.add(phone);
    } else {
      next.delete(phone);
    }
    onRealPhones([...next]);
  };
  return (
    <>
      {flagged.length > 0 ? (
        <div className="reg-warning import-notice" data-testid="import-placeholders">
          <p>
            <strong>
              {placeholders.length} number{placeholders.length === 1 ? "" : "s"} look
              {placeholders.length === 1 ? "s" : ""} made up
            </strong>{" "}
            (like 9000000001). Those players will be added <strong>without a phone</strong>, so a
            stranger who owns that number can&apos;t sign in as them or get their messages.
          </p>
          <details>
            <summary>See the list — tick any number that is real</summary>
            <ul className="import-notice-list">
              {flagged.map((entry) => (
                <li key={`${String(entry.line)}:${entry.phone}`}>
                  <label className="io-inline">
                    <input
                      type="checkbox"
                      checked={vouched.has(entry.phone)}
                      data-testid="placeholder-real"
                      onChange={(event) => {
                        toggle(entry.phone, event.target.checked);
                      }}
                    />
                    <span>
                      {entry.name}
                      {" · "}
                      <span data-private>{formatPhone(entry.phone)}</span>
                      <span className="dash-hint"> · row {entry.line}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
      {blankPhones > 0 ? (
        <p className="dash-hint import-notice" data-testid="import-without-phone">
          <strong>
            {blankPhones} player{blankPhones === 1 ? " has" : "s have"} no phone number.
          </strong>{" "}
          They&apos;ll be added for your club only. They can still be approved and auctioned; nobody
          can sign in as them, and no messages are sent to them.
        </p>
      ) : null}
      {withoutRole > 0 ? (
        <p className="dash-hint import-notice" data-testid="import-without-role">
          <strong>
            {withoutRole} player{withoutRole === 1 ? " has" : "s have"} no playing role.
          </strong>{" "}
          They&apos;ll show as &ldquo;No role given&rdquo; — set each one&apos;s role before the
          auction, so team role limits count them.
        </p>
      ) : null}
    </>
  );
}
