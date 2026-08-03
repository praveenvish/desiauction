import type { CompetitionShareCard, PlayerShareCard, ShareCardTone } from "@desiauction/core";

// Pure presentational layer for the social share image — no IO, no server
// imports, so it renders identically in the OG route, the Twitter route, and an
// isolated rasterizer harness. Palette is literal floodlight hex (Satori cannot
// resolve the `var(--token)` design tokens; source of truth is
// `ui/generated/floodlight.css`).

export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 120,
          height: 120,
          borderRadius: 28,
          background: C.accent,
          color: C.onAccent,
          fontSize: 56,
          fontWeight: 700,
        }}
      >
        DA
      </div>
      <div style={{ display: "flex", fontSize: 52, color: C.heading }}>DesiAuction</div>
      <div style={{ display: "flex", fontSize: 30, color: C.muted }}>
        Run your player auction live
      </div>
    </div>
  );
}
