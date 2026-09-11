"use client";

import { CAPABILITY_SETS } from "@desiauction/core";
import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  Field,
  Select,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { avatarColor } from "../../../components/avatar-color";
import {
  createInviteAction,
  issueGrantAction,
  removeMemberAction,
  revokeGrantAction,
  revokeInviteAction,
  type OrgView,
} from "../../../server/orgs/actions";
import type { MemberRow } from "../../../server/orgs/orgs";
import { personContact, personInitials } from "../../../lib/person-label";

/**
 * A capability set → the pill the row shows.
 *
 * The label is now the PLAIN word. The technical set is what an operator
 * reasons about in a grants table, not what a club secretary reads down a list
 * of seven people — and /orgs has always said "Owner"/"Staff"/"Member" in its
 * role badge while this grid said ORG:OWNER two clicks away. One vocabulary,
 * the plain one; the technical name stays reachable as the pill's tooltip.
 */
function rolePill(set: string): { key: string; label: string; technical: string } {
  if (set === "org:owner") return { key: "owner", label: "Owner", technical: "ORG:OWNER" };
  if (set === "org:staff") return { key: "staff", label: "Staff", technical: "ORG:STAFF" };
  if (set === "viewer") return { key: "viewer", label: "Member", technical: "VIEWER" };
  if (set.startsWith("settlement:")) {
    return { key: "settlement", label: "Settles money", technical: set.toUpperCase() };
  }
  if (set.startsWith("finops:")) {
    return { key: "finops", label: "Speaks for the money", technical: set.toUpperCase() };
  }
  return { key: "other", label: set, technical: set.toUpperCase() };
}

/** "Jan 2021" — the Joined column, month + year as the design shows. */
function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata", // PRR P2/F25: pin the zone or SSR/CSR disagree
    month: "short",
    year: "numeric",
  });
}

/** "24 Jul 2026" — precise enough for provenance, short enough for a tooltip. */
function grantedLabel(iso: string | null): string | null {
  return iso === null
    ? null
    : new Date(iso).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata", // PRR P2/F25: pin the zone or SSR/CSR disagree
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

/** Invite dialog: the human name and one-line meaning of each joinable role. */
const INVITE_ROLE_LABEL: Record<string, string> = {
  "org:staff": "Staff",
  viewer: "Member",
};

const INVITE_ROLE_HELP: Record<string, string> = {
  "org:staff": "Runs seasons, teams, registrations and fixtures — not the money or roles.",
  viewer: "Read-only access to this organization.",
};

/** What a destructive click has to say out loud before it happens. */
interface Consequence {
  title: string;
  body: string;
  confirmLabel: string;
  run: () => Promise<{ ok: boolean; error?: string }>;
}

export function MembersPanel({ view, slug }: { view: OrgView; slug: string }) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSet, setInviteSet] = useState("org:staff");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteReference, setInviteReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<Consequence | null>(null);
  const inviteResultRef = useRef<HTMLDivElement | null>(null);

  // The minted link used to appear silently with focus still on <body>: a
  // one-time secret announced to nobody. It is a status region now, and it
  // takes focus the moment it exists.
  useEffect(() => {
    if (inviteUrl !== null) {
      inviteResultRef.current?.focus();
    }
  }, [inviteUrl]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return view.members;
    return view.members.filter((member) => {
      // Search what the reader can SEE. The grid shows "+91 99990 00002"; a
      // filter that only matched "+919999000002" answered "no results" to the
      // string the user had just read off the row above.
      const haystack = [
        member.name ?? "",
        member.phone ?? "",
        member.email ?? "",
        personContact(member),
        ...member.capabilitySets.map((set) => rolePill(set).label),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, view.members]);

  /** Live, unused links for the role the dialog is currently set to. */
  const outstandingForRole = view.pendingInvites.filter(
    (row) => row.capabilitySet === inviteSet,
  ).length;

  const invite = async () => {
    setBusy(true);
    const result = await createInviteAction(slug, inviteSet);
    setBusy(false);
    if ("url" in result) {
      setCopied(false);
      setInviteReference(result.reference);
      setInviteUrl(`${window.location.origin}${result.url}`);
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  };

  const confirm = async () => {
    if (pending === null) return;
    setBusy(true);
    const result = await pending.run();
    setBusy(false);
    if (result.ok) {
      setPending(null);
      router.refresh();
    } else {
      toast({ title: result.error ?? "Refused.", tone: "danger" });
    }
  };

  const copy = async () => {
    if (inviteUrl === null) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      toast({ title: "Couldn't copy — select the link and copy it by hand.", tone: "danger" });
    }
  };

  /* The directory is not in the payload at all for someone who may not read it
     (orgView gates it), so this is the honest state rather than an empty grid
     that looks like a club with no members. */
  if (!view.viewer.canSeeMembers) {
    return (
      <Card data-testid="members-panel">
        <div className="od-member-head">
          <div className="od-member-title">
            <h2>Members</h2>
            <span className="od-member-count">{view.memberCount}</span>
          </div>
        </div>
        <EmptyState
          headingLevel={3}
          title="The member list isn't yours to see"
          description={`${String(view.memberCount)} ${view.memberCount === 1 ? "person belongs" : "people belong"} to this organization. Names and phone numbers are shown to whoever can invite people or hand out roles — ask an owner if you need them.`}
        />
      </Card>
    );
  }

  return (
    <Card data-testid="members-panel">
      <div className="od-member-head">
        <div className="od-member-title">
          <h2>Members</h2>
          <span className="od-member-count">{view.memberCount}</span>
        </div>
        <div className="od-member-tools">
          {/* A raw <input> at 220x34 that missed the Field standardisation
              entirely — no wired label, no shared chrome, below the input
              rung every other control on the page sits at. */}
          <div className="od-member-searchbox">
            <Field
              label="Search members"
              type="search"
              placeholder="Name, number or role"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          {/* Settlement/finance grants are handed out on the Money & roles tab —
              a distinct act of trust from org staff, so it lives there. Only
              somebody who can actually issue one is offered the trip. */}
          {view.viewer.canIssueGrants ? (
            <ButtonLink href={`/org/${slug}#money`} variant="secondary" size="touch">
              Manage roles
            </ButtonLink>
          ) : null}
          {view.viewer.canInvite ? (
            <Button
              size="touch"
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

      {/* A grid of people, announced as one. It was a <ul> with column headings
          marked aria-hidden, so assistive technology met seven undifferentiated
          list items and no way to know which value was a role and which a date.
          Explicit roles rather than a <table>: the flex layout the design needs
          would strip a real table's semantics anyway. */}
      <div className="od-member-table" role="table" aria-label="Members">
        <div className="od-member-cols" role="row">
          <span className="od-member-person" role="columnheader">
            Person
          </span>
          <span className="od-member-roles" role="columnheader">
            Roles
          </span>
          <span className="od-member-joined" role="columnheader">
            Joined
          </span>
          <span className="od-member-action" role="columnheader">
            <VisuallyHidden>Actions</VisuallyHidden>
          </span>
        </div>

        <div className="od-member-list" role="rowgroup">
          {filtered.map((member) => (
            <MemberRowView
              key={member.personId}
              member={member}
              view={view}
              slug={slug}
              onIntent={setPending}
              onGrant={() => {
                void issueGrantAction(slug, member.personId, "org:staff").then(() => {
                  router.refresh();
                });
              }}
            />
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="od-member-empty" role="status">
          No members match “{query}”.
        </p>
      ) : null}

      {/* Outstanding links. `revokeInvite` has existed since IP-2 with no caller
          and no surface, so a link forwarded to the wrong number stayed live for
          seven days with nothing in the product even admitting it existed. */}
      {view.viewer.canInvite && view.pendingInvites.length > 0 ? (
        <section className="od-pending" aria-labelledby="od-pending-title">
          <h3 id="od-pending-title">
            Invite links waiting to be used ({view.pendingInvites.length})
          </h3>
          <ul className="od-pending-list">
            {view.pendingInvites.map((pending) => (
              <li key={pending.id} className="od-pending-row">
                {/* Twelve rows that read "Joins as Staff · works once · expires
                    31 Jul 2026" are twelve identical rows. `invites` has no
                    `created_at` column and this work adds no migration — but
                    every id here is a ULID, whose first ten characters ARE its
                    mint time, and the row has always carried who minted it.
                    Plus a reference echoed beside the URL at mint time, so a row
                    can be matched to a link that was sent. */}
                <span className="od-pending-id">
                  <strong>Joins as {INVITE_ROLE_LABEL[pending.capabilitySet] ?? "a member"}</strong>
                  <span>
                    Ref {pending.reference} · works once · expires{" "}
                    {grantedLabel(pending.expiresAt) ?? "soon"}
                  </span>
                  <span>
                    {pending.createdByName === null
                      ? "Minted"
                      : `Minted by ${pending.createdByName}`}
                    {pending.createdAt === null
                      ? ""
                      : ` · ${grantedLabel(pending.createdAt) ?? ""}`}
                  </span>
                </span>
                <Button
                  size="touch"
                  variant="ghost"
                  onClick={() => {
                    setPending({
                      title: "Revoke this invite link?",
                      body: `The link stops working immediately. Anyone holding it — including whoever you meant to send it to — can no longer join ${view.org.name} with it, and there is no way to bring it back. Mint a fresh one instead.`,
                      confirmLabel: "Revoke link",
                      run: () => revokeInviteAction(slug, pending.id),
                    });
                  }}
                  data-testid={`revoke-invite-${pending.id}`}
                >
                  Revoke link
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
        {/* UNBOUNDED MINTING. Six clicks produced six live 192-bit credentials
            with nothing said about the five already outstanding. There is no
            rate limit behind this button and adding one is a separate decision;
            what the dialog can do — and never did — is tell the truth about
            what is already live for the role being minted. */}
        {outstandingForRole > 0 ? (
          <p className="od-invite-lead" role="status" data-testid="invite-outstanding">
            You already have {outstandingForRole} unused {INVITE_ROLE_LABEL[inviteSet] ?? inviteSet}{" "}
            link
            {outstandingForRole === 1 ? "" : "s"} waiting to be used. Each one is a live key to this
            organization — send an existing link rather than minting another, or revoke the ones you
            no longer need.
          </p>
        ) : null}
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
          <div
            className="od-invite-result"
            data-testid="invite-result"
            role="status"
            tabIndex={-1}
            ref={inviteResultRef}
          >
            {/* The testid stays on the URL ALONE: it is read as text by three
                e2e journeys that then navigate to it, and a note plus a copy
                button folded into the same node would make it un-navigable. */}
            <span className="od-invite-url" data-testid="invite-url">
              {inviteUrl}
            </span>
            <div className="od-invite-actions">
              <span className="od-invite-note">
                Copy it now — it&apos;s shown once.
                {inviteReference === null ? "" : ` Ref ${inviteReference}.`}
              </span>
              <Button
                size="touch"
                variant="secondary"
                onClick={() => void copy()}
                data-testid="copy-invite"
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Every permission change that TAKES something away names what is lost
          before it happens — the repo's Dialog, never window.confirm. */}
      <Dialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
        }}
        title={pending?.title ?? ""}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPending(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirm()}
              loading={busy}
              data-testid="confirm-member-change"
            >
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        <p data-testid="member-change-consequence">{pending?.body}</p>
      </Dialog>
    </Card>
  );
}

function MemberRowView({
  member,
  view,
  slug,
  onIntent,
  onGrant,
}: {
  member: MemberRow;
  view: OrgView;
  slug: string;
  onIntent: (consequence: Consequence) => void;
  onGrant: () => void;
}) {
  const name = member.name ?? "Unnamed";
  const isOwner = member.capabilitySets.includes("org:owner");
  const isStaff = member.capabilitySets.includes("org:staff");
  const isSelf = member.personId === view.viewer.personId;
  const pills = member.capabilitySets.length === 0 ? ["viewer"] : member.capabilitySets;

  return (
    <div className="od-member-row" role="row" data-testid={`member-${member.personId}`}>
      <span className="od-member-person" role="cell">
        <span
          className="od-member-avatar"
          style={{ background: avatarColor(member.personId) }}
          aria-hidden
        >
          {personInitials(member)}
        </span>
        <span className="od-member-id">
          <strong>{name}</strong>
          <span className="od-member-phone">{personContact(member)}</span>
        </span>
      </span>
      <span className="od-member-roles" role="cell">
        {pills.map((set) => {
          const pill = rolePill(set);
          const grant = member.roles.find((row) => row.capabilitySet === set);
          const granted = grantedLabel(grant?.grantedAt ?? null);
          // Provenance the grants table has always stored and no surface ever
          // showed: who let this person near this, and when.
          const provenance =
            grant === undefined
              ? pill.technical
              : [
                  pill.technical,
                  grant.grantedByName === null ? null : `granted by ${grant.grantedByName}`,
                  granted,
                ]
                  .filter((part) => part !== null)
                  .join(" · ");
          return (
            <span key={set} className="od-role-pill" data-role={pill.key} title={provenance}>
              {pill.label}
            </span>
          );
        })}
      </span>
      <span className="od-member-joined" role="cell">
        <span className="od-member-joined-label">Joined </span>
        {joinedLabel(member.joinedAt)}
      </span>
      <span className="od-member-action" role="cell">
        {view.viewer.canIssueGrants && !isSelf ? (
          isStaff ? (
            <Button
              size="touch"
              variant="ghost"
              onClick={() => {
                onIntent({
                  title: `Remove ${name} from staff?`,
                  body: `${name} loses the ability to run seasons, add teams, review registrations and manage fixtures for this organization. They stay a member and keep read access. You can make them staff again at any time.`,
                  confirmLabel: "Remove staff",
                  run: () => revokeGrantAction(slug, member.personId, "org:staff"),
                });
              }}
              data-testid={`remove-staff-${member.personId}`}
            >
              Remove staff
            </Button>
          ) : /* "Make staff" on a row that already reads Owner offered a
                 DEMOTION dressed as a promotion — staff is a strictly smaller
                 set than owner, and issuing it changed nothing at all. */
          isOwner ? null : (
            <Button size="touch" variant="secondary" onClick={onGrant}>
              Make staff
            </Button>
          )
        ) : null}
        {view.viewer.canRemove && !isSelf ? (
          <Button
            size="touch"
            variant="ghost"
            onClick={() => {
              onIntent({
                title: `Remove ${name} from ${view.org.name}?`,
                body: `${name} loses every role they hold here, disappears from this member list, and this organization disappears from theirs — including any tournament, team or money surface it reaches. Their account and their own organizations are untouched. They can only come back through a fresh invite link.`,
                confirmLabel: "Remove from organization",
                run: () => removeMemberAction(slug, member.personId),
              });
            }}
            data-testid={`remove-member-${member.personId}`}
          >
            Remove
          </Button>
        ) : null}
      </span>
    </div>
  );
}
