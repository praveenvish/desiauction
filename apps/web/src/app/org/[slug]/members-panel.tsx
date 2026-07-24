"use client";

import { CAPABILITY_SETS } from "@desiauction/core";
import { Button, ButtonLink, Card, Dialog, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  createInviteAction,
  issueGrantAction,
  revokeGrantAction,
  type OrgView,
} from "../../../server/orgs/actions";

/** Initials for the avatar — first code points of up to two words. */
function initials(name: string | null, phone: string): string {
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

/** Stable per-person hue so an avatar keeps its colour across renders. */
function avatarHue(personId: string): number {
  let hash = 0;
  for (const char of personId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}

/**
 * A capability set → the mono pill the design shows. The label stays technical
 * (ORG:OWNER, SETTLEMENT, FINOPS) because these ARE the grant names an operator
 * reasons about; `key` drives the colour. A member can hold several.
 */
function rolePill(set: string): { key: string; label: string } {
  if (set === "org:owner") return { key: "owner", label: "ORG:OWNER" };
  if (set === "org:staff") return { key: "staff", label: "ORG:STAFF" };
  if (set === "viewer") return { key: "viewer", label: "VIEWER" };
  if (set.startsWith("settlement:")) return { key: "settlement", label: "SETTLEMENT" };
  if (set.startsWith("finops:")) return { key: "finops", label: "FINOPS" };
  return { key: "other", label: set.toUpperCase() };
}

/** "Jan 2021" — the Joined column, month + year as the design shows. */
function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** Invite dialog: the human name and one-line meaning of each joinable role. */
const INVITE_ROLE_LABEL: Record<string, string> = {
  "org:staff": "Staff",
  viewer: "Viewer",
};

const INVITE_ROLE_HELP: Record<string, string> = {
  "org:staff": "Runs seasons, teams, registrations and fixtures — not the money or roles.",
  viewer: "Read-only access to this organization.",
};

export function MembersPanel({ view, slug }: { view: OrgView; slug: string }) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSet, setInviteSet] = useState("org:staff");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return view.members;
    return view.members.filter(
      (member) =>
        (member.name ?? "").toLowerCase().includes(needle) || member.phone.includes(needle),
    );
  }, [query, view.members]);

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
    <Card data-testid="members-panel">
      <div className="od-member-head">
        <div className="od-member-title">
          <h2>Members</h2>
          <span className="od-member-count">{view.members.length}</span>
        </div>
        <div className="od-member-tools">
          <input
            type="search"
            className="od-member-search"
            placeholder="Search members"
            aria-label="Search members"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {/* Settlement/finance grants are handed out on the Money & roles tab —
              a distinct act of trust from org staff, so it lives there. */}
          <ButtonLink href={`/org/${slug}#money`} variant="secondary" size="sm">
            Manage roles
          </ButtonLink>
          {view.viewer.canInvite ? (
            <Button
              size="sm"
              onClick={() => {
                setInviteUrl(null);
                setInviteOpen(true);
              }}
              data-testid="open-invite"
            >
              + Invite member
            </Button>
          ) : null}
        </div>
      </div>

      <div className="od-member-cols" aria-hidden>
        <span className="od-member-person">Person</span>
        <span className="od-member-roles">Roles</span>
        <span className="od-member-joined">Joined</span>
        <span className="od-member-action" />
      </div>

      <ul className="od-member-list">
        {filtered.map((member) => (
          <li key={member.personId} className="od-member-row">
            <span className="od-member-person">
              <span
                className="od-member-avatar"
                style={{ background: `hsl(${String(avatarHue(member.personId))} 55% 42%)` }}
                aria-hidden
              >
                {initials(member.name, member.phone)}
              </span>
              <span className="od-member-id">
                <strong>{member.name ?? "Unnamed"}</strong>
                <span className="od-member-phone">{member.phone}</span>
              </span>
            </span>
            <span className="od-member-roles">
              {member.capabilitySets.length === 0 ? (
                <span className="od-role-pill" data-role="viewer">
                  MEMBER
                </span>
              ) : (
                member.capabilitySets.map((set) => {
                  const pill = rolePill(set);
                  return (
                    <span key={set} className="od-role-pill" data-role={pill.key}>
                      {pill.label}
                    </span>
                  );
                })
              )}
            </span>
            <span className="od-member-joined">{joinedLabel(member.joinedAt)}</span>
            <span className="od-member-action">
              {view.viewer.canIssueGrants && member.personId !== view.viewer.personId ? (
                !member.capabilitySets.includes("org:staff") ? (
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
                )
              ) : null}
            </span>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="od-member-empty">No members match “{query}”.</li>
        ) : null}
      </ul>

      <Dialog
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
        }}
        title="Invite a member"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setInviteOpen(false);
              }}
            >
              Close
            </Button>
            <Button onClick={() => void invite()} loading={busy} data-testid="create-invite">
              Create invite link
            </Button>
          </>
        }
      >
        <p className="od-invite-lead">
          Mint a one-time link and share it yourself — over WhatsApp, however you like. It works
          once and expires in 7 days.
        </p>
        <Select
          label="They join as"
          help={INVITE_ROLE_HELP[inviteSet]}
          value={inviteSet}
          onChange={(event) => {
            setInviteSet(event.target.value);
          }}
        >
          {CAPABILITY_SETS.filter((set) => set !== "org:owner").map((set) => (
            <option key={set} value={set}>
              {INVITE_ROLE_LABEL[set] ?? set}
            </option>
          ))}
        </Select>
        {inviteUrl !== null ? (
          <div className="od-invite-result" data-testid="invite-url">
            <span className="od-invite-url">{inviteUrl}</span>
            <span className="od-invite-note">Copy it now — it&apos;s shown once.</span>
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}
