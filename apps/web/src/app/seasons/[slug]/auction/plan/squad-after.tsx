"use client";

import { Card, PlayerImage, RosterMark } from "@desiauction/ui";
import type { CSSProperties } from "react";

import { useMoney } from "../../../../../components/money-unit";
import type { PlanLotRow } from "../../../../../server/auction/owner-plan";
import type { LotMedia, PreSignedPlayer } from "../../../../../server/auction/live-summary";
import type { RoleCount } from "./plan-model";
import { mixSegments } from "./plan-model";

/**
 * AFTER THE NIGHT, THE PAGE IS THE SQUAD (owner plan, read-only).
 *
 * The finished plan page led with "Purse remaining · Planned for 0 targets ·
 * Headroom" — planning figures over a night that no longer needs one — then
 * two run-on lines of role counts, then twelve rows in a narrow column inside
 * a wide card. It now leads with whose team this is, what it signed, and the
 * shape of it; the list fills the card.
 */

/** The team's monogram: up to two initials of its name. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : (words[0]?.[1] ?? "");
  return `${first}${second}`.toUpperCase();
}

/** One hue per slot of the mix bar, in the order the bar draws them. */
const MIX_SLOTS = 6;

export function SquadHero({
  team,
  competitionName,
  squadSize,
  squadMax,
  bought,
  preSigned,
  spent,
  purse,
  purseRemaining,
  mix,
  labelOf,
}: {
  team: { name: string; color: string | null };
  competitionName: string;
  squadSize: number;
  squadMax: number;
  bought: number;
  preSigned: number;
  spent: number;
  purse: number;
  purseRemaining: number;
  mix: readonly RoleCount[];
  labelOf: (role: string | null) => string;
}) {
  const money = useMoney();
  const segments = mixSegments(mix);
  const crestStyle =
    team.color === null ? undefined : ({ ["--plan-team" as string]: team.color } as CSSProperties);
  return (
    <section className="plan-hero" aria-labelledby="plan-hero-name" data-testid="plan-squad-hero">
      <div className="plan-hero-id">
        <span className="plan-hero-crest" style={crestStyle} aria-hidden>
          {initials(team.name)}
        </span>
        <span className="plan-hero-title">
          <h2 id="plan-hero-name">{team.name}</h2>
          <span>{competitionName} · the squad the night signed</span>
        </span>
      </div>
      <dl className="plan-hero-figures">
        <div>
          <dt>Squad</dt>
          <dd data-testid="plan-hero-squad">
            {squadSize}
            <span>/{squadMax}</span>
          </dd>
          <dd className="plan-hero-sub">
            {bought} bought{preSigned > 0 ? ` + ${String(preSigned)} pre-signed` : ""}
          </dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>{money.ledger(spent)}</dd>
          <dd className="plan-hero-sub">of {money.ledger(purse)}</dd>
        </div>
        <div>
          <dt>Purse left</dt>
          <dd>{money.ledger(purseRemaining)}</dd>
        </div>
      </dl>
      {segments.length === 0 ? null : (
        <div className="plan-mix" data-testid="plan-mix">
          <span className="plan-mix-bar" aria-hidden>
            {segments.map((segment, index) => (
              <span
                key={segment.role}
                data-slot={index % MIX_SLOTS}
                style={{ flexGrow: segment.count }}
              />
            ))}
          </span>
          <ul className="plan-mix-legend">
            {segments.map((segment, index) => (
              <li key={segment.role}>
                <span className="plan-mix-key" data-slot={index % MIX_SLOTS} aria-hidden />
                <strong>{segment.count}</strong> {labelOf(segment.role)}
                {segment.count === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Everyone in the squad: pre-signed first (as /teams does), then by price. */
export function SquadList({
  preSigned,
  bought,
  lotMedia,
  labelOf,
  testId,
}: {
  preSigned: readonly PreSignedPlayer[];
  bought: readonly PlanLotRow[];
  lotMedia: Readonly<Record<string, LotMedia>>;
  labelOf: (role: string | null) => string;
  testId?: string;
}) {
  const money = useMoney();
  const count = preSigned.length + bought.length;
  return (
    <Card className="plan-roster" data-testid={testId}>
      <header className="plan-roster-head">
        <h2>
          {count} {count === 1 ? "player" : "players"}
        </h2>
        <span>{preSigned.length > 0 ? "pre-signed first, then by price" : "by price"}</span>
      </header>
      <ul className="plan-roster-list">
        {preSigned.map((player) => (
          <li key={player.registrationId} className="plan-bought-row">
            <PlayerImage
              name={player.playerName ?? "A player"}
              seed={player.registrationId}
              src={player.photoUrl}
              size="sm"
              shape="round"
              decorative
            />
            <span className="plan-bought-who">
              <span className="plan-bought-line">
                <span className="plan-bought-name">{player.playerName ?? "A player"}</span>
                {player.isCaptain ? <RosterMark kind="captain" /> : null}
                {player.isIcon ? <RosterMark kind="icon" /> : null}
                {player.isRetained ? <RosterMark kind="retained" /> : null}
              </span>
              <span className="plan-bought-role">{labelOf(player.role)}</span>
            </span>
            <span className="plan-bought-price plan-bought-price--signed">Pre-signed</span>
          </li>
        ))}
        {bought.map((lot) => (
          <li key={lot.lotId} className="plan-bought-row">
            <PlayerImage
              name={lot.playerName ?? "A player"}
              seed={lot.registrationId}
              src={lotMedia[lot.lotId]?.photoUrl ?? null}
              size="sm"
              shape="round"
              decorative
            />
            <span className="plan-bought-who">
              <span className="plan-bought-name">{lot.playerName ?? "A player"}</span>
              <span className="plan-bought-role">{labelOf(lot.role)}</span>
            </span>
            <span className="plan-bought-price">{money.ledger(lot.soldPrice ?? 0)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The two facts that are not about the squad, said once and quietly. */
export function SquadFootnote({ noPlan, unsold }: { noPlan: boolean; unsold: string }) {
  if (!noPlan && unsold === "") return null;
  return (
    <p className="plan-foot" data-testid="plan-foot">
      {noPlan ? <span>No plan was set for this night — this is what the team signed.</span> : null}
      {unsold === "" ? null : <span>Went unsold in the pool: {unsold}</span>}
    </p>
  );
}
