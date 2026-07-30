"use client";

import { Badge, Button, Card, Dialog, EmptyState, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatPhone } from "../../../lib/format-phone";
import { grantedLine } from "./money-authority";
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

const ROLE_LABEL: Record<string, string> = {
  "finops:clerk": "Finance clerk",
  "finops:accountant": "Accountant",
  "finops:controller": "Finance controller",
};

/** Initials for the holder avatar — matches the members grid. */
function authorityInitials(name: string | null, phone: string): string {
  const parts = (name ?? phone).trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return (
    parts
      .map((word) => {
        const cp = word.codePointAt(0);
        return cp === undefined ? "" : String.fromCodePoint(cp);
      })
      .join("")
      .toUpperCase() || "—"
  );
}

export function FinanceAuthorityPanel({
  slug,
  authority,
}: {
  slug: string;
  authority: FinanceAuthorityView;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState("finops:accountant");
  const [revoking, setRevoking] = useState<FinanceAuthorityView["grants"][number] | null>(null);

  const act = async (run: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (result.ok) {
      toast({ title: done, tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error ?? "Refused.", tone: "danger" });
    }
  };

  const holders = new Map(authority.grants.map((grant) => [grant.personId, grant]));

  return (
    <Card data-testid="finance-authority">
      <h2>Finance authority</h2>

      {authority.grants.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title="Nobody runs finance yet"
          description="Until someone holds a finance role, the workspace is invisible and no delivery can be retried or investigated by hand."
        />
      ) : (
        <ul className="od-authority-holders" data-testid="finance-authority-list">
          {authority.grants.map((grant) => (
            <li
              key={grant.grantId}
              className="od-authority-row"
              data-testid={`finance-authority-${grant.personId}`}
            >
              <span className="od-authority-avatar" aria-hidden>
                {authorityInitials(grant.name, grant.phone)}
              </span>
              <span className="od-authority-id">
                <span className="od-authority-name">{grant.name ?? formatPhone(grant.phone)}</span>
                {grantedLine(grant.grantedByName, grant.grantedAt) !== null ? (
                  <span className="od-authority-provenance">
                    {grantedLine(grant.grantedByName, grant.grantedAt)}
                  </span>
                ) : null}
              </span>
              <Badge tone="info">{ROLE_LABEL[grant.capabilitySet] ?? grant.capabilitySet}</Badge>
              {authority.canIssue ? (
                <Button
                  variant="secondary"
                  size="touch"
                  disabled={busy}
                  onClick={() => {
                    setRevoking(grant);
                  }}
                  data-testid={`revoke-finance-${grant.personId}`}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {authority.canIssue ? (
        <div className="authority-form">
          <Select
            label="Who?"
            value={personId}
            onChange={(event) => {
              setPersonId(event.target.value);
            }}
            data-testid="finance-person"
          >
            <option value="">Choose a member</option>
            {authority.members
              .filter((member) => !holders.has(member.personId))
              .map((member) => (
                <option key={member.personId} value={member.personId}>
                  {member.name ?? member.phone}
                </option>
              ))}
          </Select>
          <Select
            label="Finance role"
            help={ROLES.find((entry) => entry.value === role)?.description}
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
            }}
            data-testid="finance-role"
          >
            {ROLES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
          <Button
            size="touch"
            disabled={busy || personId === ""}
            onClick={() => {
              void act(
                () => issueFinanceAuthorityAction(slug, personId, role),
                "Finance authority granted.",
              ).then(() => {
                setPersonId("");
              });
            }}
            data-testid="grant-finance"
          >
            Grant
          </Button>
        </div>
      ) : (
        <p className="authority-hint">Only someone who can hand out roles here can change this.</p>
      )}

      {/* Same rule as settlement: what is lost is named before it is taken. */}
      <Dialog
        open={revoking !== null}
        onClose={() => {
          setRevoking(null);
        }}
        title={`Revoke ${ROLE_LABEL[revoking?.capabilitySet ?? ""] ?? "finance role"}?`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRevoking(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                const grant = revoking;
                if (grant === null) return;
                void act(
                  () => revokeFinanceAuthorityAction(slug, grant.grantId),
                  "Finance authority revoked.",
                ).then(() => {
                  setRevoking(null);
                });
              }}
              data-testid="confirm-revoke-finance"
            >
              Revoke
            </Button>
          </>
        }
      >
        <p data-testid="revoke-finance-consequence">
          {revoking?.name ?? formatPhone(revoking?.phone ?? "")} can no longer issue receipts or
          invoices, send or retry a delivery, or open and close the books for this organization.
          {authority.grants.length === 1
            ? " They are the only person here who can, so the finance workspace becomes invisible to everyone until someone else is granted the role."
            : ""}
        </p>
      </Dialog>
    </Card>
  );
}
