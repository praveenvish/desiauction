"use client";

import { Badge, Button, Card, EmptyState, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
      <p className="authority-hint">
        Settlement is a separate trust from running the competition. Being an owner here does not
        let someone touch the books, and a settlement role does not let them run an auction — each
        is granted on purpose, to a named person.
      </p>

      {authority.grants.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title="Nobody can settle yet"
          description="Until someone holds a settlement role, no case can be opened and no money can be recorded for this organization."
        />
      ) : (
        <ul className="member-list" data-testid="authority-list">
          {authority.grants.map((grant) => (
            <li key={grant.grantId} data-testid={`authority-${grant.personId}`}>
              <span className="member-name">{grant.name ?? grant.phone}</span>
              <Badge tone="info">{ROLE_LABEL[grant.capabilitySet] ?? grant.capabilitySet}</Badge>
              {authority.canIssue ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void act(
                      () => revokeMoneyAuthorityAction(slug, grant.grantId),
                      "Money authority revoked.",
                    );
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
    </Card>
  );
}
