"use client";

import { Button, Dialog, Field, Select, SectionCard, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { useStepUp, type GatedResult } from "../../../../components/admin/use-step-up";
import type { ClubDesk } from "../../../../server/platform-ops/club";
import {
  addClubRoleAction,
  reissueOwnerLinkAction,
  removeClubRoleAction,
  setAuctioneerAction,
  transferOwnershipAction,
  type ClubDeskResult,
} from "../../../../server/platform-ops/club-actions";

/*
 * THE CLUB ROLES DESK (AC-1.3) — the superadmin's controls on a club's page.
 * Every act: press, fill in what it needs, write why (it lands in the club's
 * own history), confirm it's you if needed, read the outcome. A link the
 * desk makes (a club invite, a team-owner link) is shown to copy and send.
 */

interface Member {
  readonly personId: string;
  readonly name: string | null;
}

type Act =
  | { kind: "add" }
  | { kind: "remove"; personId: string; name: string; role: "org:owner" | "org:staff" }
  | { kind: "transfer"; personId: string; name: string }
  | { kind: "assign"; seasonId: string; seasonName: string }
  | { kind: "unassign"; seasonId: string; personId: string; name: string }
  | { kind: "link"; seasonId: string; teamId: string; teamName: string };

const TITLE: Record<Act["kind"], string> = {
  add: "Add an owner or staff",
  remove: "Remove a club role",
  transfer: "Transfer ownership",
  assign: "Assign the auctioneer",
  unassign: "Remove the auctioneer",
  link: "New team-owner link",
};

export function ClubDeskPanel({
  slug,
  clubName,
  desk,
  members,
}: {
  slug: string;
  clubName: string;
  desk: ClubDesk;
  members: readonly Member[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { run, dialog: stepUpDialog } = useStepUp();
  const [act, setAct] = useState<Act | null>(null);
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [role, setRole] = useState<"org:owner" | "org:staff">("org:staff");
  const [pick, setPick] = useState("");
  const [busy, start] = useTransition();
  const [link, setLink] = useState<{ message: string; url: string } | null>(null);

  const nameOf = (personId: string) =>
    members.find((member) => member.personId === personId)?.name ?? "Unnamed";

  const open = (next: Act) => {
    setReason("");
    setContact("");
    setRole("org:staff");
    setPick("");
    setAct(next);
  };

  const submit = () => {
    if (act === null) {
      return;
    }
    const call = (): Promise<ClubDeskResult> => {
      switch (act.kind) {
        case "add":
          return addClubRoleAction({ slug, contact, role, reason });
        case "remove":
          return removeClubRoleAction({ slug, personId: act.personId, role: act.role, reason });
        case "transfer":
          return transferOwnershipAction({
            slug,
            fromPersonId: act.personId,
            toContact: contact,
            reason,
          });
        case "assign":
          return setAuctioneerAction({
            slug,
            seasonId: act.seasonId,
            personId: pick,
            assign: true,
            reason,
          });
        case "unassign":
          return setAuctioneerAction({
            slug,
            seasonId: act.seasonId,
            personId: act.personId,
            assign: false,
            reason,
          });
        case "link":
          return reissueOwnerLinkAction({
            slug,
            seasonId: act.seasonId,
            teamId: act.teamId,
            reason,
          });
      }
    };
    // One transition for the action and the refresh — see person-actions.tsx.
    start(async () => {
      let outcome: ClubDeskResult | null = null;
      const result = await run(async (): Promise<GatedResult> => {
        outcome = await call();
        return outcome.ok ? { ok: true } : outcome;
      });
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      const finished = outcome as ClubDeskResult | null;
      setAct(null);
      if (finished?.ok === true && finished.link !== undefined) {
        setLink({ message: finished.message, url: `${window.location.origin}${finished.link}` });
      } else if (finished?.ok === true) {
        toast({ title: finished.message, tone: "success" });
      }
      router.refresh();
    });
  };

  const needsContact = act?.kind === "add" || act?.kind === "transfer";
  const ready =
    reason.trim().length >= 10 &&
    (!needsContact || contact.trim() !== "") &&
    (act?.kind !== "assign" || pick !== "");

  const body: Record<Act["kind"], ReactNode> = {
    add: (
      <>
        <Field
          label="Their mobile number or email"
          name="contact"
          value={contact}
          onChange={(event) => {
            setContact(event.target.value);
          }}
          help="If they've never signed in, you'll get the club's invitation link to send them."
          data-testid="desk-contact"
        />
        <Select
          label="Role"
          name="role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value === "org:owner" ? "org:owner" : "org:staff");
          }}
          data-testid="desk-role"
        >
          <option value="org:staff">Staff — runs seasons, no money or club settings</option>
          <option value="org:owner">Owner — everything, including money and roles</option>
        </Select>
      </>
    ),
    remove: (
      <p>
        {act?.kind === "remove" ? act.name : ""} stops being{" "}
        {act?.kind === "remove" && act.role === "org:owner" ? "an owner" : "staff"} of {clubName}.
        They stay a member.
      </p>
    ),
    transfer: (
      <>
        <p>
          The new owner is added and {act?.kind === "transfer" ? act.name : ""} steps down, in one
          step — the club is never without an owner.
        </p>
        <Field
          label="New owner's mobile number or email"
          name="contact"
          value={contact}
          onChange={(event) => {
            setContact(event.target.value);
          }}
          help="They must have signed in to DesiAuction at least once."
          data-testid="desk-contact"
        />
      </>
    ),
    assign: (
      <Select
        label="Club member"
        name="person"
        value={pick}
        onChange={(event) => {
          setPick(event.target.value);
        }}
        data-testid="desk-member"
      >
        <option value="">Choose…</option>
        {members.map((member) => (
          <option key={member.personId} value={member.personId}>
            {member.name ?? "Unnamed"}
          </option>
        ))}
      </Select>
    ),
    unassign: (
      <p>{act?.kind === "unassign" ? act.name : ""} stops conducting this season&apos;s auction.</p>
    ),
    link: (
      <p>
        Every unused link for {act?.kind === "link" ? act.teamName : ""} stops working, and you get
        a fresh one to send the team&apos;s owner.
      </p>
    ),
  };

  return (
    <SectionCard
      title="Club roles desk"
      tone="amber"
      description="Act for this club when it's stuck. Every change needs a reason and is written to the club's own history."
      data-testid="club-desk"
    >
      <div className="club-desk">
        <div className="admin-pills">
          <Button
            size="sm"
            onClick={() => {
              open({ kind: "add" });
            }}
            data-testid="desk-add"
          >
            Add an owner or staff
          </Button>
        </div>
        <ul className="admin-role-holders">
          {desk.owners.map((personId) => (
            <li key={`o-${personId}`}>
              <strong>{nameOf(personId)}</strong> · owner{" "}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  open({ kind: "transfer", personId, name: nameOf(personId) });
                }}
                data-testid="desk-transfer"
              >
                Transfer ownership
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  open({ kind: "remove", personId, name: nameOf(personId), role: "org:owner" });
                }}
              >
                Remove
              </Button>
            </li>
          ))}
          {desk.staff.map((personId) => (
            <li key={`s-${personId}`}>
              <strong>{nameOf(personId)}</strong> · staff{" "}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  open({ kind: "remove", personId, name: nameOf(personId), role: "org:staff" });
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        {desk.seasons.map((season) => (
          <div key={season.id} className="club-desk-season">
            <h3>{season.name}</h3>
            <p className="admin-meta">
              Auctioneer:{" "}
              {season.auctioneers.length === 0
                ? "none"
                : season.auctioneers.map((row) => row.name ?? "Unnamed").join(", ")}{" "}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  open({ kind: "assign", seasonId: season.id, seasonName: season.name });
                }}
              >
                Assign
              </Button>
              {season.auctioneers.map((row) => (
                <Button
                  key={row.personId}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    open({
                      kind: "unassign",
                      seasonId: season.id,
                      personId: row.personId,
                      name: row.name ?? "Unnamed",
                    });
                  }}
                >
                  Remove {row.name ?? "auctioneer"}
                </Button>
              ))}
            </p>
            {season.teams.length === 0 ? null : (
              <ul className="admin-role-holders">
                {season.teams.map((team) => (
                  <li key={team.id}>
                    {team.name} ·{" "}
                    {team.ownerJoined ? (
                      <span className="admin-meta">owner joined</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          open({
                            kind: "link",
                            seasonId: season.id,
                            teamId: team.id,
                            teamName: team.name,
                          });
                        }}
                      >
                        New owner link
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <Dialog
        open={act !== null}
        onClose={() => {
          setAct(null);
        }}
        title={act === null ? "" : TITLE[act.kind]}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAct(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={!ready} data-testid="desk-confirm">
              {act === null ? "" : TITLE[act.kind]}
            </Button>
          </>
        }
      >
        {act === null ? null : body[act.kind]}
        <Field
          label="Reason"
          name="reason"
          maxLength={500}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          help="Written to the club's history. 10–500 characters."
          data-testid="desk-reason"
        />
      </Dialog>
      <Dialog
        open={link !== null}
        onClose={() => {
          setLink(null);
        }}
        title="Send this link"
        footer={
          <Button
            onClick={() => {
              if (link !== null) {
                void navigator.clipboard.writeText(link.url).then(() => {
                  toast({ title: "Link copied", tone: "success" });
                });
              }
            }}
          >
            Copy link
          </Button>
        }
      >
        <p>{link?.message}</p>
        <p className="admin-id" data-testid="desk-link">
          {link?.url}
        </p>
      </Dialog>
      {stepUpDialog}
    </SectionCard>
  );
}
