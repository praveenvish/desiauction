"use client";

import { Card, SectionHeader } from "@desiauction/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

export interface ShortcutCompetition {
  slug: string;
  name: string;
  orgName: string;
}

const RECENT_KEY = "da:recent-competitions";
const PIN_KEY = "da:pinned-competitions";

function readList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Records a competition visit — called by the shell on navigation. */
export function recordRecentCompetition(slug: string): void {
  const next = [slug, ...readList(RECENT_KEY).filter((entry) => entry !== slug)].slice(0, 5);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

/**
 * Continue working + Pinned items (PX-2 scope §5). Presentation-only state:
 * device-local (localStorage), never sent to the server — pins and recents are
 * a personal lens over data the session already holds, not new backend truth.
 */
export function HomeShortcuts({ competitions }: { competitions: ShortcutCompetition[] }) {
  const [recent, setRecent] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>([]);

  useEffect(() => {
    setRecent(readList(RECENT_KEY));
    setPins(readList(PIN_KEY));
  }, []);

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
    setPins(next);
    window.localStorage.setItem(PIN_KEY, JSON.stringify(next));
  };

  if (pinned.length === 0 && continuing.length === 0) {
    return null;
  }

  return (
    <>
      {pinned.length > 0 ? (
        <>
          <SectionHeader title="Pinned" />
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
        </>
      ) : null}
      {continuing.length > 0 ? (
        <>
          <SectionHeader title="Continue working" />
          <div className="home-grid" data-testid="home-recent">
            {continuing.map((competition) => (
              <ShortcutCard
                key={competition.slug}
                competition={competition}
                pinned={false}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        </>
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
    <Card className="home-shortcut-card">
      <Link href={`/competitions/${competition.slug}`} className="home-card-link">
        <strong>{competition.name}</strong>
        <span className="home-card-sub">{competition.orgName}</span>
      </Link>
      <button
        type="button"
        className="home-pin-button"
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${competition.name}` : `Pin ${competition.name}`}
        onClick={() => {
          onTogglePin(competition.slug);
        }}
      >
        {pinned ? "★" : "☆"}
      </button>
    </Card>
  );
}
