"use client";

import { CAPABILITY_SETS } from "@desiauction/core";
import { Badge, Button, Card, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createInviteAction,
  issueGrantAction,
  revokeGrantAction,
  type OrgView,
} from "../../../server/orgs/actions";

export function MembersPanel({ view, slug }: { view: OrgView; slug: string }) {
  const router = useRouter();
  const toast = useToast();
  const [inviteSet, setInviteSet] = useState("org:staff");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invite = async () => {
    setBusy(true);
    const result = await createInviteAction(slug, inviteSet);
    setBusy(false);
    if ("url" in result) {
      setInviteUrl(`${window.location.origin}${result.url}`);
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  };

  return (
    <>
      <Card data-testid="members-panel">
        <h2>Members</h2>
        <ul className="member-list">
          {view.members.map((member) => (
            <li key={member.personId}>
              <span className="member-name">{member.name ?? "Unnamed"}</span>
              <span className="member-phone">{member.phone}</span>
              <span className="member-sets">
                {member.capabilitySets.map((set) => (
                  <Badge key={set} tone={set === "org:owner" ? "info" : "neutral"}>
                    {set}
                  </Badge>
                ))}
              </span>
              {view.viewer.canIssueGrants && member.personId !== view.viewer.personId ? (
                <span className="member-actions">
                  {!member.capabilitySets.includes("org:staff") ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void issueGrantAction(slug, member.personId, "org:staff").then(() => {
                          router.refresh();
                        });
                      }}
                    >
                      Make staff
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void revokeGrantAction(slug, member.personId, "org:staff").then(() => {
                          router.refresh();
                        });
                      }}
                    >
                      Remove staff
                    </Button>
                  )}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {view.viewer.canInvite ? (
        <Card data-testid="invite-panel">
          <h2>Invite a member</h2>
          <div className="invite-row">
            <Select
              label="They join as"
              value={inviteSet}
              onChange={(event) => {
                setInviteSet(event.target.value);
              }}
            >
              {CAPABILITY_SETS.filter((set) => set !== "org:owner").map((set) => (
                <option key={set} value={set}>
                  {set}
                </option>
              ))}
            </Select>
            <Button onClick={() => void invite()} loading={busy} data-testid="create-invite">
              Create invite link
            </Button>
          </div>
          {inviteUrl !== null ? (
            <p className="invite-url" data-testid="invite-url">
              {inviteUrl}
            </p>
          ) : null}
          <p style={{ color: "var(--text-secondary)" }}>
            Share this link yourself — over WhatsApp, however you like. It works once and expires in
            7 days.
          </p>
        </Card>
      ) : null}
    </>
  );
}
