"use client";

import { Button, Dialog, Field, PlayerImage, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { useMoney, useMoneyUnit } from "../../../../components/money-unit";
import {
  placeByHandAction,
  priceByHandAction,
  publishByHandAction,
} from "../../../../server/competition/hand-results-actions";
import type { TeamCard, TeamRosterRow } from "../../../../server/competition/team-workspace";
import { PlayerPicker, useSquadCandidates } from "./squad-desk";

/**
 * RESULTS OF AN AUCTION HELD OUTSIDE THE APP (0105).
 *
 * The whole job is "who did this team buy, and for how much", typed as fast as
 * the organiser can read it off the sheet:
 *
 *   type a name → Enter        the player joins the team, the cursor jumps to
 *                              their points box
 *   type points → Enter        saved, the cursor is back in the search box
 *   Enter on an empty box      no price — the poster just leaves it off
 *
 * Nothing is final until "Publish teams" on the Teams page.
 */

/** A bought player as this screen holds them, before the server catches up. */
interface Bought {
  id: string;
  name: string;
  photoUrl: string | null;
  /** Paise; null = no price given. */
  price: number | null;
}

const whole = (price: number | null): string => (price === null ? "" : String(price / 100));

export function BoughtByHand({
  slug,
  teamId,
  teamName,
  teamColor,
  roster,
}: {
  slug: string;
  teamId: string;
  teamName: string;
  teamColor: string | null;
  roster: readonly TeamRosterRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const money = useMoney();
  const unit = useMoneyUnit();
  const [, startRefresh] = useTransition();
  const candidates = useSquadCandidates(slug, roster);
  const searchRef = useRef<HTMLInputElement>(null);
  const priceRefs = useRef(new Map<string, HTMLInputElement>());
  // The row whose points box takes the cursor once it has rendered.
  const focusId = useRef<string | null>(null);
  // Added here, not yet confirmed by the server: a refresh for another row
  // must not drop them.
  const pendingIds = useRef(new Set<string>());

  const fromServer = useMemo(
    () =>
      roster
        .filter((row) => !row.isCaptain && !row.isIcon && !row.isRetained)
        .map((row): Bought => ({
          id: row.registrationId,
          name: row.name ?? "Unnamed",
          photoUrl: row.photoUrl,
          price: row.handPrice ?? null,
        })),
    [roster],
  );

  /*
   * The list keeps the order the organiser built it in: newest on top while
   * they type, and a refresh from the server never reshuffles rows under the
   * cursor. Rows the server dropped go; rows it added join the end.
   */
  const [list, setList] = useState<Bought[]>(fromServer);
  const [seen, setSeen] = useState(fromServer);
  if (seen !== fromServer) {
    setSeen(fromServer);
    setList((current) => {
      const server = new Map(fromServer.map((row) => [row.id, row]));
      const kept = current
        .filter((row) => server.has(row.id) || pendingIds.current.has(row.id))
        .map((row) => ({ ...row, ...(server.get(row.id) ?? {}) }));
      const known = new Set(kept.map((row) => row.id));
      return [...kept, ...fromServer.filter((row) => !known.has(row.id))];
    });
  }

  useEffect(() => {
    if (focusId.current !== null && priceRefs.current.has(focusId.current)) {
      priceRefs.current.get(focusId.current)?.focus();
      focusId.current = null;
    }
  }, [list]);

  const spent = list.reduce((sum, row) => sum + (row.price ?? 0), 0);

  const add = async (id: string, name: string, photoUrl: string | null) => {
    pendingIds.current.add(id);
    setList((current) => [{ id, name, photoUrl, price: null }, ...current]);
    focusId.current = id;
    const result = await placeByHandAction(slug, id, teamId);
    pendingIds.current.delete(id);
    if (!result.ok) {
      setList((current) => current.filter((row) => row.id !== id));
      toast({ title: result.error, tone: "danger" });
      searchRef.current?.focus();
      return;
    }
    startRefresh(() => {
      router.refresh();
    });
  };

  const remove = async (row: Bought) => {
    const before = list;
    setList((current) => current.filter((other) => other.id !== row.id));
    const result = await placeByHandAction(slug, row.id, null);
    if (!result.ok) {
      setList(before);
      toast({ title: result.error, tone: "danger" });
      return;
    }
    toast({ title: `${row.name} is off ${teamName}`, tone: "success" });
    startRefresh(() => {
      router.refresh();
    });
  };

  const unitWord = unit === "points" ? "points" : "₹";

  return (
    <section className="tm-hand" aria-label={`Players ${teamName} bought`} data-testid="hand-entry">
      <div className="tm-hand-top">
        <PlayerPicker
          label={`Add a player ${teamName} bought`}
          placeholder="Search a player to add…"
          candidates={candidates}
          teamId={teamId}
          exclude={list.map((row) => row.id)}
          onlyOnTeam={false}
          blockOtherTeams
          inputRef={searchRef}
          testId="hand-search"
          onPick={(candidate) => {
            void add(candidate.id, candidate.name ?? candidate.number, candidate.photoUrl);
          }}
        />
        <p className="tm-hand-sum" data-testid="hand-spent">
          <span>
            {list.length} player{list.length === 1 ? "" : "s"}
          </span>
          <span>
            Spent <b>{money.exact(spent)}</b>
          </span>
        </p>
      </div>
      {list.length === 0 ? (
        <p className="pd-quiet tm-hand-empty">
          Nobody yet. Search a name above and press Enter — then type the {unitWord} they went for.
        </p>
      ) : (
        <ul className="tm-hand-list" data-testid="hand-list">
          {list.map((row) => (
            <HandRow
              key={row.id}
              slug={slug}
              row={row}
              teamColor={teamColor}
              unit={unit}
              inputRef={(node) => {
                if (node === null) {
                  priceRefs.current.delete(row.id);
                } else {
                  priceRefs.current.set(row.id, node);
                }
              }}
              onSaved={(price) => {
                setList((current) =>
                  current.map((other) => (other.id === row.id ? { ...other, price } : other)),
                );
              }}
              onDone={() => {
                searchRef.current?.focus();
              }}
              onRemove={() => {
                void remove(row);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function HandRow({
  slug,
  row,
  teamColor,
  unit,
  inputRef,
  onSaved,
  onDone,
  onRemove,
}: {
  slug: string;
  row: Bought;
  teamColor: string | null;
  unit: "inr" | "points";
  inputRef: (node: HTMLInputElement | null) => void;
  onSaved: (price: number | null) => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(whole(row.price));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(whole(row.price));

  const save = async (): Promise<boolean> => {
    const typed = value.trim();
    if (typed === saved.current) {
      return true;
    }
    setState("saving");
    const result = await priceByHandAction(slug, row.id, typed);
    if (!result.ok) {
      setState("error");
      setError(result.error);
      return false;
    }
    saved.current = typed;
    setState("saved");
    setError(null);
    onSaved(result.price);
    return true;
  };

  return (
    <li className="tm-hand-row" data-testid="hand-row" data-state={state}>
      <PlayerImage
        name={row.name}
        seed={row.id}
        src={row.photoUrl}
        size="sm"
        shape="round"
        teamColor={teamColor ?? undefined}
        decorative
      />
      <span className="tm-hand-name">{row.name}</span>
      <span className="tm-hand-price">
        {unit === "inr" ? <span aria-hidden>₹</span> : null}
        <input
          ref={inputRef}
          className="pd-input tm-hand-input"
          inputMode="numeric"
          enterKeyHint="next"
          autoComplete="off"
          placeholder="—"
          aria-label={`${unit === "points" ? "Points" : "Price"} for ${row.name}`}
          aria-invalid={state === "error" || undefined}
          data-testid="hand-price"
          value={value}
          onChange={(event) => {
            setValue(event.target.value.replace(/[^\d]/g, ""));
            if (state !== "saving") {
              setState("idle");
            }
          }}
          onBlur={() => {
            void save();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save().then((ok) => {
                if (ok) {
                  onDone();
                }
              });
            }
          }}
        />
        {unit === "points" ? <span className="pd-quiet">pts</span> : null}
        <span className="tm-hand-tick" aria-live="polite">
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : ""}
        </span>
      </span>
      <button
        type="button"
        className="tm-hand-remove"
        aria-label={`Remove ${row.name}`}
        onClick={onRemove}
      >
        ✕
      </button>
      {error !== null ? <p className="tm-hand-error">{error}</p> : null}
    </li>
  );
}

/**
 * THE LAST STEP: publish what was typed.
 *
 * Shown on the Teams page while the season has no auction in the app. The
 * dialog is the review — every team, how many it bought and what it spent —
 * plus the one number publishing needs: the purse every team started with.
 */
export function PublishByHand({ slug, teams }: { slug: string; teams: readonly TeamCard[] }) {
  const router = useRouter();
  const toast = useToast();
  const money = useMoney();
  const unit = useMoneyUnit();
  const [open, setOpen] = useState(false);
  const [purse, setPurse] = useState("");
  const [error, setError] = useState<{ text: string; field: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = teams.map((team) => {
    const bought = (team.roster ?? []).filter(
      (row) => !row.isCaptain && !row.isIcon && !row.isRetained,
    );
    return {
      id: team.id,
      name: team.name,
      bought: bought.length,
      spent: bought.reduce((sum, row) => sum + (row.handPrice ?? 0), 0),
    };
  });
  const placed = rows.reduce((sum, row) => sum + row.bought, 0);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const publish = async () => {
    setBusy(true);
    const result = await publishByHandAction(slug, purse);
    setBusy(false);
    if (!result.ok) {
      setError({ text: result.error, field: result.field === "purse" });
      return;
    }
    setOpen(false);
    toast({ title: "Teams published — posters and team cards are ready", tone: "success" });
    router.refresh();
  };

  return (
    <section
      className="tm-next tm-hand-publish"
      data-testid="hand-publish"
      aria-labelledby="tm-hand-title"
    >
      <span className="tm-next-text">
        <strong id="tm-hand-title">Auction already done outside the app?</strong>
        <span>
          Open each team and add the players it bought — {unit === "points" ? "points" : "price"}{" "}
          optional. Then publish: posters and team cards turn on, and the teams lock.
        </span>
      </span>
      <Button
        onClick={() => {
          setOpen(true);
        }}
        disabled={placed === 0}
        data-testid="hand-publish-open"
      >
        Publish teams
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Publish teams?"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Not yet
            </Button>
            <Button
              loading={busy}
              onClick={() => void publish()}
              data-testid="hand-publish-confirm"
            >
              Publish teams
            </Button>
          </>
        }
      >
        <table className="tm-hand-review" data-testid="hand-review">
          <thead>
            <tr>
              <th>Team</th>
              <th className="tm-num">Bought</th>
              <th className="tm-num">Spent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td className="tm-num">{row.bought}</td>
                <td className="tm-num">{money.exact(row.spent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Field
          label={unit === "points" ? "Points each team started with" : "Purse per team (₹)"}
          name="purse"
          inputMode="numeric"
          autoComplete="off"
          value={purse}
          help="Used for the “left” figure on team cards and squad posters."
          data-testid="hand-purse"
          {...(error?.field === true ? { error: error.text } : {})}
          onChange={(event) => {
            setPurse(event.target.value.replace(/[^\d]/g, ""));
            setError(null);
          }}
        />
        {error !== null && !error.field ? <p className="tm-hand-error">{error.text}</p> : null}
        <p className="tm-hand-warn">
          <b>Results can&apos;t be changed after you publish.</b> Players not on any team are marked
          unsold.
        </p>
      </Dialog>
    </section>
  );
}
