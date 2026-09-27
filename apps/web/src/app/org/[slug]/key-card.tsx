"use client";

import {
  Button,
  Dialog,
  IconKebab,
  IconKey,
  IconPlus,
  Pill,
  PopoverMenu,
  Select,
  useToast,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { personInitials, personLabel } from "../../../lib/person-label";
import { formatDate } from "../../../lib/format-date";

/**
 * ONE MONEY KEY, AS A CARD (2026-09-27).
 *
 * The Money & roles tab had two panels — settlement and finance — each with
 * its grant form permanently open under the holders (a "Who?" select, a role
 * select and a disabled Grant button), a caps role badge and a Revoke button
 * the width of the name. They are one shape: who holds this key, and a way to
 * give it. So they are one card now, filled differently. Giving the key opens
 * the same form in a dialog; Revoke lives in each holder's ⋯ and still names
 * what is lost before it is taken. The two partitions stay two writers — this
 * shares the drawing, not the authority.
 */

export interface KeyGrant {
  readonly grantId: string;
  readonly personId: string;
  readonly capabilitySet: string;
  readonly grantedByName: string | null;
  readonly grantedAt: string | null;
  readonly name: string | null;
  readonly phone: string | null;
  readonly email: string | null;
}

export interface KeyMember {
  readonly personId: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly email: string | null;
}

type Result = { ok: boolean; error?: string };

/** "Granted by X · 24 Jul 2026" — the provenance line under a holder's name. */
export function grantedLine(grantedByName: string | null, grantedAt: string | null): string | null {
  const when = grantedAt === null ? null : formatDate(grantedAt);
  if (grantedByName === null && when === null) return null;
  if (grantedByName === null) return `Granted ${when ?? ""}`;
  return when === null ? `Granted by ${grantedByName}` : `Granted by ${grantedByName} · ${when}`;
}

export function KeyCard({
  testId,
  prefix,
  title,
  purpose,
  emptyTitle,
  emptyBody,
  roles,
  defaultRole,
  grants,
  members,
  canIssue,
  issue,
  revoke,
  grantedToast,
  revokedToast,
  consequence,
}: {
  /** The card's test id (`money-authority` / `finance-authority`). */
  testId: string;
  /** Test-id stem for the form and rows: `authority` or `finance`. */
  prefix: "authority" | "finance";
  title: string;
  purpose: string;
  emptyTitle: string;
  emptyBody: string;
  roles: readonly { value: string; label: string; description: string }[];
  defaultRole: string;
  grants: readonly KeyGrant[];
  members: readonly KeyMember[];
  canIssue: boolean;
  issue: (personId: string, role: string) => Promise<Result>;
  revoke: (grantId: string) => Promise<Result>;
  grantedToast: string;
  revokedToast: string;
  /** What the revoke dialog says is lost, for this holder. */
  consequence: (holder: string, last: boolean) => ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [giving, setGiving] = useState(false);
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState(defaultRole);
  const [revoking, setRevoking] = useState<KeyGrant | null>(null);

  const roleLabel = (set: string) => roles.find((entry) => entry.value === set)?.label ?? set;
  const holders = new Set(grants.map((grant) => grant.personId));
  const listTestId = prefix === "authority" ? "authority-list" : "finance-authority-list";
  const rowTestId = (id: string) =>
    prefix === "authority" ? `authority-${id}` : `finance-authority-${id}`;

  const act = async (run: () => Promise<Result>, done: string): Promise<boolean> => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (result.ok) {
      toast({ title: done, tone: "success" });
      router.refresh();
      return true;
    }
    toast({ title: result.error ?? "Refused.", tone: "danger" });
    return false;
  };

  return (
    <section className="od-key" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <div className="od-key-head">
        <span className="od-key-icon" aria-hidden>
          <IconKey size={18} />
        </span>
        <div className="od-key-text">
          <h2 id={`${testId}-title`}>{title}</h2>
          <p>{purpose}</p>
        </div>
        {canIssue ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPersonId("");
              setRole(defaultRole);
              setGiving(true);
            }}
            data-testid={`open-grant-${prefix}`}
          >
            <IconPlus size={14} aria-hidden />
            Give this key
          </Button>
        ) : null}
      </div>

      {grants.length === 0 ? (
        <div className="od-key-empty">
          <h3>{emptyTitle}</h3>
          <p>{emptyBody}</p>
        </div>
      ) : (
        <ul className="od-key-holders" data-testid={listTestId}>
          {grants.map((grant) => {
            const provenance = grantedLine(grant.grantedByName, grant.grantedAt);
            return (
              <li
                key={grant.grantId}
                className="od-key-row"
                data-testid={rowTestId(grant.personId)}
              >
                <span className="od-authority-avatar" aria-hidden>
                  {personInitials(grant)}
                </span>
                <span className="od-key-id">
                  <strong>{personLabel(grant)}</strong>
                  {/* Who handed this over, and when. */}
                  {provenance !== null ? <span>{provenance}</span> : null}
                </span>
                <Pill tone="neutral">{roleLabel(grant.capabilitySet)}</Pill>
                {canIssue ? (
                  <PopoverMenu
                    label={`Actions for ${personLabel(grant)}`}
                    trigger={<IconKebab size={18} />}
                    triggerClassName="od-member-kebab"
                    items={[
                      {
                        key: "revoke",
                        label: "Revoke…",
                        danger: true,
                        testId:
                          prefix === "authority"
                            ? `revoke-authority-${grant.personId}`
                            : `revoke-finance-${grant.personId}`,
                        onSelect: () => {
                          setRevoking(grant);
                        },
                      },
                    ]}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canIssue ? null : (
        <p className="authority-hint">Only someone who can hand out roles here can change this.</p>
      )}

      {/* Rendered only while open: a closed Dialog keeps its form in the DOM. */}
      {giving ? (
        <Dialog
          open
          onClose={() => {
            setGiving(false);
          }}
          title={`Give the “${title}” key`}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setGiving(false);
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={busy || personId === ""}
                onClick={() => {
                  void act(() => issue(personId, role), grantedToast).then((ok) => {
                    if (ok) {
                      setGiving(false);
                    }
                  });
                }}
                data-testid={prefix === "authority" ? "grant-authority" : "grant-finance"}
              >
                Grant
              </Button>
            </>
          }
        >
          <div className="od-key-form">
            <Select
              label="Who?"
              value={personId}
              onChange={(event) => {
                setPersonId(event.target.value);
              }}
              data-testid={prefix === "authority" ? "authority-person" : "finance-person"}
            >
              <option value="">Choose a member</option>
              {members
                .filter((member) => !holders.has(member.personId))
                .map((member) => (
                  <option key={member.personId} value={member.personId}>
                    {personLabel(member)}
                  </option>
                ))}
            </Select>
            <Select
              label={prefix === "authority" ? "Settlement role" : "Finance role"}
              help={roles.find((entry) => entry.value === role)?.description}
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
              }}
              data-testid={prefix === "authority" ? "authority-role" : "finance-role"}
            >
              {roles.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>
        </Dialog>
      ) : null}

      {/* Revoking was one click once. What is lost is named before it is taken,
          and the server refuses the last controller outright. */}
      {revoking !== null ? (
        <Dialog
          open
          onClose={() => {
            setRevoking(null);
          }}
          title={`Revoke ${roleLabel(revoking.capabilitySet)}?`}
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
                  void act(() => revoke(grant.grantId), revokedToast).then(() => {
                    setRevoking(null);
                  });
                }}
                data-testid={
                  prefix === "authority" ? "confirm-revoke-authority" : "confirm-revoke-finance"
                }
              >
                Revoke
              </Button>
            </>
          }
        >
          <p
            data-testid={
              prefix === "authority" ? "revoke-authority-consequence" : "revoke-finance-consequence"
            }
          >
            {consequence(personLabel(revoking), grants.length === 1)}
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}
