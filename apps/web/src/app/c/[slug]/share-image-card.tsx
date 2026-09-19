import type { CompetitionShareCard, PlayerShareCard, ShareCardTone } from "@desiauction/core";

// Pure presentational layer for the social share image — no IO, no server
// imports, so it renders identically in the OG route, the Twitter route, and an
// isolated rasterizer harness. Palette is literal floodlight hex (Satori cannot
// resolve the `var(--token)` design tokens; source of truth is
// `ui/generated/floodlight.css`).

export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * THE REAL MARK, not a typed "DA".
 *
 * Every share card that stood for DesiAuction itself drew the letters "DA" in
 * the rasterizer's default font on a gold square — near the mark, never the
 * mark — on the image WhatsApp shows for every link anyone forwards. This is
 * `public/brand/mark.svg`, inlined because this layer does no IO; a test holds
 * the two identical, so a redrawn mark cannot leave the cards behind.
 */
export const BRAND_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">\n  <rect x="1" y="1" width="62" height="62" rx="17" fill="#E6B24A"/>\n  <path d="M13 16h10c9 0 16 7 16 16s-7 16-16 16H13V16Zm7 7v18h3a9 9 0 0 0 0-18h-3Z" fill="#0B1018"/>\n  <path d="m30 48 13-32h7L37 48h-7Z" fill="#E6B24A" stroke="#E6B24A" stroke-width="5" stroke-linejoin="round"/>\n  <path d="m30 48 13-32h7l-13 32h-7Z" fill="#0B1018"/>\n  <path d="m46.5 24 9 24h-7l-2-6h-8l3-7h3l-1.5-4 3.5-7Z" fill="#0B1018"/>\n</svg>\n';

const BRAND_MARK_URI = `data:image/svg+xml;base64,${Buffer.from(BRAND_MARK_SVG).toString("base64")}`;

function BrandTile({ size }: { size: number }) {
  return <img src={BRAND_MARK_URI} width={size} height={size} alt="" />;
}

const C = {
  surface: "#0B1018",
  surfaceRaised: "#101623",
  borderSubtle: "#2C3A52",
  heading: "#E8EEF9",
  secondary: "#9FB0CC",
  muted: "#7285A6",
  // The product accent is gold. This was still the pre-redesign lime, and every
  // other token in this file matches ui/generated/floodlight.css exactly — so
  // the most-duplicated pixel in the product, the one on every link preview in
  // every WhatsApp group, was the one showing the wrong brand.
  accent: "#E6B24A",
  onAccent: "#070A0F",
  open: "#3DD68C",
} as const;

const TONE: Record<CompetitionShareCard["statusTone"], string> = {
  live: C.accent,
  open: C.open,
  closed: C.muted,
};

function StatusChip({ label, tone }: { label: string; tone: ShareCardTone }) {
  const color = TONE[tone];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 20px",
        borderRadius: 999,
        background: C.surfaceRaised,
        border: `1px solid ${C.borderSubtle}`,
        color,
        fontSize: 26,
      }}
    >
      <div style={{ width: 14, height: 14, borderRadius: 999, background: color }} />
      {label}
    </div>
  );
}

function MonogramTile({ text }: { text: string }) {
  // "DA" is the platform standing in for a season with no monogram of its own:
  // that is the brand, so it is the brand's mark.
  if (text === "DA") {
    return <BrandTile size={104} />;
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 104,
        height: 104,
        borderRadius: 24,
        background: C.accent,
        color: C.onAccent,
        fontSize: 46,
        fontWeight: 700,
      }}
    >
      {text}
    </div>
  );
}

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 16, height: 16, borderRadius: 999, background: C.accent }} />
      <div style={{ display: "flex", fontSize: 30, color: C.heading, letterSpacing: 0.5 }}>
        DesiAuction
      </div>
    </div>
  );
}

/** The full competition share card. */
export function renderShareCard(model: CompetitionShareCard, monogram: string) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: C.surface,
        // Floodlight wash from the top-left — the signature look.
        backgroundImage: `radial-gradient(900px 500px at 0% -10%, ${C.surfaceRaised}, ${C.surface})`,
        color: C.heading,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <MonogramTile text={monogram} />
        <StatusChip label={model.statusLabel} tone={model.statusTone} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", fontSize: 64, lineHeight: 1.08, color: C.heading }}>
          {model.title}
        </div>
        <div style={{ display: "flex", fontSize: 32, color: C.secondary }}>
          Organized by {model.organizer}
        </div>
        {model.meta !== null ? (
          <div style={{ display: "flex", fontSize: 28, color: C.muted }}>{model.meta}</div>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 40 }}>
          {model.stats.map((stat) => (
            <div key={stat.label} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div style={{ display: "flex", fontSize: 40, color: C.accent, fontWeight: 700 }}>
                {stat.value}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: C.muted }}>{stat.label}</div>
            </div>
          ))}
        </div>
        <Wordmark />
      </div>
    </div>
  );
}

/** The shareable single-player card (`/c/[slug]/p/[number]`). */
export function renderPlayerShareCard(model: PlayerShareCard, monogram: string) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: C.surface,
        backgroundImage: `radial-gradient(900px 500px at 0% -10%, ${C.surfaceRaised}, ${C.surface})`,
        color: C.heading,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <MonogramTile text={monogram} />
        <StatusChip label={model.statusLabel} tone={model.statusTone} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", fontSize: 68, lineHeight: 1.05, color: C.heading }}>
          {model.name}
        </div>
        <div style={{ display: "flex", fontSize: 30, color: C.secondary }}>{model.subtitle}</div>
        <div style={{ display: "flex", fontSize: 34, color: C.accent }}>{model.roleLine}</div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 28, color: C.muted }}>{model.styleLine ?? ""}</div>
        <Wordmark />
      </div>
    </div>
  );
}

/**
 * The /pricing share card. Same renderer family as the competition and player
 * cards above — same palette, same floodlight wash, same wordmark — because a
 * pricing link and a tournament link land in the SAME WhatsApp group, and two
 * card designs from one product read as two products. Content is passed in
 * rather than written here so the route can source every string from PRICING
 * and the card can never quote a price the page has retired.
 */
export interface PricingShareCard {
  readonly chip: string;
  readonly title: string;
  readonly subtitle: string;
  readonly promise: string;
  readonly stats: readonly { readonly value: string; readonly label: string }[];
}

export function renderPricingCard(model: PricingShareCard) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: C.surface,
        backgroundImage: `radial-gradient(900px 500px at 0% -10%, ${C.surfaceRaised}, ${C.surface})`,
        color: C.heading,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <MonogramTile text="DA" />
        <StatusChip label={model.chip} tone="open" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", fontSize: 64, lineHeight: 1.08, color: C.heading }}>
          {model.title}
        </div>
        <div style={{ display: "flex", fontSize: 30, color: C.secondary }}>{model.subtitle}</div>
        <div style={{ display: "flex", fontSize: 30, color: C.accent }}>{model.promise}</div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 40 }}>
          {model.stats.map((stat) => (
            <div key={stat.label} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div style={{ display: "flex", fontSize: 40, color: C.accent, fontWeight: 700 }}>
                {stat.value}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: C.muted }}>{stat.label}</div>
            </div>
          ))}
        </div>
        <Wordmark />
      </div>
    </div>
  );
}

/** Neutral branded card for a missing / non-public competition — never leaks. */
export function renderShareFallback() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        background: C.surface,
        backgroundImage: `radial-gradient(900px 500px at 50% -10%, ${C.surfaceRaised}, ${C.surface})`,
        color: C.heading,
        fontFamily: "sans-serif",
      }}
    >
      <BrandTile size={120} />
      <div style={{ display: "flex", fontSize: 52, color: C.heading }}>DesiAuction</div>
      <div style={{ display: "flex", fontSize: 30, color: C.muted }}>
        Run your player auction live
      </div>
    </div>
  );
}
