"use client";

import { formatPaiseINR, paise, roleLabel } from "@desiauction/core";
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
  /**
   * The squad MARKERS for a player who went under the hammer anyway.
   *
   * Above: a pre-signed player can reach the block, because the pool projection
   * excludes `isIcon` only while the schema documents `isRetained` as excluded
   * too. When that happens the auction row wins the row — it is what actually
   * happened — and it used to win the badges with it, hardcoding every marker
   * to false. So a franchise's CAPTAIN, bought in the room, appeared as an
   * ordinary signing while the captain of the team beside them wore the badge.
   * The registration is the same registration either way, so the marks are read
   * back off it.
   */
  const marksByRegistration = new Map(preSigned.map((player) => [player.registrationId, player]));
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
        .map((lot) => {
          const marks =
            lot.registrationId === null ? undefined : marksByRegistration.get(lot.registrationId);
          return {
            key: lot.lotId,
            name: lot.playerName ?? "Unnamed",
            role: lot.role,
            price: lot.soldPrice,
            // Icon and Retained stay false whatever the registration says: they
            // describe HOW a player joined a squad, and this player joined by
            // being bid on. Printing "Icon" over a sale price would contradict
            // the card's own header ("they were never bid on") on the one row
            // where it is not true.
            icon: false,
            retained: false,
            // Captaincy is not a route in — it is a job in the squad, true of
            // the player whether the franchise kept them or bought them back.
            //
            // The resolved lot is now the FIRST source: it carries the marks
            // straight off the registration it already joins, so a captain who
            // is neither an icon nor retained — invisible here until the row
            // gained these columns, because `preSigned` filters them out — wears
            // the badge too. `marks` remains the fallback for a row the client
            // synthesised from the snapshot mid-auction, which has no
            // registration to read.
            captain: lot.isCaptain || (marks?.isCaptain ?? false),
            viceCaptain: lot.isViceCaptain || (marks?.isViceCaptain ?? false),
          };
        }),
    ];
    return { team, members };
  });
}

/**
 * HOW MANY PLAYERS EACH FRANCHISE HAS ACTUALLY SIGNED, keyed by team id.
 *
 * This is the number the ENGINE counts when it applies the reserve rule —
 * auction buys PLUS pre-signed players (aggregate.ts) — so a purse board that
 * prints a ceiling from it prints the ceiling the engine will enforce, not a
 * second opinion about the same money. Built on `squadsOf` so the de-duping
 * lives in exactly one place.
 */
export function squadSizesOf(
  teams: TeamIdentity[],
  preSigned: PreSignedPlayer[],
  resolved: ResolvedLot[],
): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const squad of squadsOf(teams, preSigned, resolved)) {
    sizes[squad.team.id] = squad.members.length;
  }
  return sizes;
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
  /**
   * Whether the "N left" purse line may be shown per squad.
   *
   * A bidder gets their OWN. The cockpit and the spectator board get them all,
   * exactly as before. This is the same seal as the purse board: a squad card
   * quietly carried a second copy of every rival's remaining money.
   */
  showPurse = true,
  note = null,
}: {
  teams: TeamIdentity[];
  preSigned: PreSignedPlayer[];
  resolved: ResolvedLot[];
  snapshot: AuctionSnapshot | null;
  squadMax: number;
  showPurse?: boolean;
  note?: string | null;
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
      {note === null ? null : (
        <p className="competitions-hint" data-testid="squad-board-note">
          {note}
        </p>
      )}
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
              {/* The LINE is unconditional once purses are shown at all; only
                  the figure waits. Rendered conditionally, it appeared per team
                  when the socket answered — four teams, ~75px, and every squad
                  below moved. `showPurse` still decides whether this viewer is
                  entitled to see purses; that is a permission and stays a
                  branch. Not knowing a number yet is not a permission. */}
              {showPurse ? (
                <p className="squad-team-purse">
                  {remaining === undefined || remaining === null
                    ? "\u2014"
                    : `${formatPaiseINR(paise(remaining))} left`}
                </p>
              ) : null}
              {members.length === 0 ? (
                <p className="competitions-hint">No players signed yet.</p>
              ) : (
                <ul className="squad-list">
                  {members.map((member) => (
                    <li key={member.key} className="squad-row">
                      <span className="squad-name">{member.name}</span>
                      <MemberBadges member={member} />
                      <span className="squad-role">{roleLabel(member.role)}</span>
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
