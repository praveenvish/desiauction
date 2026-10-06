"use client";

import { IconArrowLeft, IconSearch, PlayerImage, useToast } from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { useMoney, useMoneyUnit } from "../../../../components/money-unit";
import { squadCandidatesAction, type SquadCandidate } from "../../../../server/competition/actions";
import {
  placeByHandAction,
  priceByHandAction,
} from "../../../../server/competition/hand-results-actions";

/**
 * EVERY RESULT ON ONE SCREEN — `/seasons/[slug]/teams?view=results`.
 *
 * Founder, BPL-4: typing an offline auction in meant opening team after team,
 * or player after player. The night's sheet is one list — player, team,
 * points — so this is one list too: every approved player, a team dropdown
 * and a points box on each row, saved as you go.
 *
 *   type a name → Enter     the cursor lands on that player's team
 *   pick the team           the cursor moves to their points
 *   points → Enter          saved; back to the search box for the next name
 *
 * Captains, icons and retained players were placed before the night: shown
 * with their team, not editable here.
 */

interface Team {
  id: string;
  name: string;
  color: string | null;
}

interface Result {
  id: string;
  name: string;
  number: string;
  role: string | null;
  photoUrl: string | null;
  teamId: string | null;
  teamName: string | null;
  /** Captain / Icon / Retained — on their team already, not typed here. */
  fixed: string | null;
  /** Paise; null = none typed. */
  price: number | null;
}

type Filter = "all" | "unplaced" | "unpriced" | `team:${string}`;

const toResult = (candidate: SquadCandidate): Result => ({
  id: candidate.id,
  name: candidate.name ?? "Unnamed",
  number: candidate.number,
  role: candidate.role,
  photoUrl: candidate.photoUrl,
  teamId: candidate.teamId,
  teamName: candidate.teamName,
  fixed: candidate.isCaptain
    ? "Captain"
    : candidate.isIcon
      ? "Icon"
      : candidate.isRetained
        ? "Retained"
        : null,
  price: candidate.handPrice,
});

export function ResultsSheet({
  slug,
  teams,
  roleLabels,
  heading,
}: {
  slug: string;
  teams: readonly Team[];
  roleLabels: Record<string, string>;
  /**
   * Drawn as the Auction tab's own content (a season run offline) rather than
   * as a screen reached from Teams: no way back to a page it did not come from.
   */
  heading?: string;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const money = useMoney();
  const unit = useMoneyUnit();
  const unitWord = unit === "points" ? "points" : "price";
  const [rows, setRows] = useState<Result[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const teamRefs = useRef(new Map<string, HTMLSelectElement>());
  const priceRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    let live = true;
    void squadCandidatesAction(slug).then((list) => {
      if (live) {
        setRows(list.map(toResult));
      }
    });
    return () => {
      live = false;
    };
  }, [slug]);

  // The Teams page behind this one (tiles, the publish review) catches up a
  // moment after the typing stops, not on every keystroke.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSoon = () => {
    if (refreshTimer.current !== null) {
      clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = setTimeout(() => {
      startRefresh(() => {
        router.refresh();
      });
    }, 1500);
  };

  const update = (id: string, patch: Partial<Result>) => {
    setRows((current) =>
      current === null
        ? current
        : current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const counts = useMemo(() => {
    const open = (rows ?? []).filter((row) => row.fixed === null);
    return {
      all: rows?.length ?? 0,
      unplaced: open.filter((row) => row.teamId === null).length,
      unpriced: open.filter((row) => row.teamId !== null && row.price === null).length,
      placed: open.filter((row) => row.teamId !== null).length,
      open: open.length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (filter === "unplaced" && (row.fixed !== null || row.teamId !== null)) return false;
      if (
        filter === "unpriced" &&
        (row.fixed !== null || row.teamId === null || row.price !== null)
      )
        return false;
      if (filter.startsWith("team:") && row.teamId !== filter.slice(5)) return false;
      if (needle === "") return true;
      return row.name.toLowerCase().includes(needle) || row.number.toLowerCase().includes(needle);
    });
  }, [rows, query, filter]);

  const nextAfter = (id: string): Result | undefined => {
    const index = shown.findIndex((row) => row.id === id);
    return shown.slice(index + 1).find((row) => row.fixed === null);
  };

  const teamName = (id: string | null) => teams.find((team) => team.id === id)?.name ?? null;

  return (
    <section className="rs" aria-labelledby="rs-title" data-testid="results-sheet">
      {heading === undefined ? (
        <Link href={`/seasons/${slug}/teams`} className="rs-back">
          <IconArrowLeft size={16} aria-hidden /> All teams
        </Link>
      ) : null}
      <header className="rs-head">
        <div>
          <h2 id="rs-title">{heading ?? "Auction results"}</h2>
          <p>
            Every player in one list. Pick the team that bought them and type the {unitWord}.
            Everything saves as you go. Keyboard: name → Enter → team → Enter → {unitWord} → Enter.
          </p>
        </div>
        {rows !== null ? (
          <div className="rs-meter" data-testid="results-meter">
            <span className="rs-meter-figure">
              <b>{counts.placed}</b> of {counts.open} placed
            </span>
            <span className="rs-meter-bar" aria-hidden>
              <span
                style={{
                  width: `${String(counts.open === 0 ? 0 : (counts.placed / counts.open) * 100)}%`,
                }}
              />
            </span>
          </div>
        ) : null}
      </header>

      <div className="rs-tools">
        <label className="rs-search">
          <IconSearch size={16} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            placeholder="Type a player's name or number…"
            aria-label="Find a player"
            value={query}
            autoComplete="off"
            data-testid="results-search"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const first = shown.find((row) => row.fixed === null);
                if (first !== undefined) {
                  teamRefs.current.get(first.id)?.focus();
                }
              }
            }}
          />
        </label>
        <div className="rs-filters" role="group" aria-label="Show">
          {(
            [
              ["all", `All ${String(counts.all)}`],
              ["unplaced", `Not placed ${String(counts.unplaced)}`],
              ["unpriced", `No ${unitWord} ${String(counts.unpriced)}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="rs-chip"
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key);
              }}
            >
              {label}
            </button>
          ))}
          <select
            className="pd-input rs-team-filter"
            aria-label="Show one team"
            value={filter.startsWith("team:") ? filter : ""}
            onChange={(event) => {
              setFilter(event.target.value === "" ? "all" : (event.target.value as Filter));
            }}
          >
            <option value="">Any team</option>
            {teams.map((team) => (
              <option key={team.id} value={`team:${team.id}`}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows === null ? (
        <p className="pd-quiet rs-empty">Loading players…</p>
      ) : shown.length === 0 ? (
        <p className="pd-quiet rs-empty">
          {rows.length === 0
            ? "No approved players yet — approve players first, then type the results in."
            : filter === "unplaced"
              ? "Everyone is placed. 🎉"
              : "Nobody matches that."}
        </p>
      ) : (
        <ul className="rs-list" data-testid="results-list">
          {shown.map((row) => (
            <ResultRow
              key={row.id}
              row={row}
              teams={teams}
              unit={unit}
              roleLabel={row.role === null ? null : (roleLabels[row.role] ?? row.role)}
              teamRef={(node) => {
                if (node === null) teamRefs.current.delete(row.id);
                else teamRefs.current.set(row.id, node);
              }}
              priceRef={(node) => {
                if (node === null) priceRefs.current.delete(row.id);
                else priceRefs.current.set(row.id, node);
              }}
              onTeam={async (teamId) => {
                const before = { teamId: row.teamId, teamName: row.teamName, price: row.price };
                update(row.id, {
                  teamId,
                  teamName: teamName(teamId),
                  ...(teamId === null ? { price: null } : {}),
                });
                const result = await placeByHandAction(slug, row.id, teamId, { move: true });
                if (!result.ok) {
                  update(row.id, before);
                  return result.error;
                }
                refreshSoon();
                return null;
              }}
              onPrice={async (typed) => {
                const result = await priceByHandAction(slug, row.id, typed);
                if (!result.ok) {
                  return result.error;
                }
                update(row.id, { price: result.price });
                refreshSoon();
                return null;
              }}
              onDone={() => {
                if (query.trim() !== "") {
                  setQuery("");
                  searchRef.current?.focus();
                  return;
                }
                const next = nextAfter(row.id);
                if (next !== undefined) {
                  teamRefs.current.get(next.id)?.focus();
                }
              }}
              onTeamDone={() => {
                priceRefs.current.get(row.id)?.focus();
              }}
              money={money}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ResultRow({
  row,
  teams,
  unit,
  roleLabel,
  teamRef,
  priceRef,
  onTeam,
  onPrice,
  onDone,
  onTeamDone,
  money,
}: {
  row: Result;
  teams: readonly Team[];
  unit: "inr" | "points";
  roleLabel: string | null;
  teamRef: (node: HTMLSelectElement | null) => void;
  priceRef: (node: HTMLInputElement | null) => void;
  onTeam: (teamId: string | null) => Promise<string | null>;
  onPrice: (typed: string) => Promise<string | null>;
  onDone: () => void;
  onTeamDone: () => void;
  money: ReturnType<typeof useMoney>;
}) {
  const toast = useToast();
  const whole = row.price === null ? "" : String(row.price / 100);
  const [value, setValue] = useState(whole);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [seen, setSeen] = useState(whole);
  if (seen !== whole) {
    setSeen(whole);
    setValue(whole);
  }
  const teamColor = teams.find((team) => team.id === row.teamId)?.color ?? null;

  const savePrice = async (): Promise<boolean> => {
    const typed = value.trim();
    if (typed === whole) {
      return true;
    }
    setState("saving");
    const error = await onPrice(typed);
    if (error !== null) {
      setState("error");
      toast({ title: error, tone: "danger" });
      return false;
    }
    setState("saved");
    return true;
  };

  return (
    <li
      className="rs-row"
      data-state={state}
      data-placed={row.teamId !== null ? "" : undefined}
      data-testid="results-row"
    >
      <span
        className="rs-who"
        style={teamColor === null ? undefined : { borderLeftColor: teamColor }}
      >
        <PlayerImage
          name={row.name}
          seed={row.id}
          src={row.photoUrl}
          size="sm"
          shape="round"
          decorative
        />
        <span className="rs-name">
          <strong>{row.name}</strong>
          <span>
            #{row.number}
            {roleLabel === null ? "" : ` · ${roleLabel}`}
          </span>
        </span>
      </span>

      {row.fixed !== null ? (
        <span className="rs-fixed">
          {row.teamName ?? "No team"} · <b>{row.fixed}</b>
        </span>
      ) : (
        <select
          ref={teamRef}
          className="pd-input rs-team"
          aria-label={`Team for ${row.name}`}
          value={row.teamId ?? ""}
          data-testid="results-team"
          onKeyDown={(event) => {
            // Typing a team's name picks it letter by letter (each letter is a
            // change), so the jump to the points box waits for Enter.
            if (event.key === "Enter" && row.teamId !== null) {
              event.preventDefault();
              onTeamDone();
            }
          }}
          onChange={(event) => {
            const next = event.target.value === "" ? null : event.target.value;
            void onTeam(next).then((error) => {
              if (error !== null) {
                toast({ title: error, tone: "danger" });
              }
            });
          }}
        >
          <option value="">Not bought</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      )}

      {row.fixed !== null ? (
        <span className="rs-price rs-quiet">Pre-signed</span>
      ) : (
        <span className="rs-price">
          <input
            ref={priceRef}
            className="pd-input rs-price-input"
            inputMode="numeric"
            enterKeyHint="next"
            autoComplete="off"
            placeholder={row.teamId === null ? "" : "—"}
            disabled={row.teamId === null}
            aria-label={`${unit === "points" ? "Points" : "Price"} for ${row.name}`}
            aria-invalid={state === "error" || undefined}
            data-testid="results-price"
            value={value}
            onChange={(event) => {
              setValue(event.target.value.replace(/[^\d]/g, ""));
              if (state !== "saving") setState("idle");
            }}
            onBlur={() => {
              void savePrice();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void savePrice().then((ok) => {
                  if (ok) onDone();
                });
              }
            }}
          />
          {unit === "points" ? <span className="rs-unit">pts</span> : null}
          <span className="rs-tick" aria-live="polite">
            {state === "saving"
              ? "…"
              : state === "saved" && row.price !== null
                ? `✓ ${money.compact(row.price)}`
                : state === "saved"
                  ? "✓"
                  : ""}
          </span>
        </span>
      )}
    </li>
  );
}
