# 18 — Design Tokens

> Canon: C-4, C-5, C-6, C-12 · v1.0 · 2026-07-11

## Token architecture

Three tiers, strictly layered; each tier references only the tier below:

```
1. PRIMITIVE   ink-900, volt-400, space-4, text-2xl, duration-base…   (08–12)
2. SEMANTIC    --surface, --surface-raised, --text-primary, --accent,
               --border-subtle, --focus-ring, --money-positive…
3. COMPONENT   --button-primary-bg, --lot-card-frame, --timer-warning…
```

**Components consume semantic (and their own component) tokens only.** Primitive tokens in product code are lint-banned (64) — this is the mechanism that makes theming (C-4), rebrands, and consistency audits cheap. The previous product spent an entire program removing arbitrary values; this architecture makes them unrepresentable.

## Format & pipeline

- Source of truth: `packages/ui/tokens/*.json` in **W3C Design Tokens Community Group format** (`$value`, `$type`, aliases).
- Build: Style Dictionary → CSS custom properties (per theme), a typed TS module (autocomplete + compile-time existence), and a Tailwind preset (Tailwind consumes tokens; it never defines them).
- Themes: `floodlight` (dark) and `daylight` resolve the same semantic names to different primitives; applied via `data-theme` on the surface root. Live surfaces pin `floodlight` (14).
- Versioning: tokens are semver'd with the `@da/ui` package; removing/renaming a semantic token is a breaking change with a codemod (63).

## Semantic token inventory (core set)

| Group | Tokens |
|-------|--------|
| Surface | `surface`, `surface-raised`, `surface-overlay`, `surface-sunken`, `surface-inverse` |
| Text | `text-primary`, `text-secondary`, `text-muted`, `text-disabled`, `text-inverse`, `text-on-accent` |
| Border | `border-subtle`, `border-strong`, `border-interactive`, `focus-ring` |
| Accent | `accent`, `accent-hover`, `accent-pressed`, `accent-subtle` (volt family) |
| Status | `success-{subtle,base,strong}`, `danger-…`, `warning-…`, `info-…`, `live` (volt pulse) |
| Money | `money-value` (peak text), `money-spent`, `money-remaining`, `money-frozen` (warning-linked) |
| Ceremony | `ceremony-gold`, `ceremony-gold-deep`, `ceremony-glow` — importable **only** by ceremony components (08) |
| Space/type/motion/radius | mirror the primitive scales as semantic aliases (`gap-controls`, `pad-card`, `type-page-title`, …) |

The full inventory lives with the token source; this document owns the *rules*, the JSON owns the values.

## Naming rules

- Kebab-case, `{group}-{role}-{state?}`; no color words in semantic names (`accent`, never `volt-button`) — semantics survive rebrands.
- `on-X` pairings exist for every fill token and are the only sanctioned text-on-fill combinations (contrast-tested in CI, 08).

## Governance

- New token: PR must show two real usages and no existing token that serves; one-off tokens are rejected (that's what component tokens are for).
- Token changes require a visual-regression run (58) before merge.
- The Figma library and code tokens sync from the same JSON (Tokens Studio); divergence is a defect against this doc.
