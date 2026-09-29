"use client";

import { Badge, Button, Field, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ownerStageOf, type OwnerStage } from "../../../../../lib/auction-setup-steps";
import { formatDateTime } from "../../../../../lib/format-date";
import { personContact } from "../../../../../lib/person-label";
import type { AuctionDashboard } from "../../../../../server/auction/actions";
import {
  grantPaddleAction,
  emailOwnerInviteAction,
  inviteOwnerAction,
  revokeOwnerInviteAction,
} from "../../../../../server/auction/owner-actions";
import { release } from "../../../../../lib/release";

type Owners = NonNullable<AuctionDashboard["owners"]>;

const STAGE_BADGE: Record<
  OwnerStage["stage"],
  { tone: "neutral" | "info" | "warning" | "success"; text: string }
> = {
  none: { tone: "neutral", text: "No owner yet" },
  invited: { tone: "info", text: "Link sent" },
  expired: { tone: "warning", text: "Link expired" },
  accepted: { tone: "warning", text: "Accepted — grant the paddle" },
  granted: { tone: "info", text: "Waiting for them to claim" },
  claimed: { tone: "success", text: "Ready to bid" },
};

/**
 * EVERY TEAM'S ROAD TO A PADDLE, ON ONE LIST.
 *
 * Invite → accept → grant → claim used to be split across the Teams tab (mint
 * a link), the owner's phone (accept), the cockpit (grant) and the live room
 * (claim), and the only place that said what was missing was a refusal toast
 * on "Open auction". Each team is now one row that says where it is and offers
 * the one thing that moves it on. The grant stays a deliberate click: a link
 * is a bearer token, so the organizer confirms WHO accepted before handing
 * them a purse.
 */
export function OwnersStep({
  slug,
  seasonName,
  teams,
  owners,
  claimedTeamIds,
  canManage,
  canConduct,
}: {
  slug: string;
  seasonName: string;
  teams: readonly { id: string; name: string }[];
  owners: Owners;
  claimedTeamIds: ReadonlySet<string>;
  canManage: boolean;
  canConduct: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  // A link exists in full only in the browser that minted it (the server keeps
  // a hash), so the page remembers the ones minted here to offer them again.
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const stages = teams.map((team) => ({
    team,
    stage: ownerStageOf(team.id, owners.board.invites, owners.board.grants, claimedTeamIds),
  }));
  const withoutLink = stages.filter(
    ({ stage }) => stage.stage === "none" || stage.stage === "expired",
  );

  const mint = async (teamId: string, replacing?: string): Promise<boolean> => {
    if (replacing !== undefined) {
      const revoked = await revokeOwnerInviteAction(slug, replacing);
      if (!revoked.ok) {
        toast({ title: revoked.error ?? "Couldn't withdraw the old link.", tone: "danger" });
        return false;
      }
    }
    const result = await inviteOwnerAction(slug, teamId);
    if (!result.ok) {
      toast({ title: result.error, tone: "danger" });
      return false;
    }
    setLinks((current) => ({
      ...current,
      [teamId]: `${window.location.origin}${result.joinPath}`,
    }));
    return true;
  };

  const inviteOne = async (teamId: string, replacing?: string) => {
    setPending(`invite-${teamId}`);
    const ok = await release(mint(teamId, replacing), () => {
      setPending(null);
    });
    if (ok) {
      toast({ title: "Link ready — send it to the team's owner.", tone: "success" });
      router.refresh();
    }
  };

  const inviteAll = async () => {
    setPending("invite-all");
    let made = 0;
    try {
      for (const { team, stage } of withoutLink) {
        if (await mint(team.id, stage.stage === "expired" ? stage.inviteId : undefined)) {
          made += 1;
        }
      }
    } finally {
      // Whether or not every request came back: a link that WAS made is still
      // announced below, and the screen is never left busy (lib/release).
      setPending(null);
    }
    if (made > 0) {
      toast({
        title: `${String(made)} link${made === 1 ? "" : "s"} ready — send each to its team's owner.`,
        tone: "success",
      });
      router.refresh();
    }
  };

  const grant = async (teamId: string, personId: string) => {
    setPending(`grant-${teamId}`);
    const result = await release(grantPaddleAction(slug, teamId, personId), () => {
      setPending(null);
    });
    if (result.ok) {
      toast({ title: "Paddle granted — they can claim it in the live room.", tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  };

  const copy = async (teamId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(teamId);
    } catch {
      toast({ title: "Couldn't copy — select the link and copy it by hand.", tone: "danger" });
    }
  };

  return (
    <div className="as-owners" data-testid="setup-owners">
      <p className="as-hint">
        Each team&apos;s owner bids from their own phone. Send each one their link; when they
        accept, grant the paddle here, and they claim it from the live room.
      </p>
      {canManage && withoutLink.length > 1 ? (
        <Button
          variant="secondary"
          size="sm"
          loading={pending === "invite-all"}
          disabled={pending !== null}
          onClick={() => void inviteAll()}
          data-testid="invite-all-owners"
        >
          Create links for {withoutLink.length} teams
        </Button>
      ) : null}
      <ul className="as-owner-list">
        {stages.map(({ team, stage }) => {
          const link = links[team.id];
          const badge = STAGE_BADGE[stage.stage];
          const acceptor =
            stage.stage === "accepted"
              ? owners.acceptances.find((row) => row.inviteId === stage.inviteId)
              : undefined;
          return (
            <li
              key={team.id}
              className="as-owner"
              data-stage={stage.stage}
              data-testid={`owner-row-${team.id}`}
            >
              <div className="as-owner-head">
                <span className="as-owner-team">{team.name}</span>
                <Badge tone={badge.tone}>{badge.text}</Badge>
              </div>

              {stage.stage === "accepted" ? (
                <div className="as-owner-body">
                  <span className="as-hint">
                    {acceptor === undefined
                      ? "Someone accepted this link."
                      : `${acceptor.name ?? "Unnamed account"} · ${personContact(acceptor)}${
                          acceptor.acceptedAt === null
                            ? ""
                            : ` · ${formatDateTime(acceptor.acceptedAt)}`
                        }`}
                    {acceptor !== undefined && !acceptor.stillMember
                      ? " · removed from this club"
                      : ""}
                  </span>
                  {canConduct ? (
                    <Button
                      size="sm"
                      onClick={() => void grant(team.id, stage.personId)}
                      loading={pending === `grant-${team.id}`}
                      disabled={
                        pending !== null || (acceptor !== undefined && !acceptor.stillMember)
                      }
                      data-testid={`grant-${team.id}`}
                    >
                      Grant paddle
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {stage.stage === "granted" ? (
                <p className="as-hint">
                  They open the live room and press “Claim paddle”. Nothing more to do here.
                </p>
              ) : null}

              {link !== undefined && (stage.stage === "invited" || stage.stage === "none") ? (
                <div className="as-owner-link">
                  <span className="as-link-url" data-testid={`owner-link-${team.id}`}>
                    {link}
                  </span>
                  <div className="as-owner-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void copy(team.id, link)}
                      data-testid={`copy-owner-link-${team.id}`}
                    >
                      {copied === team.id ? "Copied" : "Copy link"}
                    </Button>
                    <a
                      className="as-whatsapp"
                      href={`https://wa.me/?text=${encodeURIComponent(
                        `You're the owner of ${team.name} in ${seasonName} on DesiAuction. Tap to accept and get your paddle: ${link}`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Send on WhatsApp
                    </a>
                  </div>
                  {canManage ? <EmailInviteForm slug={slug} teamId={team.id} link={link} /> : null}
                  <span className="as-hint">
                    Works once, for 7 days. Anyone holding it can accept it.
                  </span>
                </div>
              ) : null}

              {canManage &&
              (stage.stage === "none" || stage.stage === "expired") &&
              link === undefined ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void inviteOne(team.id, stage.stage === "expired" ? stage.inviteId : undefined)
                  }
                  loading={pending === `invite-${team.id}`}
                  disabled={pending !== null}
                  data-testid={`invite-owner-${team.id}`}
                >
                  {stage.stage === "expired" ? "New link" : "Create invite link"}
                </Button>
              ) : null}

              {canManage && stage.stage === "invited" && link === undefined ? (
                <div className="as-owner-body">
                  <span className="as-hint">Waiting for the owner to open the link.</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void inviteOne(team.id, stage.inviteId)}
                    loading={pending === `invite-${team.id}`}
                    disabled={pending !== null}
                    data-testid={`reissue-owner-${team.id}`}
                  >
                    Lost it? New link
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * "Or email it to the owner" — the third way to send the link (email
 * programme PR7). We send a branded invitation to the address typed here and
 * keep neither the address nor a copy of the link.
 */
function EmailInviteForm({ slug, teamId, link }: { slug: string; teamId: string; link: string }) {
  const toast = useToast();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo !== null) {
    return (
      <p className="as-hint" role="status" data-testid={`owner-invite-emailed-${teamId}`}>
        Invitation emailed to {sentTo}.
      </p>
    );
  }
  return (
    <form
      className="as-owner-email"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        void emailOwnerInviteAction(slug, link, address).then((result) => {
          setBusy(false);
          if (result.ok) {
            setSentTo(result.sentTo);
            toast({ title: `Invitation emailed to ${result.sentTo}.`, tone: "success" });
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <Field
        label="Or email it to the owner"
        name={`owner-email-${teamId}`}
        type="email"
        autoComplete="off"
        placeholder="owner@example.com"
        value={address}
        onChange={(event) => {
          setAddress(event.target.value);
        }}
        {...(error === null ? {} : { error })}
      />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        loading={busy}
        disabled={address.trim() === ""}
        data-testid={`email-owner-invite-${teamId}`}
      >
        Email the invite
      </Button>
    </form>
  );
}
