/**
 * THE PUBLIC KIT — the parts every public page is assembled from.
 *
 * Before this, each public page drew its own title band, its own cards and its
 * own filter chips, which is why /c, /help, /about and /c/[slug] looked like
 * four products. The rule from here: a public page composes these; it does not
 * grow a local copy. Anything a single page needs and no other page wants
 * stays in that page's own file.
 *
 * Server components (no hooks, no state). Interactivity that a page needs —
 * the showcase filters, the sign-in form — stays in that page's client parts.
 */
import { SportIcon } from "@desiauction/ui";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import "./public-kit.css";
import { sportBanner, sportGradientAngle } from "./sport-art";

/* ------------------------------------------------------------------ hero -- */

export interface PageHeroProps {
  /** The small tracked line above the title. */
  eyebrow?: ReactNode;
  /** The page's one h1. A hero never renders a second heading of any level. */
  title: ReactNode;
  /** One sentence. Longer than that belongs in the page body. */
  lede?: ReactNode;
  /** Status pills, shown above the title. */
  status?: ReactNode;
  /** Buttons, a search field, filter chips — whatever the page acts with. */
  actions?: ReactNode;
  /** Facts under the actions (dates, city, organizer). */
  meta?: ReactNode;
  /** Art on the right. `sport` draws the designed fallback when absent. */
  art?: ReactNode;
  /** Draws the fallback gradient + watermark for this sport when `art` is absent. */
  sport?: string;
  /** A photograph behind the whole band (a season's cover). */
  cover?: { src: string; alt?: string } | null;
  /** The handwritten line. At most one per page — see `ScriptTag`. */
  script?: ReactNode;
  /** `page` (default) is the tall opener; `compact` is for content pages. */
  size?: "page" | "compact";
}

/**
 * The dark stadium band every public page opens with.
 *
 * It pins `data-theme="floodlight"` on itself, which is what lets a page sit in
 * either theme and still open on the same night sky: the token pairs cascade,
 * so no bespoke dark palette exists here (the mk- layer's rule, kept).
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  status,
  actions,
  meta,
  art,
  sport,
  cover,
  script,
  size = "page",
}: PageHeroProps) {
  const hasArt = art !== undefined || sport !== undefined;
  return (
    <header className="pk-hero" data-theme="floodlight" data-size={size}>
      {cover == null ? null : (
        <div className="pk-hero-cover" aria-hidden>
          <Image src={cover.src} alt="" fill sizes="100vw" priority />
        </div>
      )}
      <div className="pk-hero-inner">
        <div className="pk-hero-copy">
          {status === undefined ? null : <div className="pk-hero-status">{status}</div>}
          {eyebrow === undefined ? null : <p className="pk-eyebrow">{eyebrow}</p>}
          <h1 className="pk-hero-title">{title}</h1>
          {lede === undefined ? null : <p className="pk-hero-lede">{lede}</p>}
          {meta === undefined ? null : <div className="pk-hero-meta">{meta}</div>}
          {actions === undefined ? null : <div className="pk-hero-actions">{actions}</div>}
        </div>
        {hasArt ? (
          <div
            className="pk-hero-art"
            aria-hidden
            // Marks the sport's stock picture, as opposed to art the page
            // chose (a portrait, a crest): only the stock one may stand down on
            // a phone — see public-kit.css.
            data-placeholder={art === undefined ? "" : undefined}
          >
            {art ?? <SportWatermark sport={sport ?? "cricket"} />}
            {script === undefined ? null : <ScriptTag>{script}</ScriptTag>}
          </div>
        ) : script === undefined ? null : (
          <ScriptTag className="pk-hero-script-alone">{script}</ScriptTag>
        )}
      </div>
    </header>
  );
}

/** One fact in a hero's meta row: an icon and a value. */
export function HeroFact({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="pk-hero-fact">
      {icon === undefined ? null : <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- script tag -- */

/**
 * The handwritten gold line ("Play · Bid · Belong"). Decorative by definition:
 * it is the brand's handwriting, never information, so it is `aria-hidden` and
 * a page that needs the words read out loud must say them in real copy.
 */
export function ScriptTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={className === undefined ? "pk-script" : `pk-script ${className}`} aria-hidden>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- art -- */

/** The designed fallback: the night gradient with the sport's glyph in it. */
export function SportWatermark({ sport, seed = "" }: { sport: string; seed?: string }) {
  return (
    <span
      className="pk-sport-art"
      // The art is always a night scene, in either theme: it stands in for a
      // floodlit photograph, and a cream rectangle with a gold line drawing on
      // it reads as a missing image rather than as the designed fallback.
      data-theme="floodlight"
      data-sport={sport}
      style={{ "--pk-art-angle": `${String(sportGradientAngle(sport, seed))}deg` } as CSSProperties}
    >
      <SportIcon sport={sport} size={220} className="pk-sport-glyph" />
    </span>
  );
}

/**
 * THE SITE-WIDE ART: several sports at once.
 *
 * The directory and the help centre are not about one sport, and a lone cricket
 * ball on either says the opposite of "every sport, one platform" — the exact
 * claim the page under it makes. Five glyphs, the five we can run today that a
 * visitor is most likely to recognise, laid on the same night ground as a
 * single sport's art so the two read as one family.
 */
export function SportMontage({ sports = MONTAGE_SPORTS }: { sports?: readonly string[] }) {
  return (
    <span className="pk-montage" aria-hidden>
      {sports.map((sport) => (
        <span className="pk-montage-cell" key={sport}>
          <SportIcon sport={sport} size={72} />
        </span>
      ))}
    </span>
  );
}

const MONTAGE_SPORTS = ["cricket", "football", "basketball", "hockey", "kabaddi"] as const;

/**
 * A sport's banner: the photograph when one exists, the gradient when it does
 * not. Callers never branch on which — that decision lives in `sport-art.ts`.
 */
export function SportBanner({
  sport,
  alt = "",
  seed = "",
}: {
  sport: string;
  alt?: string;
  /** Varies the fallback gradient between seasons of the same sport. */
  seed?: string;
}) {
  const art = sportBanner(sport);
  if (art === null) {
    return <SportWatermark sport={sport} seed={seed} />;
  }
  return (
    <Image
      className="pk-sport-photo"
      src={art.src}
      alt={alt}
      width={art.width}
      height={art.height}
      style={{ objectPosition: art.position }}
    />
  );
}

/* ------------------------------------------------------------ stat strip -- */

export interface Stat {
  /** The figure. Already formatted — the strip never formats money or dates. */
  value: ReactNode;
  label: ReactNode;
  icon?: ReactNode;
  /** Right-aligned trailing item (e.g. "Organized by Vishnoi Club"). */
  aside?: boolean;
}

/** A row of figures. The only place a page states its counts. */
export function StatStrip({ stats, label }: { stats: Stat[]; label: string }) {
  return (
    <dl className="pk-stats" aria-label={label}>
      {/* A <dl>'s <div> may hold ONLY <dt>/<dd> — an icon span beside them, or
          a wrapper div around them, and every row stops being a description
          list (axe: definition-list, dlitem). So the icon lives inside the
          term, and the figure reads first through order, not through markup. */}
      {stats.map((stat, index) => (
        <div
          className="pk-stat"
          data-aside={stat.aside === true ? "" : undefined}
          key={`stat-${String(index)}`}
        >
          <dd className="pk-stat-value">{stat.value}</dd>
          <dt className="pk-stat-label">
            {stat.icon === undefined ? null : (
              <span className="pk-stat-icon" aria-hidden>
                {stat.icon}
              </span>
            )}
            {stat.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------ topic card -- */

export interface TopicCardProps {
  href: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** The card's one true footer fact — a reading time, a document date. */
  foot?: ReactNode;
  tone?: "gold" | "green" | "blue" | "amber" | "purple" | "neutral";
}

/** A link card with an icon tile — help topics, legal documents, support routes. */
export function TopicCard({ href, title, description, icon, foot, tone = "gold" }: TopicCardProps) {
  return (
    <Link className="pk-topic" href={href} data-tone={tone}>
      {icon === undefined ? null : (
        <span className="pk-topic-tile" aria-hidden>
          {icon}
        </span>
      )}
      <span className="pk-topic-title">{title}</span>
      {description === undefined ? null : <span className="pk-topic-desc">{description}</span>}
      {foot === undefined ? null : <span className="pk-topic-foot">{foot}</span>}
    </Link>
  );
}

/** The grid topic cards sit in. Four across, two on a tablet, one on a phone. */
export function TopicGrid({ children }: { children: ReactNode }) {
  return <div className="pk-topic-grid">{children}</div>;
}

/* ----------------------------------------------------------- count chips -- */

export interface CountChip {
  label: string;
  href: string;
  /** Omitted when the facet has no meaningful count (a search suggestion). */
  count?: number;
  active?: boolean;
  /** A coloured dot before the label — live, open, closed. */
  tone?: "live" | "open" | "closed" | "soon";
}

/**
 * Filter chips that carry their own counts.
 *
 * Links, not buttons: every facet is a real URL, so a filtered directory can be
 * shared, indexed and opened in a new tab — and the page keeps working with no
 * JavaScript. The count is what makes the chip honest; a facet that would yield
 * nothing shows a zero rather than pretending.
 */
export function CountChips({ chips, label }: { chips: CountChip[]; label: string }) {
  return (
    <nav className="pk-chips" aria-label={label}>
      {chips.map((chip) => (
        <Link
          key={chip.href + chip.label}
          href={chip.href}
          className="pk-chip"
          data-tone={chip.tone}
          data-active={chip.active === true ? "" : undefined}
          aria-current={chip.active === true ? "page" : undefined}
        >
          {chip.tone === undefined ? null : <span className="pk-chip-dot" aria-hidden />}
          {chip.label}
          {chip.count === undefined ? null : <span className="pk-chip-count">{chip.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/* --------------------------------------------------------------- section -- */

/**
 * A titled band in a light page body. `headingId` is required because every
 * public section is a landmark target: the heroes' "See the squads" jumps to
 * one, and the axe landmark rule wants the region named.
 */
export function PageSection({
  headingId,
  title,
  lede,
  action,
  children,
  flush,
}: {
  headingId: string;
  title: ReactNode;
  lede?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** Sections that hold their own cards don't need a card around them. */
  flush?: boolean;
}) {
  return (
    <section
      className="pk-section"
      aria-labelledby={headingId}
      data-flush={flush === true ? "" : undefined}
    >
      <div className="pk-section-head">
        <div>
          <h2 className="pk-section-title" id={headingId}>
            {title}
          </h2>
          {lede === undefined ? null : <p className="pk-section-lede">{lede}</p>}
        </div>
        {action === undefined ? null : <div className="pk-section-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** The light body every public page's sections sit in. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="pk-body">{children}</div>;
}
