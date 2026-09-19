"use client";

import { Button } from "@desiauction/ui";
import { useState, useTransition } from "react";

import {
  assignAuctioneerAction,
  removeAuctioneerAction,
  type AuctioneerPanelView,
} from "../../../../server/auction/auctioneer-actions";

/**
 * Appoint who runs auction night (launch polish, Phase 3). Shown only to the
 * club's owners. An auctioneer can open the cockpit and run the room for THIS
 * season; they cannot undo a sale, touch money, or see anything else.
 */
export function AuctioneerPanel({ slug, view }: { slug: string; view: AuctioneerPanelView }) {
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>): void {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else setChoice("");
    });
  }

  return (
    <section className="auctioneers" aria-labelledby="auctioneers-title" data-testid="auctioneers">
      <header className="auctioneers-head">
        <h2 id="auctioneers-title">Auctioneer</h2>
        <p>
          Someone who runs this season&apos;s auction room without owning the club. They can open
          lots and bring the hammer down; undoing a sale stays with the club&apos;s owners.
        </p>
      </header>
      {view.auctioneers.length > 0 ? (
        <ul className="auctioneers-list">
          {view.auctioneers.map((row) => (
            <li key={row.personId}>
              <span>{row.name}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  run(() => removeAuctioneerAction(slug, row.personId));
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="auctioneers-none">No auctioneer yet — the club&apos;s owners run the room.</p>
      )}
      {view.candidates.length > 0 ? (
        <div className="auctioneers-assign">
          <label htmlFor="auctioneer-pick">Club member</label>
          <select
            id="auctioneer-pick"
            value={choice}
            onChange={(event) => {
              setChoice(event.target.value);
            }}
          >
            <option value="">Choose a member…</option>
            {view.candidates.map((candidate) => (
              <option key={candidate.personId} value={candidate.personId}>
                {candidate.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={choice === "" || pending}
            loading={pending}
            data-testid="assign-auctioneer"
            onClick={() => {
              run(() => assignAuctioneerAction(slug, choice));
            }}
          >
            Make auctioneer
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <p className="auctioneers-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
