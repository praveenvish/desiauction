"use client";

import { Badge, Button, Card, Dialog, EmptyState, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatPhone } from "../../../lib/format-phone";
import {
  issueMoneyAuthorityAction,
  revokeMoneyAuthorityAction,
  type MoneyAuthorityView,
} from "../../../server/settlement/actions";

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

const ROLE_LABEL: Record<string, string> = {
  "settlement:officer": "Settlement officer",
  "settlement:controller": "Settlement controller",
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

/** "24 Jul 2026" — the provenance line under a holder's name. */
export function grantedLine(grantedByName: string | null, grantedAt: string | null): string | null {
  const when =
    grantedAt === null
      ? null
      : new Date(grantedAt).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
  if (grantedByName === null && when === null) return null;
  if (grantedByName === null) return `Granted ${when ?? ""}`;
  return when === null ? `Granted by ${grantedByName}` : `Granted by ${grantedByName} · ${when}`;
}

export function MoneyAuthorityPanel({
  slug,
  authority,
}: {
  slug: string;
  authority: MoneyAuthorityView;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState("settlement:officer");
  const [revoking, setRevoking] = useState<MoneyAuthorityView["grants"][number] | null>(null);

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
    <Card data-testid="money-authority">
      <h2>Money authority</h2>

      {authority.grants.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title="Nobody can settle yet"
          description="Until someone holds a settlement role, no case can be opened and no money can be recorded for this organization."
        />
      ) : (
        <ul className="od-authority-holders" data-testid="authority-list">
          {authority.grants.map((grant) => (
            <li
              key={grant.grantId}
              className="od-authority-row"
              data-testid={`authority-${grant.personId}`}
            >
              <span className="od-authority-avatar" aria-hidden>
                {authorityInitials(grant.name, grant.phone)}
              </span>
              <span className="od-authority-id">
                <span className="od-authority-name">{grant.name ?? formatPhone(grant.phone)}</span>
                {/* Who handed this over, and when — stored since the table
                    existed, shown nowhere until now. */}
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
                  data-testid={`revoke-authority-${grant.personId}`}
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
            data-testid="authority-person"
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
            label="Settlement role"
            help={ROLES.find((entry) => entry.value === role)?.description}
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
            }}
            data-testid="authority-role"
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
                () => issueMoneyAuthorityAction(slug, personId, role),
                "Money authority granted.",
              ).then(() => {
                setPersonId("");
              });
            }}
            data-testid="grant-authority"
          >
            Grant
          </Button>
        </div>
      ) : (
        <p className="authority-hint">Only someone who can hand out roles here can change this.</p>
      )}

      {/* Revoking was one click. Taking the LAST settlement role away leaves the
          organization unable to record a rupee — the empty state above says so
          in as many words — so the consequence is named before it happens, and
          the server refuses the last controller outright. */}
      <Dialog
        open={revoking !== null}
        onClose={() => {
          setRevoking(null);
        }}
        title={`Revoke ${ROLE_LABEL[revoking?.capabilitySet ?? ""] ?? "settlement role"}?`}
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
                  () => revokeMoneyAuthorityAction(slug, grant.grantId),
                  "Money authority revoked.",
                ).then(() => {
                  setRevoking(null);
                });
              }}
              data-testid="confirm-revoke-authority"
            >
              Revoke
            </Button>
          </>
        }
      >
        <p data-testid="revoke-authority-consequence">
          {revoking?.name ?? formatPhone(revoking?.phone ?? "")} can no longer open or verify
          settlement cases, record a payment, or settle and close one for this organization.
          {authority.grants.length === 1
            ? " They are the only person here who can, so until someone else is granted the role, no money can be recorded at all."
            : ""}
        </p>
      </Dialog>
    </Card>
  );
}
