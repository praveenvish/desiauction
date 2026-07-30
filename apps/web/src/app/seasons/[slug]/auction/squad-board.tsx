"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Card } from "@desiauction/ui";
import type { AuctionSnapshot } from "@desiauction/core";

import { TeamChip, type TeamIdentity } from "./purse-board";

import type { PreSignedPlayer, ResolvedLot } from "../../../../server/auction/live-summary";

// THE SQUAD BOARD — every franchise and who is actually in it.
//
// A squad has two kinds of member and the room has to be able to tell them
// apart. Icons and retained players are PRE-SIGNED: the auction-pool projection
// excludes them, so they never become a lot, never take a bid and never cost a
// rupee of purse. Showing them in the same list as auction buys without a
// marker would read as "the Mavericks paid nothing for their captain".

export interface SquadMember {
  key: string;
  name: string;
  role: string;
  /** Null for pre-signed players — they were never bid on. */
  price: number | null;
  icon: boolean;
  retained: boolean;
  captain: boolean;
  viceCaptain: boolean;
}

/** Compose one squad per team from the pre-signed roster + the auction's buys. */
export function squadsOf(
  teams: TeamIdentity[],
  preSigned: PreSignedPlayer[],
  resolved: ResolvedLot[],
): { team: TeamIdentity; members: SquadMember[] }[] {
  // A player who is BOTH pre-signed and auctioned must be counted once. That
  // combination should be impossible — the pool projection excludes icons — but
  // it excludes only `isIcon`, while the schema documents `isRetained` as
  // excluded too, so a retained player currently reaches the block. Whichever
  // way that inconsistency is settled, a squad board must never double-count a
  // person, and the auction row wins because it is what actually happened.
  const auctionedRegistrations = new Set(
    resolved.flatMap((lot) =>
      lot.status === "sold" && lot.registrationId !== null ? [lot.registrationId] : [],
    ),
  );
  return teams.map((team) => {
    const members: SquadMember[] = [
      ...preSigned
        .filter(
          (player) =>
            player.teamId === team.id && !auctionedRegistrations.has(player.registrationId),
        )
        .map((player) => ({
          key: player.registrationId,
          name: player.playerName ?? "Unnamed",
          role: player.role,
          price: null,
          icon: player.isIcon,
          retained: player.isRetained,
          captain: player.isCaptain,
          viceCaptain: player.isViceCaptain,
        })),
      ...resolved
        // Match on id where the snapshot has one, name otherwise: the resolved
        // row carries teamId only when the lot sold through a paddle.
        .filter(
          (lot) => lot.status === "sold" && (lot.teamId === team.id || lot.teamName === team.name),
        )
        .map((lot) => ({
          key: lot.lotId,
          name: lot.playerName ?? "Unnamed",
          role: lot.role,
          price: lot.soldPrice,
          icon: false,
          retained: false,
          captain: false,
          viceCaptain: false,
        })),
    ];
    return { team, members };
  });
}

function MemberBadges({ member }: { member: SquadMember }) {
  return (
    <>
      {member.icon ? <span className="squad-tag squad-tag--icon">Icon</span> : null}
      {member.retained ? <span className="squad-tag squad-tag--retained">Retained</span> : null}
      {member.captain ? <span className="squad-tag squad-tag--captain">Captain</span> : null}
      {member.viceCaptain && !member.captain ? (
        <span className="squad-tag squad-tag--captain">Vice-captain</span>
      ) : null}
    </>
  );
}

export function SquadBoard({
  teams,
  preSigned,
  resolved,
  snapshot,
  squadMax,
}: {
  teams: TeamIdentity[];
  preSigned: PreSignedPlayer[];
  resolved: ResolvedLot[];
  snapshot: AuctionSnapshot | null;
  squadMax: number;
}) {
  const squads = squadsOf(teams, preSigned, resolved);
  const purseByTeam = new Map(
    (snapshot?.paddles ?? []).map((paddle) => [paddle.teamId, paddle.purseRemaining]),
  );
  return (
    <Card data-testid="squad-board">
      <div className="competition-head">
        <h2>Squads</h2>
        {/* The shorthand was a note to ourselves: "pre-signed" is a schema word
            and "never bid" reads as an instruction. The room needs the fact. */}
        <span className="competitions-hint">
          Icons and retained players joined before the auction — they were never bid on.
        </span>
      </div>
      <div className="squad-grid">
        {squads.map(({ team, members }) => {
          const remaining = purseByTeam.get(team.id);
          return (
            <section key={team.id} className="squad-team" data-testid={`squad-${team.id}`}>
              <div className="squad-team-head">
                <TeamChip team={team} fallback={team.name} />
                <span className="squad-team-name">{team.name}</span>
                <span className="squad-team-count">
                  {members.length}/{squadMax}
                </span>
              </div>
              {remaining !== undefined ? (
                <p className="squad-team-purse">{formatPaiseINR(paise(remaining))} left</p>
              ) : null}
              {members.length === 0 ? (
                <p className="competitions-hint">No players signed yet.</p>
              ) : (
                <ul className="squad-list">
                  {members.map((member) => (
                    <li key={member.key} className="squad-row">
                      <span className="squad-name">{member.name}</span>
                      <MemberBadges member={member} />
                      <span className="squad-role">{member.role.replace(/_/g, " ")}</span>
                      <span className="squad-price">
                        {member.price === null ? (
                          <span className="squad-presigned">pre-signed</span>
                        ) : (
                          formatPaiseINR(paise(member.price))
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * THE POOL — sold, unsold, still to come. The one number every person in the
 * room checks between lots, and the surfaces only ever showed "4/8 lots".
 */
export function PoolSummary({
  snapshot,
  resolved,
  preSigned,
}: {
  snapshot: AuctionSnapshot | null;
  resolved: ResolvedLot[];
  preSigned: PreSignedPlayer[];
}) {
  const sold = resolved.filter((lot) => lot.status === "sold");
  const unsold = resolved.filter((lot) => lot.status === "unsold").length;
  const withdrawn = resolved.filter((lot) => lot.status === "withdrawn").length;
  // Queue + whatever is on the block right now.
  const remaining = (snapshot?.queue.length ?? 0) + (snapshot?.currentLot === null ? 0 : 1);
  const spend = sold.reduce((total, lot) => total + (lot.soldPrice ?? 0), 0);
  const top = sold.reduce<ResolvedLot | null>(
    (best, lot) => ((lot.soldPrice ?? 0) > (best?.soldPrice ?? 0) ? lot : best),
    null,
  );
  return (
    <Card data-testid="pool-summary">
      <h2>Player pool</h2>
      <dl className="pool-stats">
        <div>
          <dt>Sold</dt>
          <dd className="pool-sold" data-testid="pool-sold">
            {sold.length}
          </dd>
        </div>
        <div>
          <dt>Unsold</dt>
          <dd className="pool-unsold" data-testid="pool-unsold">
            {unsold}
          </dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd data-testid="pool-remaining">{remaining}</dd>
        </div>
        {withdrawn > 0 ? (
          <div>
            <dt>Withdrawn</dt>
            <dd>{withdrawn}</dd>
          </div>
        ) : null}
        {preSigned.length > 0 ? (
          <div>
            <dt>Pre-signed</dt>
            <dd data-testid="pool-presigned">{preSigned.length}</dd>
          </div>
        ) : null}
      </dl>
      <div className="pool-money">
        <span>
          Total spend <strong>{formatPaiseINR(paise(spend))}</strong>
        </span>
        {top !== null ? (
          <span>
            Top buy <strong>{top.playerName ?? "Unnamed"}</strong>{" "}
            {formatPaiseINR(paise(top.soldPrice ?? 0))}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
