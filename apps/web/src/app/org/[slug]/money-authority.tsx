"use client";

import {
  issueMoneyAuthorityAction,
  revokeMoneyAuthorityAction,
  type MoneyAuthorityView,
} from "../../../server/settlement/actions";
import { KeyCard } from "./key-card";

/**
 * PX-7 — Money authority.
 *
 * Settlement grants are a SEPARATE act of trust from org roles: the capability
 * engines are partitioned, so `org:owner` confers no money power and a
 * settlement grant confers no auction power. That is deliberate, and this panel
 * says so out loud — otherwise an owner who cannot open a case reads it as a bug
 * rather than as the platform working.
 *
 * Without this surface settlement is unreachable from the product (the frozen
 * grants UI offers only frozen sets), which is why it ships with PX-7.
 */

const ROLES: { value: string; label: string; description: string }[] = [
  {
    value: "settlement:officer",
    label: "Settlement officer",
    description: "Can open and verify cases, record payments, settle and close.",
  },
  {
    value: "settlement:controller",
    label: "Settlement controller",
    description: "Everything an officer can do, plus waive, reopen and void.",
  },
];

export function MoneyAuthorityPanel({
  slug,
  authority,
}: {
  slug: string;
  authority: MoneyAuthorityView;
}) {
  return (
    <KeyCard
      testId="money-authority"
      prefix="authority"
      title="Settles money"
      purpose="Opens cases and records what each team paid."
      emptyTitle="Nobody can settle yet"
      emptyBody="Until someone holds a settlement role, no case can be opened and no money can be recorded for this organization."
      roles={ROLES}
      defaultRole="settlement:officer"
      grants={authority.grants}
      members={authority.members}
      canIssue={authority.canIssue}
      issue={(personId, role) => issueMoneyAuthorityAction(slug, personId, role)}
      revoke={(grantId) => revokeMoneyAuthorityAction(slug, grantId)}
      grantedToast="Money authority granted."
      revokedToast="Money authority revoked."
      consequence={(holder, last) =>
        `${holder} can no longer open or verify settlement cases, record a payment, or settle and close one for this organization.${
          last
            ? " They are the only person here who can, so until someone else is granted the role, no money can be recorded at all."
            : ""
        }`
      }
    />
  );
}
