"use client";

import {
  POSTER_KIND_SIZES,
  POSTER_SIZES,
  POSTER_THEMES,
  TOP_BUY_COUNTS,
  type PosterKind,
  type PosterSize,
  type PosterTheme,
  type TopBuyCount,
} from "@desiauction/core";
import {
  Button,
  ButtonLink,
  Field,
  IconDownload,
  IconImage,
  IconPencil,
  IconSend,
  Notice,
  SectionCard,
  Select,
} from "@desiauction/ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useMoney } from "../../../../components/money-unit";
import { withViewTransition } from "../../../../lib/view-transition";
import {
  buildScene,
  loadCountFont,
  loadSprite,
  exportSceneVideo,
  playScene,
  videoExportMode,
  type Scene,
} from "./poster-motion";
import { skinFor } from "./poster-skins";

import type { PosterPicker } from "../../../../server/competition/posters";

/**
 * THE POSTER STUDIO.
 *
 * Pick a poster, a look and a shape; watch it; take it. One screen, because the
 * hour after the gavel falls is the only hour when every owner and every player
 * WANTS to broadcast, and a studio that made them think would spend that hour.
 *
 * Everything here is a URL. The preview, the download and the animation are the
 * SAME route with different query strings — a preview rendered by different
 * code from the file would be a preview that can lie, and this is the last
 * thing anybody looks at before it goes to a few hundred people.
 */

const KIND_LABEL: Record<PosterKind, { label: string; hint: string }> = {
  player: { label: "Player card", hint: "One player's verdict — sold, icon, captain or retained" },
  team: { label: "Squad sheet", hint: "Every face in a squad, with what the franchise spent" },
  reveal: { label: "Meet the squad", hint: "The same squad, announced — faces only, no money" },
  top: { label: "Top buys", hint: "The night's biggest signings, ranked" },
  season: { label: "All squads", hint: "Every franchise in the season on one sheet" },
};

/**
 * Theme names the organizer reads, not the enum the renderer reads. The swatch
 * beside each one is the palette itself, taken from the renderer's own skins —
 * so the picker can never advertise a colour the poster does not use.
 */
const THEME_LABEL: Record<PosterTheme, { name: string; hint: string }> = {
  floodlight: { name: "Floodlight", hint: "The night look" },
  matchday: { name: "Matchday", hint: "The team's own colour" },
  minimal: { name: "Minimal", hint: "Light and editorial" },
  gold: { name: "Gold", hint: "The trophy look" },
  arena: { name: "Arena", hint: "Bold and high-contrast" },
  ink: { name: "Ink", hint: "Quiet and printable" },
};

const SIZE_LABEL: Record<PosterSize, { label: string; hint: string }> = {
  square: { label: "Square", hint: "Feed · 1080 × 1080" },
  portrait: { label: "Portrait", hint: "Post · 1080 × 1350" },
  story: { label: "Story", hint: "Status · 1080 × 1920" },
};

type Tab = "still" | "motion";

export function PosterStudio({ slug, view }: { slug: string; view: PosterPicker }) {
  /*
   * WHAT THIS PERSON CAN ACTUALLY MAKE.
   *
   * `view.kinds` comes from the same grant the image routes enforce, so the
   * studio is never a menu of 404s: an organizer sees the season-wide sheets, a
   * player sees their own card, an owner sees their squad — and a kind whose
   * subjects do not exist yet is not offered at all.
   */
  const kinds = view.kinds;
  const [kind, setKind] = useState<PosterKind>(kinds[0] ?? "player");
  const [playerId, setPlayerId] = useState(view.players[0]?.id ?? "");
  const [teamId, setTeamId] = useState(view.teams[0]?.id ?? "");
  const [theme, setTheme] = useState<PosterTheme>("floodlight");
  const [wantedSize, setSize] = useState<PosterSize>("portrait");
  const [count, setCount] = useState<TopBuyCount>(5);
  const [prices, setPrices] = useState(true);
  const [sponsorDraft, setSponsorDraft] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [tab, setTab] = useState<Tab>("still");

  // Every keystroke in the credit line would otherwise be a fresh render of a
  // poster carrying somebody's face — and a fresh audit row for it.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSponsor(sponsorDraft.trim());
    }, 700);
    return () => {
      clearTimeout(timer);
    };
  }, [sponsorDraft]);

  /*
   * The shape is DERIVED against the kind, not corrected after the fact. The
   * season sheet has no square (twelve squads of thumbnails is not a poster),
   * and a switch to it while "Square" was selected must not render one frame of
   * a poster nobody can read — nor cost a render to fix.
   */
  const sizes = POSTER_KIND_SIZES[kind];
  const size = sizes.includes(wantedSize) ? wantedSize : (sizes[0] ?? "portrait");

  const subjects = kind === "team" || kind === "reveal" ? view.teams : view.players;
  const subjectId = kind === "team" || kind === "reveal" ? teamId : playerId;
  const needsSubject = kind === "player" || kind === "team" || kind === "reveal";
  const showPrices = kind !== "reveal";

  const base =
    kind === "top"
      ? `/seasons/${slug}/posters/top`
      : kind === "season"
        ? `/seasons/${slug}/posters/season`
        : `/seasons/${slug}/posters/${kind}/${subjectId}`;
  const query = useMemo(() => {
    const params = new URLSearchParams({ theme, size });
    if (kind === "top") {
      params.set("n", String(count));
    }
    if (showPrices && !prices) {
      params.set("prices", "0");
    }
    if (sponsor !== "") {
      params.set("sponsor", sponsor);
    }
    return params.toString();
  }, [theme, size, kind, count, prices, showPrices, sponsor]);

  const ready = !needsSubject || subjectId !== "";
  const previewSrc = ready ? `${base}?${query}` : null;
  const downloadHref = previewSrc === null ? null : `${previewSrc}&download=1`;
  const motionSrc = previewSrc === null ? null : `${previewSrc}&motion=1`;

  return (
    <div className="ps-layout">
      <SectionCard
        icon={<IconPencil />}
        title={view.scope === "mine" ? "Style it" : "Design a poster"}
        description={`${
          view.scope === "mine"
            ? "Your card, ready to post."
            : "A card for a player, a squad, or the whole season."
        } ${view.competitionName}.`}
      >
        <div className="ps-controls">
          {kinds.length < 2 ? null : (
            <Select
              label="What"
              value={kind}
              onChange={(event) => {
                const next = event.target.value as PosterKind;
                withViewTransition(() => {
                  setKind(kinds.includes(next) ? next : (kinds[0] ?? "player"));
                });
              }}
              help={KIND_LABEL[kind].hint}
              data-testid="poster-kind"
            >
              {kinds.map((value) => (
                <option key={value} value={value}>
                  {KIND_LABEL[value].label}
                </option>
              ))}
            </Select>
          )}

          {!needsSubject ? null : (
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
          )}

          {kind !== "top" ? null : (
            <Select
              label="How many"
              value={String(count)}
              onChange={(event) => {
                const next = Number(event.target.value);
                setCount(next === 3 || next === 10 ? next : 5);
              }}
              data-testid="poster-count"
            >
              {TOP_BUY_COUNTS.map((value) => (
                <option key={value} value={value}>
                  {`Top ${String(value)}`}
                </option>
              ))}
            </Select>
          )}

          {/*
            The template picker is a swatch, not a word: "Matchday" means
            nothing until you have seen it, and the chips are read from the
            renderer's own palettes so the picker cannot advertise a colour the
            poster does not use.
          */}
          <fieldset className="ps-fieldset" data-testid="poster-theme">
            <legend className="ps-legend">Template</legend>
            <div className="ps-swatches">
              {POSTER_THEMES.map((value) => {
                const { palette } = skinFor(value, null);
                return (
                  <label
                    key={value}
                    className="ps-swatch"
                    data-active={value === theme ? "true" : undefined}
                  >
                    <input
                      type="radio"
                      name="poster-theme"
                      value={value}
                      checked={value === theme}
                      onChange={() => {
                        /*
                         * The preview is a 1080px PNG fetched from our own
                         * route, so it swaps in one step with nothing in
                         * between. A crossfade is the difference between "the
                         * picture changed" and "something went wrong".
                         */
                        withViewTransition(() => {
                          setTheme(value);
                        });
                      }}
                    />
                    <span
                      className="ps-chips"
                      aria-hidden
                      style={{
                        // The poster's palette, not the app's: these are the
                        // rasterizer's literal colours by design.
                        background: palette.surface,
                        borderColor: palette.border,
                      }}
                    >
                      <span style={{ background: palette.accent }} />
                      <span style={{ background: palette.heading }} />
                    </span>
                    <span className="ps-swatch-label">
                      {THEME_LABEL[value].name}
                      <small>{THEME_LABEL[value].hint}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Select
            label="Shape"
            value={size}
            onChange={(event) => {
              const next = event.target.value as PosterSize;
              // Square to story changes the frame's aspect ratio as well as the
              // image, so this is the one that most looks like a glitch without
              // a transition: the card resizes AND its contents change at once.
              withViewTransition(() => {
                setSize(sizes.includes(next) ? next : (sizes[0] ?? "portrait"));
              });
            }}
            data-testid="poster-size"
          >
            {sizes.map((value) => (
              <option key={value} value={value}>
                {`${SIZE_LABEL[value].label} — ${SIZE_LABEL[value].hint}`}
              </option>
            ))}
          </Select>

          {!showPrices ? null : (
            <label className="ps-check">
              <input
                type="checkbox"
                checked={prices}
                onChange={(event) => {
                  setPrices(event.target.checked);
                }}
                data-testid="poster-prices"
              />
              <span>
                Show prices
                <small>Off for a poster going to a fan group rather than a committee.</small>
              </span>
            </label>
          )}

          <Field
            label="Sponsor credit (optional)"
            value={sponsorDraft}
            onChange={(event) => {
              setSponsorDraft(event.target.value);
            }}
            placeholder="e.g. Sharma Motors"
            maxLength={44}
            data-testid="poster-sponsor"
          />
        </div>

        {view.showBranding ? (
          <p className="st-note ps-brand-note">
            Every poster carries the DesiAuction lockup. On a paid pass it drops the desiauction.in
            line under it.
          </p>
        ) : null}
      </SectionCard>

      <SectionCard
        icon={<IconImage />}
        tone="purple"
        title="Preview"
        description={SIZE_LABEL[size].hint}
        action={
          downloadHref !== null ? (
            /* A plain anchor, not next/link: the href is our own image route and
               `download` must reach the DOM for the browser to save rather than
               navigate. */
            <ButtonLink href={downloadHref} download size="sm" data-testid="poster-download">
              <IconDownload size={16} aria-hidden />
              Download PNG
            </ButtonLink>
          ) : undefined
        }
      >
        {previewSrc === null || motionSrc === null ? (
          <p className="st-note">
            {view.scope === "mine"
              ? "There is no card here for you yet — one appears once the auction reaches a verdict on your lot."
              : kind === "player"
                ? "No approved players yet — approve a registration and the cards appear here."
                : "No teams yet — add a franchise and its squad card appears here."}
          </p>
        ) : (
          <>
            <div className="ps-tabs" role="group" aria-label="Preview mode">
              {(["still", "motion"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="ps-tab"
                  data-active={value === tab ? "true" : undefined}
                  aria-pressed={value === tab}
                  onClick={() => {
                    setTab(value);
                  }}
                  data-testid={`poster-tab-${value}`}
                >
                  {value === "still" ? "Poster" : "Animated"}
                </button>
              ))}
            </div>
            {tab === "still" ? (
              <div className="poster-preview" data-poster-size={size}>
                {/* A plain <img>, like the board's crest: the poster is rendered
                    by our own route at a fixed size, and next/image would
                    re-encode a PNG that is already exactly what the user is
                    about to download. */}
                <img
                  key={previewSrc}
                  src={previewSrc}
                  alt="Poster preview"
                  className="poster-preview-image"
                />
              </div>
            ) : (
              // Keyed by the URL: a new poster is a new panel, so its loading
              // state starts where it should instead of being reset by an
              // effect on the way past.
              <MotionPanel key={motionSrc} src={motionSrc} size={size} />
            )}
            <ShareRow previewSrc={previewSrc} />
          </>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * The animated preview, and the file it makes.
 *
 * The sprite is the same render as the poster (see `poster-motion.ts`), so the
 * film's last frame is the PNG. Where the browser can encode H.264 the file is
 * an MP4 made frame by frame — seconds, and fine in a background tab; where it
 * cannot, the old real-time recording, which says so instead of appearing to
 * hang.
 */
function MotionPanel({ src, size }: { src: string; size: PosterSize }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [recording, setRecording] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Asked once: whether this browser encodes H.264 is an async question.
  const [mode, setMode] = useState<"mp4" | "recorder" | null | undefined>(undefined);
  const { unit } = useMoney();

  useEffect(() => {
    let live = true;
    void videoExportMode(POSTER_SIZES[size].width, POSTER_SIZES[size].height).then((found) => {
      if (live) {
        setMode(found);
      }
    });
    return () => {
      live = false;
    };
  }, [size]);

  useEffect(() => {
    const controller = new AbortController();
    let player: { stop: () => void } | null = null;
    void (async () => {
      try {
        await loadCountFont();
        const sprite = await loadSprite(src, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        const scene = buildScene(sprite, unit);
        sceneRef.current = scene;
        const canvas = canvasRef.current;
        if (canvas === null) {
          return;
        }
        if (canvas.width !== scene.width || canvas.height !== scene.height) {
          canvas.width = scene.width;
          canvas.height = scene.height;
        }
        setState("ready");
        player = playScene(canvas, scene);
      } catch {
        if (!controller.signal.aborted) {
          setState("failed");
        }
      }
    })();
    return () => {
      controller.abort();
      player?.stop();
    };
  }, [src, unit]);

  const canRecord = mode === "mp4" || mode === "recorder";

  return (
    <div className="ps-motion">
      <div className="poster-preview" data-poster-size={size}>
        {/*
          The canvas is BORN the poster's shape. Sized only by the effect, it
          spent the first seconds as the 300x150 box every canvas starts as —
          a blank letterbox where the poster was about to be, which reads as a
          broken screen rather than one that is working.
        */}
        <canvas
          ref={canvasRef}
          width={POSTER_SIZES[size].width}
          height={POSTER_SIZES[size].height}
          className="poster-preview-image"
          aria-label="Animated poster"
          data-state={state}
        />
      </div>
      {state === "loading" ? (
        <p className="st-note" aria-live="polite">
          Building the animation from the poster…
        </p>
      ) : null}
      {state === "failed" ? (
        <Notice tone="warning" title="The animation could not be built">
          The poster itself is fine — switch back to Poster and download the PNG.
        </Notice>
      ) : null}
      {problem === null ? null : (
        <Notice tone="warning" title="That did not record">
          {problem}
        </Notice>
      )}
      <div className="ps-actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={state !== "ready" || !canRecord || recording !== null}
          loading={recording !== null}
          onClick={() => {
            const scene = sceneRef.current;
            if (scene === null) {
              return;
            }
            setProblem(null);
            setRecording(0);
            void exportSceneVideo(scene, (fraction) => {
              setRecording(Math.round(fraction * 100));
            })
              .then(({ blob, extension }) => {
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `poster.${extension}`;
                anchor.click();
                URL.revokeObjectURL(url);
              })
              .catch(() => {
                setProblem(
                  mode === "mp4"
                    ? "The video could not be made. Try again — the poster PNG works either way."
                    : "The browser stopped the recording. Keep this tab in front and retry.",
                );
              })
              .finally(() => {
                setRecording(null);
              });
          }}
          data-testid="poster-record"
        >
          <IconDownload size={16} aria-hidden />
          {recording === null
            ? "Download video"
            : `${mode === "mp4" ? "Making video" : "Recording"} ${String(recording)}%`}
        </Button>
        <p className="st-note">
          {mode === undefined
            ? " "
            : mode === "mp4"
              ? "An MP4 for WhatsApp Status — ready in a few seconds."
              : mode === "recorder"
                ? "Records in real time — keep this tab in front until it saves."
                : "This browser cannot make video. The poster PNG works everywhere."}
        </p>
      </div>
    </div>
  );
}

/** Straight into WhatsApp where the browser offers it, and nowhere else. */
function ShareRow({ previewSrc }: { previewSrc: string }) {
  const [busy, setBusy] = useState(false);
  /*
   * `navigator.share` does not exist on the server and exists on roughly every
   * phone, so the button is decided AFTER hydration — rendering it on the
   * server would either hydrate into a mismatch or promise a share sheet a
   * laptop has no way to open. `useSyncExternalStore` with a constant
   * subscription is the sanctioned way to say "client only" without an effect
   * that sets state on the first paint.
   */
  const supported = useSyncExternalStore(
    () => () => undefined,
    () => typeof navigator.share === "function",
    () => false,
  );
  if (!supported) {
    return null;
  }
  return (
    <div className="ps-actions">
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={() => {
          setBusy(true);
          void (async () => {
            try {
              const response = await fetch(previewSrc);
              const blob = await response.blob();
              const file = new File([blob], "poster.png", { type: "image/png" });
              if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file] });
              } else {
                await navigator.share({ url: window.location.href });
              }
            } catch {
              // A cancelled share is the commonest outcome and not an error.
            } finally {
              setBusy(false);
            }
          })();
        }}
        data-testid="poster-share"
      >
        <IconSend size={16} aria-hidden />
        Share
      </Button>
    </div>
  );
}
