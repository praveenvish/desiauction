"use client";

import { Button, Dialog, Field, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";

import { useStepUp, type GatedResult } from "../../../../components/admin/use-step-up";
import {
  addClubRoleAction,
  moveTournamentAction,
  reissueOwnerLinkAction,
  removeClubRoleAction,
  setAuctioneerAction,
  transferOwnershipAction,
  type ClubDeskResult,
} from "../../../../server/platform-ops/club-actions";
import type { MoveSubject } from "../../../../server/platform-ops/move-tournament";

/*
 * THE SUPERADMIN'S CONTROLS ON A CLUB'S PAGE (AC-1.3, 0109).
 *
 * They used to be two cards of their own under the page — "Club roles desk"
 * and "Move to another club" — that listed every person, season, team and
 * tournament a second time just to hang buttons on them (founder, 2026-10-06:
 * "not understanding at all"). Now the page lists each thing once and the
 * button sits on it: Transfer on the owner's row, Assign on the season,
 * Move on the tournament. This file owns the dialogs those buttons open.
 *
 * Every act is the same: press, fill in what it needs, write why (it lands in
 * the club's own history), confirm it's you if needed, read the outcome. A
 * link the desk makes (a club invite, a team-owner link) is shown to copy.
 */

export type DeskAct =
  | { kind: "add" }
  | { kind: "remove"; personId: string; name: string; role: "org:owner" | "org:staff" }
  | { kind: "transfer"; personId: string; name: string }
  | { kind: "assign"; seasonId: string; seasonName: string }
  | { kind: "unassign"; seasonId: string; personId: string; name: string }
  | { kind: "link"; seasonId: string; teamId: string; teamName: string }
  | { kind: "move"; subject: MoveSubject };

const TITLE: Record<Exclude<DeskAct["kind"], "move">, string> = {
  add: "Add an owner or staff",
  remove: "Remove a club role",
  transfer: "Transfer ownership",
  assign: "Assign the auctioneer",
  unassign: "Remove the auctioneer",
  link: "New team-owner link",
};

const DeskContext = createContext<((act: DeskAct) => void) | null>(null);

/** A button that opens one of the desk's dialogs; nothing for a read-only admin. */
export function DeskAction({
  act,
  children,
  variant = "ghost",
  testId,
}: {
  act: DeskAct;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  testId?: string;
}) {
  const open = useContext(DeskContext);
  if (open === null) {
    return null;
  }
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={() => {
        open(act);
      }}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      {children}
    </Button>
  );
}

export function OrgDesk({
  slug,
  clubName,
  members,
  clubs,
  children,
}: {
  slug: string;
  clubName: string;
  members: readonly { personId: string; name: string | null }[];
  /** Other clubs a tournament can move to; empty when moving isn't offered. */
  clubs: readonly { slug: string; name: string }[];
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const { run, dialog: stepUpDialog } = useStepUp();
  const [act, setAct] = useState<DeskAct | null>(null);
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [role, setRole] = useState<"org:owner" | "org:staff">("org:staff");
  const [pick, setPick] = useState("");
  const [busy, start] = useTransition();
  const [link, setLink] = useState<{ message: string; url: string } | null>(null);

  const open = (next: DeskAct) => {
    setReason("");
    setContact("");
    setRole("org:staff");
    setPick("");
    setAct(next);
  };

  const targetName = clubs.find((club) => club.slug === pick)?.name ?? "";

  const submit = () => {
    if (act === null) {
      return;
    }
    const call = (): Promise<ClubDeskResult & { targetSlug?: string }> => {
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
        case "move":
          return moveTournamentAction({
            slug,
            subjectKind: act.subject.kind,
            subjectId: act.subject.id,
            targetSlug: pick,
            reason,
          });
      }
    };
    // One transition for the action and the refresh — see person-actions.tsx.
    start(async () => {
      let outcome: (ClubDeskResult & { targetSlug?: string }) | null = null;
      let result: GatedResult;
      try {
        result = await run(async (): Promise<GatedResult> => {
          outcome = await call();
          return outcome.ok ? { ok: true } : outcome;
        });
      } catch {
        toast({
          title: "We couldn't reach DesiAuction. Reload the page to see what changed.",
          tone: "danger",
        });
        return;
      }
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      const finished = outcome as (ClubDeskResult & { targetSlug?: string }) | null;
      setAct(null);
      if (finished?.ok === true && finished.link !== undefined) {
        setLink({ message: finished.message, url: `${window.location.origin}${finished.link}` });
      } else if (finished?.ok === true) {
        toast({ title: finished.message, tone: "success" });
      }
      // A moved tournament now lives in the other club: follow it there.
      if (finished?.ok === true && finished.targetSlug !== undefined) {
        router.push(`/admin/orgs/${finished.targetSlug}`);
      } else {
        router.refresh();
      }
    });
  };

  const needsContact = act?.kind === "add" || act?.kind === "transfer";
  const needsPick = act?.kind === "assign" || act?.kind === "move";
  const ready =
    reason.trim().length >= 10 &&
    (!needsContact || contact.trim() !== "") &&
    (!needsPick || pick !== "");

  const title =
    act === null ? "" : act.kind === "move" ? `Move ${act.subject.name}` : TITLE[act.kind];
  const confirm =
    act === null
      ? ""
      : act.kind === "move"
        ? targetName === ""
          ? "Move"
          : `Move to ${targetName}`
        : TITLE[act.kind];

  const body = (): ReactNode => {
    if (act === null) {
      return null;
    }
    switch (act.kind) {
      case "add":
        return (
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
        );
      case "remove":
        return (
          <p>
            {act.name} stops being {act.role === "org:owner" ? "an owner" : "staff"} of {clubName}.
            They stay a member.
          </p>
        );
      case "transfer":
        return (
          <>
            <p>
              The new owner is added and {act.name} steps down, in one step — the club is never
              without an owner.
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
        );
      case "assign":
        return (
          <>
            <p>They run {act.seasonName}&apos;s auction night from the conductor desk.</p>
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
          </>
        );
      case "unassign":
        return <p>{act.name} stops conducting this season&apos;s auction.</p>;
      case "link":
        return (
          <p>
            Every unused link for {act.teamName} stops working, and you get a fresh one to send the
            team&apos;s owner.
          </p>
        );
      case "move": {
        const subject = act.subject;
        return (
          <>
            <p>
              {subject.kind === "tournament"
                ? subject.seasons.length > 0
                  ? `Every season moves with it: ${subject.seasons.join(", ")}.`
                  : "It has no seasons yet."
                : subject.partOf === null
                  ? "This season moves on its own."
                  : `Only this season moves. ${subject.partOf} and its other seasons stay in ${clubName}; in the new club this season joins its ${subject.partOf}, which is created there if it doesn't exist.`}{" "}
              Team owners and auctioneers become members of the new club so they keep access.
              Franchise and ground links from {clubName} are cleared, since those stay behind.
            </p>
            <Select
              label="Move to club"
              name="target"
              value={pick}
              onChange={(event) => {
                setPick(event.target.value);
              }}
              data-testid="move-target"
            >
              <option value="">Choose…</option>
              {clubs.map((club) => (
                <option key={club.slug} value={club.slug}>
                  {club.name} ({club.slug})
                </option>
              ))}
            </Select>
          </>
        );
      }
    }
  };

  return (
    <DeskContext.Provider value={open}>
      {children}
      <Dialog
        open={act !== null}
        onClose={() => {
          setAct(null);
        }}
        title={title}
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
              {confirm}
            </Button>
          </>
        }
      >
        {body()}
        <Field
          label="Reason"
          name="reason"
          maxLength={500}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          help={
            act?.kind === "move"
              ? "Written to both clubs' history. 10–500 characters."
              : "Written to the club's history. 10–500 characters."
          }
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
    </DeskContext.Provider>
  );
}
