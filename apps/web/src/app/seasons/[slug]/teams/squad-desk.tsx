"use client";

import { Button, PlayerImage, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";

import {
  markRegistrationAction,
  registrationDetailAction,
  squadCandidatesAction,
  type SquadCandidate,
} from "../../../../server/competition/actions";
import type { PlayerDeskContext } from "../../../../server/competition/player-desk";
import type { TeamRosterRow } from "../../../../server/competition/team-workspace";
import type { Row } from "../_players/labels";
import { PlayerSheet } from "../_players/player-sheet";
import { useMutate } from "../_players/use-mutate";
import { useRoster } from "../_players/use-roster";
import "../_players/players-desk.css";

type Slot = "isCaptain" | "isIcon" | "isRetained";

const SLOT: Record<Slot, { title: string; add: string; empty: string; one: boolean }> = {
  isCaptain: {
    title: "Captain",
    add: "Choose captain",
    empty: "No captain yet.",
    one: true,
  },
  isIcon: { title: "Icons", add: "Add icon", empty: "No icon players.", one: false },
  isRetained: {
    title: "Retained",
    add: "Add retained player",
    empty: "Nobody retained.",
    one: false,
  },
};

/**
 * BEFORE THE AUCTION: WHO THIS TEAM ALREADY HAS.
 *
 * Picking a team's captain used to mean leaving the team, finding the player
 * in a 25-row page of registrations, opening Details, choosing the team from a
 * select, pressing Assign, then finding the Captain button on the row. The team
 * page is where an organizer thinks "Kings' captain is Rohit", so it is where
 * the answer is written: three slots, each a search box. Any of the three marks
 * keeps the player out of the auction pool and puts them straight on this team.
 */
export function SquadPreSign({
  slug,
  teamId,
  teamName,
  teamColor,
  roster,
  locked,
  settlesAtOpen,
}: {
  slug: string;
  teamId: string;
  teamName: string;
  /** Tints each holder's initials mark, as the roster below draws it. */
  teamColor: string | null;
  roster: readonly TeamRosterRow[];
  /** The auction has started — Icon and Retained are frozen with the roster. */
  locked: boolean;
  /** An auction is set up but not open: its lot list is rebuilt from these marks when it opens. */
  settlesAtOpen: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [refreshing, startRefresh] = useTransition();
  // Optimistic slot contents, keyed by registration id, until the page catches up.
  const [pending, setPending] = useState<
    Record<string, Partial<Record<Slot, boolean>> & { name?: string }>
  >({});
  const [seenRoster, setSeenRoster] = useState(roster);
  if (seenRoster !== roster) {
    setSeenRoster(roster);
    setPending({});
  }

  const candidates = useSquadCandidates(slug, roster);

  const members = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; photoUrl: string | null } & Record<Slot, boolean>
    >();
    for (const row of roster) {
      byId.set(row.registrationId, {
        id: row.registrationId,
        name: row.name ?? "Unnamed",
        photoUrl: row.photoUrl,
        isCaptain: row.isCaptain,
        isIcon: row.isIcon,
        isRetained: row.isRetained,
      });
    }
    for (const [id, patch] of Object.entries(pending)) {
      const current = byId.get(id) ?? {
        id,
        name: patch.name ?? "Player",
        // Picked a moment ago and not on the roster yet: the picker's own row has the photo.
        photoUrl: candidates?.find((candidate) => candidate.id === id)?.photoUrl ?? null,
        isCaptain: false,
        isIcon: false,
        isRetained: false,
      };
      byId.set(id, { ...current, ...stripName(patch) });
    }
    return [...byId.values()];
  }, [roster, pending, candidates]);

  const write = async (
    id: string,
    name: string,
    marks: { isIcon?: boolean; isCaptain?: boolean; isRetained?: boolean; teamId?: string | null },
    success: string,
  ) => {
    const before = pending;
    const optimistic: Record<string, Partial<Record<Slot, boolean>> & { name?: string }> = {
      ...pending,
      [id]: { ...pending[id], name, ...stripTeam(marks) },
    };
    if (marks.isCaptain === true) {
      for (const member of members) {
        if (member.id !== id && member.isCaptain) {
          optimistic[member.id] = { ...optimistic[member.id], isCaptain: false };
        }
      }
    }
    setPending(optimistic);
    const result = await markRegistrationAction(slug, id, marks);
    if (!result.ok) {
      setPending(before);
      toast({ title: result.error ?? "That didn't save.", tone: "danger" });
      return;
    }
    toast({ title: success, tone: "success" });
    startRefresh(() => {
      router.refresh();
    });
  };

  const add = (slot: Slot, candidate: SquadCandidate) => {
    void write(
      candidate.id,
      candidate.name ?? candidate.number,
      { teamId, [slot]: true },
      slot === "isCaptain"
        ? `${candidate.name ?? candidate.number} is ${teamName}'s captain`
        : slot === "isIcon"
          ? `${candidate.name ?? candidate.number} is an Icon for ${teamName}`
          : `${candidate.name ?? candidate.number} is retained by ${teamName}`,
    );
  };

  const remove = (slot: Slot, member: (typeof members)[number]) => {
    const others = (["isCaptain", "isIcon", "isRetained"] as const).filter(
      (mark) => mark !== slot && member[mark],
    );
    // The last mark going means the player was only on this team BECAUSE of
    // it: before the auction they go back to the pool rather than staying on
    // the team by hand, which would leave them in both.
    void write(
      member.id,
      member.name,
      { [slot]: false, ...(others.length === 0 && !locked ? { teamId: null } : {}) },
      others.length === 0 && !locked
        ? `${member.name} is back in the auction pool`
        : `${member.name} is no longer ${SLOT[slot].title === "Icons" ? "an Icon" : SLOT[slot].title.toLowerCase()}`,
    );
  };

  return (
    <section
      className="pd-presign"
      aria-label="Squad before the auction"
      data-testid="squad-presign"
      data-busy={refreshing ? "true" : undefined}
    >
      {(["isCaptain", "isIcon", "isRetained"] as const).map((slot) => {
        const holders = members.filter((member) => member[slot]);
        const frozen = locked && slot !== "isCaptain";
        return (
          <div key={slot} className="pd-presign-slot" data-testid={`presign-${slot}`}>
            <h3>
              <span>{SLOT[slot].title}</span>
              {slot !== "isCaptain" && holders.length > 0 ? (
                <span className="pd-quiet">{holders.length}</span>
              ) : null}
            </h3>
            {holders.length === 0 ? <p className="pd-quiet">{SLOT[slot].empty}</p> : null}
            <ul className="pd-presign-list">
              {holders.map((member) => (
                <li key={member.id} className="pd-presign-person">
                  <PlayerImage
                    name={member.name}
                    seed={member.id}
                    src={member.photoUrl}
                    size="sm"
                    shape="round"
                    teamColor={teamColor ?? undefined}
                    decorative
                  />
                  <span>{member.name}</span>
                  {!frozen ? (
                    <button
                      type="button"
                      className="pd-link"
                      onClick={() => {
                        remove(slot, member);
                      }}
                      aria-label={`Remove ${member.name} as ${SLOT[slot].title}`}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {frozen ? (
              <p className="pd-setting-hint">Locked — the auction has started.</p>
            ) : SLOT[slot].one && holders.length > 0 ? (
              <PlayerPicker
                label={`Change ${teamName}'s captain`}
                placeholder="Change captain…"
                candidates={candidates}
                teamId={teamId}
                exclude={holders.map((holder) => holder.id)}
                onPick={(candidate) => {
                  add(slot, candidate);
                }}
                onlyOnTeam={locked}
              />
            ) : (
              <PlayerPicker
                label={`${SLOT[slot].add} for ${teamName}`}
                placeholder={`${SLOT[slot].add}…`}
                candidates={candidates}
                teamId={teamId}
                exclude={holders.map((holder) => holder.id)}
                onPick={(candidate) => {
                  add(slot, candidate);
                }}
                onlyOnTeam={locked}
              />
            )}
          </div>
        );
      })}
      {settlesAtOpen ? (
        <p className="pd-setting-hint pd-presign-note" data-testid="presign-settles-at-open">
          The auction is set up, and these still count: when it opens, anyone marked here is taken
          off the block and anyone unmarked gets a lot.
        </p>
      ) : null}
    </section>
  );
}

function stripName(value: object): Partial<Record<Slot, boolean>> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "name"));
}

function stripTeam(value: object): Partial<Record<Slot, boolean>> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "teamId"));
}

/**
 * The season's approved players, fetched ONCE per roster state and shared by
 * every search box on the team page — the pre-sign slots and "Bought in
 * auction" ask the same question, so they get the same answer from one trip.
 */
const candidateCache = new Map<string, Promise<SquadCandidate[]>>();

export function useSquadCandidates(
  slug: string,
  roster: readonly Pick<TeamRosterRow, "registrationId" | "isCaptain" | "isIcon" | "isRetained">[],
): SquadCandidate[] | null {
  const [candidates, setCandidates] = useState<SquadCandidate[] | null>(null);
  // Who is on the team and with which marks — a typed price changes nothing here.
  const key = `${slug}:${roster
    .map(
      (row) =>
        `${row.registrationId}${row.isCaptain ? "c" : ""}${row.isIcon ? "i" : ""}${row.isRetained ? "r" : ""}`,
    )
    .join(",")}`;
  useEffect(() => {
    let live = true;
    let request = candidateCache.get(key);
    if (request === undefined) {
      request = squadCandidatesAction(slug);
      candidateCache.set(key, request);
      // Only the latest answer is worth keeping; the next roster asks again.
      setTimeout(() => {
        candidateCache.delete(key);
      }, 5_000);
    }
    void request.then((list) => {
      if (live) {
        setCandidates(list);
      }
    });
    return () => {
      live = false;
    };
  }, [slug, key]);
  return candidates;
}

/** Rows drawn per step: a long list renders in pages as it scrolls, never all at once. */
const PAGE = 50;

/**
 * A search box that finds an approved player — the combobox pattern: type, the
 * list narrows, arrows move, Enter picks. Players already on another team are
 * listed with that team's name, so moving one is a choice and not an accident.
 *
 * EVERY match is reachable. The list used to stop at 30 with nothing to say
 * so, which in a season of 150 meant most players could only be found by
 * typing their name exactly. It now counts the matches and draws them 50 at a
 * time as the list scrolls (or as the arrow keys walk past the end).
 *
 * `blockOtherTeams` is for placing bought players: somebody already on another
 * team — or pre-signed anywhere — is shown greyed out with where they are, and
 * cannot be picked, so nobody ends up on two squads.
 */
export function PlayerPicker({
  label,
  placeholder,
  candidates,
  teamId,
  exclude,
  onPick,
  onlyOnTeam,
  blockOtherTeams = false,
  inputRef,
  testId,
}: {
  label: string;
  placeholder: string;
  candidates: SquadCandidate[] | null;
  teamId: string;
  exclude: readonly string[];
  onPick: (candidate: SquadCandidate) => void;
  /** After the auction starts, only this team's own players can take the armband. */
  onlyOnTeam: boolean;
  blockOtherTeams?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  testId?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const blocked = useCallback(
    (candidate: SquadCandidate): boolean =>
      blockOtherTeams &&
      (candidate.isCaptain ||
        candidate.isIcon ||
        candidate.isRetained ||
        (candidate.teamId !== null && candidate.teamId !== teamId)),
    [blockOtherTeams, teamId],
  );

  const matches = useMemo(() => {
    if (candidates === null) {
      return [];
    }
    const needle = query.trim().toLowerCase();
    // This team's own first, then the free, then those placed elsewhere — a
    // stable sort, so each group keeps the alphabetical order it arrived in.
    const rank = (candidate: SquadCandidate): number =>
      candidate.teamId === teamId ? 0 : blocked(candidate) ? 2 : candidate.teamId === null ? 1 : 2;
    return candidates
      .filter((candidate) => !exclude.includes(candidate.id))
      .filter((candidate) => !onlyOnTeam || candidate.teamId === teamId)
      .filter(
        (candidate) =>
          needle === "" ||
          (candidate.name ?? "").toLowerCase().includes(needle) ||
          candidate.number.toLowerCase().includes(needle),
      )
      .sort((a, b) => rank(a) - rank(b));
  }, [candidates, query, exclude, teamId, onlyOnTeam, blocked]);

  const free = useMemo(
    () => matches.filter((candidate) => candidate.teamId === null && !blocked(candidate)).length,
    [matches, blocked],
  );
  const shown = matches.slice(0, limit);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  // The highlighted row follows the arrow keys into view.
  useEffect(() => {
    if (open) {
      document.getElementById(`${listId}-${String(active)}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [active, open, listId]);

  const pick = (candidate: SquadCandidate | undefined) => {
    if (candidate === undefined || blocked(candidate)) {
      return;
    }
    onPick(candidate);
    setQuery("");
    setLimit(PAGE);
    setActive(0);
    setOpen(false);
  };

  const where = (candidate: SquadCandidate): string =>
    candidate.teamId === teamId
      ? "on this team"
      : candidate.teamName !== null
        ? `on ${candidate.teamName}`
        : candidate.isCaptain || candidate.isIcon || candidate.isRetained
          ? "pre-signed"
          : `#${candidate.number}`;

  return (
    <div className="pd-picker" ref={rootRef}>
      <input
        ref={inputRef}
        className="pd-input"
        style={{ width: "100%" }}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && shown[active] !== undefined ? `${listId}-${String(active)}` : undefined
        }
        placeholder={placeholder}
        value={query}
        data-testid={testId}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setLimit(PAGE);
          setOpen(true);
          listRef.current?.scrollTo({ top: 0 });
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            const next = Math.min(active + 1, Math.max(0, matches.length - 1));
            if (next >= limit) {
              setLimit((current) => current + PAGE);
            }
            setActive(next);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(shown[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open ? (
        <ul
          ref={listRef}
          className="pd-picker-list"
          id={listId}
          role="listbox"
          aria-label={label}
          onScroll={(event) => {
            const list = event.currentTarget;
            if (
              shown.length < matches.length &&
              list.scrollTop + list.clientHeight >= list.scrollHeight - 120
            ) {
              setLimit((current) => current + PAGE);
            }
          }}
        >
          {candidates === null ? (
            <li className="pd-picker-empty">Loading players…</li>
          ) : matches.length === 0 ? (
            <li className="pd-picker-empty">
              {onlyOnTeam ? "No one on this team matches." : "No approved player matches."}
            </li>
          ) : (
            <>
              <li className="pd-picker-count" role="presentation" data-testid="picker-count">
                {matches.length} player{matches.length === 1 ? "" : "s"}
                {blockOtherTeams ? ` · ${String(free)} not on a team` : ""}
              </li>
              {shown.map((candidate, index) => {
                const off = blocked(candidate);
                return (
                  <li
                    key={candidate.id}
                    id={`${listId}-${String(index)}`}
                    role="option"
                    aria-selected={index === active}
                    aria-disabled={off || undefined}
                    className="pd-picker-option"
                    data-blocked={off ? "true" : undefined}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      pick(candidate);
                    }}
                    onPointerEnter={() => {
                      setActive(index);
                    }}
                  >
                    <span className="pd-picker-who">
                      <PlayerImage
                        name={candidate.name ?? "Unnamed"}
                        seed={candidate.id}
                        src={candidate.photoUrl}
                        size="xs"
                        shape="round"
                        decorative
                      />
                      <span>{candidate.name ?? "Unnamed"}</span>
                    </span>
                    <span className="pd-quiet">{where(candidate)}</span>
                  </li>
                );
              })}
              {shown.length < matches.length ? (
                <li className="pd-picker-empty" role="presentation">
                  Scroll for {matches.length - shown.length} more…
                </li>
              ) : null}
            </>
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The player sheet, opened from a roster. The roster does not carry the whole
 * registration, so the sheet asks for it once — then behaves exactly as it
 * does on Registrations, and the roster refreshes behind it.
 */
export function RosterSheetHost({
  slug,
  registrationId,
  teams,
  order,
  onNavigate,
  onClose,
}: {
  slug: string;
  registrationId: string;
  teams: readonly { id: string; name: string }[];
  /** The roster's order, for J/K. */
  order: readonly string[];
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [loaded, setLoaded] = useState<{ row: Row; desk: PlayerDeskContext } | null>(null);
  const rows = useMemo(() => (loaded === null ? [] : [loaded.row]), [loaded]);
  const roster = useRoster(rows);
  const mutate = useMutate(roster);

  useEffect(() => {
    let live = true;
    void registrationDetailAction(slug, registrationId).then((result) => {
      if (!live) {
        return;
      }
      if (result.ok) {
        setLoaded({ row: result.row, desk: result.desk });
      } else {
        toast({ title: result.error, tone: "danger" });
        onClose();
      }
    });
    return () => {
      live = false;
    };
  }, [slug, registrationId, toast, onClose]);

  const row = roster.rows.find((entry) => entry.id === registrationId);
  if (loaded === null || row === undefined) {
    return (
      <aside className="pd-sheet" aria-label="Loading player" aria-busy="true">
        <div className="pd-sheet-bar">
          <span />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="pd-sheet-scroll">
          <p className="pd-quiet">Loading…</p>
        </div>
      </aside>
    );
  }
  const index = order.indexOf(registrationId);
  return (
    <PlayerSheet
      slug={slug}
      row={row}
      desk={loaded.desk}
      teams={teams}
      mutate={mutate}
      onClose={onClose}
      initialTab="squad"
      {...(index >= 0
        ? {
            position: { index, total: order.length },
            ...(index > 0
              ? {
                  onPrev: () => {
                    const target = order[index - 1];
                    if (target !== undefined) {
                      onNavigate(target);
                    }
                  },
                }
              : {}),
            ...(index < order.length - 1
              ? {
                  onNext: () => {
                    const target = order[index + 1];
                    if (target !== undefined) {
                      onNavigate(target);
                    }
                  },
                }
              : {}),
          }
        : {})}
    />
  );
}
