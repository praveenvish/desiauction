"use client";

import { KeyCard } from "./key-card";
import {
  issueFinanceAuthorityAction,
  revokeFinanceAuthorityAction,
  type FinanceAuthorityView,
} from "../../../server/financial-operations/actions";

/**
 * PX-8 — Finance authority.
 *
 * The THIRD partition's door. Identity, settlement and finops each expand the
 * others' capability sets to nothing, in all six directions — so trusting
 * someone with the money's MOUTH (documents, deliveries, the fiscal year) is a
 * separate act from trusting them with the books, which is separate again from
 * running the competition.
 *
 * Without this panel the finance workspace is unreachable from the product: the
 * frozen grants UI offers only frozen sets and the settlement panel only
 * settlement sets. It is a sibling of MoneyAuthorityPanel rather than a merge —
 * two partitions, two writers, two acts of trust.
 */

const ROLES: { value: string; label: string; description: string }[] = [
  {
    value: "finops:clerk",
    label: "Finance clerk",
    description: "Can see the workspace, issue documents and send deliveries.",
  },
  {
    value: "finops:accountant",
    label: "Accountant",
    description: "Everything a clerk can do, plus run operations and resolve a stalled ingest.",
  },
  {
    value: "finops:controller",
    label: "Finance controller",
    description: "Everything an accountant can do, plus seal and reopen the fiscal year.",
  },
];

export function FinanceAuthorityPanel({
  slug,
  authority,
}: {
  slug: string;
  authority: FinanceAuthorityView;
}) {
  return (
    <KeyCard
      testId="finance-authority"
      prefix="finance"
      title="Speaks for the money"
      purpose="Issues receipts and invoices, and closes the books."
      emptyTitle="Nobody runs finance yet"
      emptyBody="Until someone holds a finance role, the workspace is invisible and no delivery can be retried or investigated by hand."
      roles={ROLES}
      defaultRole="finops:accountant"
      grants={authority.grants}
      members={authority.members}
      canIssue={authority.canIssue}
      issue={(personId, role) => issueFinanceAuthorityAction(slug, personId, role)}
      revoke={(grantId) => revokeFinanceAuthorityAction(slug, grantId)}
      grantedToast="Finance authority granted."
      revokedToast="Finance authority revoked."
      consequence={(holder, last) =>
        `${holder} can no longer issue receipts or invoices, send or retry a delivery, or open and close the books for this organization.${
          last
            ? " They are the only person here who can, so the finance workspace becomes invisible to everyone until someone else is granted the role."
            : ""
        }`
      }
    />
  );
}
