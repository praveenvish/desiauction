"use client";

import { IconArrowRight, IconStar, IconStarOutline } from "@desiauction/ui";
import Link from "next/link";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";

import { monogram } from "../../components/season-hero/season-hero";

export interface ShortcutCompetition {
  slug: string;
  name: string;
  orgName: string;
  /** "19 Sept – 21 Sept 2026 · Kolkata" — whatever the season has. */
  meta?: string;
}

const RECENT_KEY = "da:recent-competitions";
const PIN_KEY = "da:pinned-competitions";

/*
 * The two lists live in localStorage, which is the store; the component
 * subscribes to it rather than copying it into state on mount. The snapshot is
 * the raw string (stable between writes, so React can compare it), parsed
 * once per change. Other tabs announce writes through `storage`; this tab
 * announces its own through `notify`, because `storage` never fires in the tab
 * that wrote.
 */
const listeners = new Set<() => void>();

function subscribeLists(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseList(raw: string | null): string[] {
  try {
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Private mode / storage disabled: shortcuts are a convenience, not state.
    return;
  }
  for (const notify of listeners) {
    notify();
  }
}

function useList(key: string): string[] {
  const raw = useSyncExternalStore(
    subscribeLists,
    () => readRaw(key),
    () => null,
  );
  return useMemo(() => parseList(raw), [raw]);
}

/** Records a competition visit — called by the shell on navigation. */
export function recordRecentCompetition(slug: string): void {
  const next = [slug, ...parseList(readRaw(RECENT_KEY)).filter((entry) => entry !== slug)].slice(
    0,
    5,
  );
  writeList(RECENT_KEY, next);
}

/**
 * Continue working + Pinned items (PX-2 scope §5). Presentation-only state:
 * device-local (localStorage), never sent to the server — pins and recents are
 * a personal lens over data the session already holds, not new backend truth.
 */
export function HomeShortcuts({
  competitions,
  createCard,
}: {
  competitions: ShortcutCompetition[];
  /** The dashed "Create a new tournament" card, beside the recents — offered
      only to someone who may create one. */
  createCard?: ReactNode;
}) {
  const recent = useList(RECENT_KEY);
  const pins = useList(PIN_KEY);

  const bySlug = new Map(competitions.map((competition) => [competition.slug, competition]));
  const pinned = pins
    .map((slug) => bySlug.get(slug))
    .filter((c): c is ShortcutCompetition => c !== undefined);
  const continuing = recent
    .filter((slug) => !pins.includes(slug))
    .map((slug) => bySlug.get(slug))
    .filter((c): c is ShortcutCompetition => c !== undefined)
    .slice(0, 3);

  const togglePin = (slug: string) => {
    const next = pins.includes(slug) ? pins.filter((entry) => entry !== slug) : [...pins, slug];
    writeList(PIN_KEY, next);
  };

  if (pinned.length === 0 && continuing.length === 0) {
    return null;
  }

  return (
    <>
      {pinned.length > 0 ? (
        <section className="home-shortcuts" aria-labelledby="home-pinned-title">
          <h2 id="home-pinned-title" className="home-block-title">
            Pinned
          </h2>
          <div className="home-grid" data-testid="home-pinned">
            {pinned.map((competition) => (
              <ShortcutCard
                key={competition.slug}
                competition={competition}
                pinned
                onTogglePin={togglePin}
              />
            ))}
          </div>
        </section>
      ) : null}
      {continuing.length > 0 ? (
        <section className="home-shortcuts" aria-labelledby="home-recent-title">
          <h2 id="home-recent-title" className="home-block-title">
            Continue working
          </h2>
          <div className="home-grid" data-testid="home-recent">
            {continuing.map((competition) => (
              <ShortcutCard
                key={competition.slug}
                competition={competition}
                pinned={false}
                onTogglePin={togglePin}
              />
            ))}
            {createCard}
          </div>
        </section>
      ) : null}
    </>
  );
}

function ShortcutCard({
  competition,
  pinned,
  onTogglePin,
}: {
  competition: ShortcutCompetition;
  pinned: boolean;
  onTogglePin: (slug: string) => void;
}) {
  return (
    <div className="home-shortcut-card">
      <span className="home-crest" aria-hidden>
        {monogram(competition.name)}
      </span>
      <Link href={`/seasons/${competition.slug}`} className="home-card-link">
        <strong>{competition.name}</strong>
        <span className="home-card-sub">{competition.meta ?? competition.orgName}</span>
      </Link>
      <span className="home-card-go" aria-hidden>
        <IconArrowRight size={16} />
      </span>
      <button
        type="button"
        className="home-pin-button"
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${competition.name}` : `Pin ${competition.name}`}
        onClick={() => {
          onTogglePin(competition.slug);
        }}
      >
        {pinned ? <IconStar size={18} /> : <IconStarOutline size={18} />}
      </button>
    </div>
  );
}
