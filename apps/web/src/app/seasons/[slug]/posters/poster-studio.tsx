"use client";

import { POSTER_THEMES, type PosterSize, type PosterTheme } from "@desiauction/core";
import { ButtonLink, Card, Select } from "@desiauction/ui";
import { useState } from "react";

import type { PosterPicker } from "../../../../server/competition/posters";

/**
 * Theme names the organizer reads, not the enum the renderer reads. "floodlight"
 * is what the palette is called in this codebase; "Floodlight" with a sentence
 * of intent is what tells somebody which one to pick for a WhatsApp Status.
 */
const THEME_LABEL: Record<PosterTheme, string> = {
  floodlight: "Floodlight — the night look",
  gold: "Gold — the trophy look",
  arena: "Arena — bold and high-contrast",
  ink: "Ink — quiet and printable",
};

const SIZES: { value: PosterSize; label: string; hint: string }[] = [
  { value: "square", label: "Square", hint: "Feed · 1080 × 1080" },
  { value: "story", label: "Story", hint: "Status · 1080 × 1920" },
];

type Kind = "player" | "team";

export function PosterStudio({ slug, view }: { slug: string; view: PosterPicker }) {
  const [kind, setKind] = useState<Kind>("player");
  const subjects = kind === "player" ? view.players : view.teams;
  const [playerId, setPlayerId] = useState(view.players[0]?.id ?? "");
  const [teamId, setTeamId] = useState(view.teams[0]?.id ?? "");
  const subjectId = kind === "player" ? playerId : teamId;
  const [theme, setTheme] = useState<PosterTheme>("floodlight");
  const [size, setSize] = useState<PosterSize>("square");

  const base = `/seasons/${slug}/posters/${kind}/${subjectId}`;
  const query = `theme=${theme}&size=${size}`;
  // The SAME route draws the preview and the file. A preview rendered by
  // different code from the download is a preview that can lie, and this one is
  // the last thing anybody looks at before it goes to a few hundred people.
  const previewSrc = subjectId === "" ? null : `${base}?${query}`;
  const downloadHref = subjectId === "" ? null : `${base}?${query}&download=1`;

  return (
    <>
      <Card>
        <h1 className="dash-title">Posters</h1>
        <p className="section-note">
          A card for a player or a whole squad, ready to post. {view.competitionName}.
        </p>

        <div className="poster-controls">
          <Select
            label="What"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value === "team" ? "team" : "player");
            }}
            data-testid="poster-kind"
          >
            <option value="player">A player</option>
            <option value="team">A squad</option>
          </Select>

          <Select
            label={kind === "player" ? "Player" : "Team"}
            value={subjectId}
            onChange={(event) => {
              if (kind === "player") {
                setPlayerId(event.target.value);
              } else {
                setTeamId(event.target.value);
              }
            }}
            data-testid="poster-subject"
          >
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.label} · {subject.sublabel}
              </option>
            ))}
          </Select>

          <Select
            label="Theme"
            value={theme}
            onChange={(event) => {
              const next = event.target.value;
              setTheme(
                POSTER_THEMES.includes(next as PosterTheme) ? (next as PosterTheme) : "floodlight",
              );
            }}
            data-testid="poster-theme"
          >
            {POSTER_THEMES.map((value) => (
              <option key={value} value={value}>
                {THEME_LABEL[value]}
              </option>
            ))}
          </Select>

          <Select
            label="Shape"
            value={size}
            onChange={(event) => {
              setSize(event.target.value === "story" ? "story" : "square");
            }}
            data-testid="poster-size"
          >
            {SIZES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label} — {entry.hint}
              </option>
            ))}
          </Select>
        </div>

        {!view.showBranding ? null : (
          <p className="section-note poster-brand-note">
            Posters on the free pass carry a small DesiAuction strip. A paid pass removes it.
          </p>
        )}
      </Card>

      <Card>
        {previewSrc === null || downloadHref === null ? (
          <p className="section-note">
            {kind === "player"
              ? "No approved players yet — approve a registration and the cards appear here."
              : "No teams yet — add a franchise and its squad card appears here."}
          </p>
        ) : (
          <div className="poster-preview" data-poster-size={size}>
            {/* A plain <img>, like the board's crest: the poster is rendered by
                our own route at a fixed size, and next/image would re-encode a
                PNG that is already exactly what the user is about to download. */}
            <img
              key={previewSrc}
              src={previewSrc}
              alt="Poster preview"
              className="poster-preview-image"
            />
            <div className="poster-actions">
              {/* A plain anchor, not next/link: the href is our own image
                  route and `download` must reach the DOM for the browser to
                  save rather than navigate. */}
              <ButtonLink href={downloadHref} download size="lg" data-testid="poster-download">
                Download PNG
              </ButtonLink>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
