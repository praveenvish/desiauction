"use client";

import "./gallery.css";

import { semanticTokenNames, ToastProvider } from "@desiauction/ui";
import { useState } from "react";

import { IdentityDemo } from "./identity-demo";
import { PrimitivesDemo } from "./primitives-demo";

// M-IP1-1 gallery: token sheet + type ramp + theme flip (IP-1_DESIGN §13).
// The e2e sweep (gallery.spec.ts) measures contrast on the pairs below.

const COLOR_GROUPS: Record<string, string[]> = {
  Surface: ["surface", "surface-raised", "surface-overlay", "surface-sunken", "surface-inverse"],
  Text: [
    "text-primary",
    "text-secondary",
    "text-muted",
    "text-disabled",
    "text-heading",
    "text-accent",
  ],
  "Border & focus": ["border-subtle", "border-strong", "border-interactive", "focus-ring"],
  Accent: ["accent", "accent-hover", "accent-pressed", "accent-subtle", "live"],
  Status: [
    "success-subtle",
    "success-base",
    "success-strong",
    "danger-subtle",
    "danger-base",
    "danger-strong",
    "warning-subtle",
    "warning-base",
    "warning-strong",
    "info-subtle",
    "info-base",
    "info-strong",
  ],
  Money: ["money-value", "money-spent", "money-remaining", "money-frozen"],
  Ceremony: ["ceremony-gold", "ceremony-gold-deep", "ceremony-glow"],
};

const TYPE_RAMP = [
  { token: "text-xs", display: false },
  { token: "text-sm", display: false },
  { token: "text-base", display: false },
  { token: "text-md", display: false },
  { token: "text-lg", display: false },
  { token: "text-xl", display: false },
  { token: "text-2xl", display: false },
  { token: "text-3xl", display: false },
  { token: "display-sm", display: true },
  { token: "display-md", display: true },
  { token: "display-lg", display: true },
  { token: "display-xl", display: true },
] as const;

const LATIN_SAMPLE = "Shivaji Park floodlights";
const DEVANAGARI_SAMPLE = "शिवाजी पार्क की नीलामी";

export default function GalleryPage() {
  const [theme, setTheme] = useState<"daylight" | "floodlight">("daylight");
  const flip = () => {
    const next = theme === "daylight" ? "floodlight" : "daylight";
    setTheme(next);
    document.documentElement.dataset["theme"] = next;
  };

  return (
    <ToastProvider>
      <main className="gallery" data-testid="gallery-root">
        <header className="gallery-header">
          <h1>FLOODLIGHT</h1>
          <button type="button" className="theme-toggle" onClick={flip} data-testid="theme-toggle">
            Theme: {theme}
          </button>
        </header>

        <section aria-labelledby="tokens-h">
          <h2 id="tokens-h">Semantic tokens ({semanticTokenNames.length})</h2>
          {Object.entries(COLOR_GROUPS).map(([group, names]) => (
            <div key={group}>
              <h2>{group}</h2>
              <div className="swatch-grid">
                {names.map((name) => (
                  <div className="swatch" key={name}>
                    <div className="swatch-chip" style={{ background: `var(--${name})` }} />
                    <div className="swatch-meta">
                      <span>{name}</span>
                      <code data-token={name}>--{name}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section aria-labelledby="type-h">
          <h2 id="type-h">Type ramp — Clash Display · Geist Sans · Anek Devanagari</h2>
          {TYPE_RAMP.map(({ token, display }) => (
            <div className="type-row" key={token}>
              <span className="label">{token}</span>
              <span
                className={display ? "type-sample display" : "type-sample"}
                style={{
                  fontSize: `var(--${token}-size)`,
                  lineHeight: `var(--${token}-line)`,
                }}
              >
                {display ? `${LATIN_SAMPLE} · ${DEVANAGARI_SAMPLE}` : LATIN_SAMPLE}
              </span>
            </div>
          ))}
          <div className="type-row">
            <span className="label">money · tabular</span>
            <span
              className="money-sample"
              data-testid="money-sample"
              style={{ fontSize: "var(--text-3xl-size)", lineHeight: "var(--text-3xl-line)" }}
            >
              ₹1,10,50,000
            </span>
          </div>
        </section>

        <section aria-labelledby="pairs-h">
          <h2 id="pairs-h">Contrast pairs (measured by e2e)</h2>
          <div className="pair-list">
            <div
              className="pair"
              data-pair="text-primary/surface"
              style={{ background: "var(--surface)", color: "var(--text-primary)" }}
            >
              text-primary on surface
            </div>
            <div
              className="pair"
              data-pair="text-secondary/surface"
              style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
            >
              text-secondary on surface
            </div>
            <div
              className="pair"
              data-pair="text-muted/surface"
              style={{ background: "var(--surface)", color: "var(--text-muted)" }}
            >
              text-muted on surface
            </div>
            <div
              className="pair"
              data-pair="text-heading/surface-raised"
              style={{ background: "var(--surface-raised)", color: "var(--text-heading)" }}
            >
              text-heading on surface-raised
            </div>
            <div
              className="pair"
              data-pair="text-accent/surface"
              style={{ background: "var(--surface)", color: "var(--text-accent)" }}
            >
              text-accent on surface
            </div>
            <div
              className="pair"
              data-pair="text-on-accent/accent"
              style={{ background: "var(--accent)", color: "var(--text-on-accent)" }}
            >
              text-on-accent on accent
            </div>
            <div
              className="pair"
              data-pair="money-value/surface"
              style={{ background: "var(--surface)", color: "var(--money-value)" }}
            >
              money-value on surface
            </div>
            <div
              className="pair"
              data-pair="money-remaining/surface"
              style={{ background: "var(--surface)", color: "var(--money-remaining)" }}
            >
              money-remaining on surface
            </div>
            <div
              className="pair"
              data-pair="success-strong/surface"
              style={{ background: "var(--surface)", color: "var(--success-strong)" }}
            >
              success-strong on surface
            </div>
            <div
              className="pair"
              data-pair="danger-strong/surface"
              style={{ background: "var(--surface)", color: "var(--danger-strong)" }}
            >
              danger-strong on surface
            </div>
            <div
              className="pair"
              data-pair="warning-strong/surface"
              style={{ background: "var(--surface)", color: "var(--warning-strong)" }}
            >
              warning-strong on surface
            </div>
            <div
              className="pair"
              data-pair="info-strong/surface"
              style={{ background: "var(--surface)", color: "var(--info-strong)" }}
            >
              info-strong on surface
            </div>
          </div>
        </section>

        <IdentityDemo />
        <PrimitivesDemo />
      </main>
    </ToastProvider>
  );
}
