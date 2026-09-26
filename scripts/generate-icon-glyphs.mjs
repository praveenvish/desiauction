#!/usr/bin/env node
// ICON GLYPH GENERATOR.
//
// The product draws Phosphor icons (MIT, phosphoricons.com), but it does not
// ship Phosphor's React package to the browser. That package puts all six
// weights of a glyph (thin, light, regular, bold, fill, duotone) into every
// icon module, and the product's icon file imported all of them into ONE
// module — so any client component that drew a single icon carried every
// glyph in every weight: a 51 kB (gzip) chunk on every route, and the bundle
// budget failed on 67 routes.
//
// This script reads Phosphor's path data at development time and writes one
// small file per icon under packages/ui/src/icons/glyphs/, holding only the
// weights the product uses (regular, fill, duotone; bold for the few glyphs
// that need it). One file per icon means a route downloads only the icons it
// draws. Regenerate after adding an icon to ICONS or SPORTS below:
//
//   node scripts/generate-icon-glyphs.mjs
//
// `@phosphor-icons/react` stays a devDependency of @desiauction/ui for this.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ui = join(root, "packages/ui");
const require = createRequire(join(ui, "package.json"));
const phosphorRoot = dirname(require.resolve("@phosphor-icons/react/package.json"));
const React = require("react");

/** Product name → Phosphor glyph. The product's names say what an icon MEANS. */
const ICONS = {
  IconHome: "House",
  IconTrophy: "Trophy",
  IconUsers: "Users",
  IconRupee: "CurrencyInr",
  IconHelp: "Question",
  IconSearch: "MagnifyingGlass",
  IconBell: "Bell",
  IconMenu: "List",
  IconClose: "X",
  IconChevronDown: "CaretDown",
  IconChevronRight: "CaretRight",
  IconChevronLeft: "CaretLeft",
  IconArrowLeft: "ArrowLeft",
  IconArrowRight: "ArrowRight",
  IconArrowUp: "ArrowUp",
  IconExternal: "ArrowSquareOut",
  IconList: "ListBullets",
  IconGrid: "SquaresFour",
  IconKebab: "DotsThreeVertical",
  IconAlert: "Warning",
  IconInfo: "Info",
  IconCheck: "Check",
  IconCircle: "Circle",
  IconCheckCircle: "CheckCircle",
  IconClock: "Clock",
  IconEye: "Eye",
  IconStar: "Star",
  IconStarOutline: "Star",
  IconSpark: "Sparkle",
  IconCalendar: "CalendarBlank",
  IconMatch: "CalendarCheck",
  IconPin: "MapPin",
  IconGavel: "Gavel",
  IconShieldCheck: "ShieldCheck",
  IconLedger: "Notebook",
  IconReceipt: "Receipt",
  IconFileCheck: "SealCheck",
  IconLock: "LockSimple",
  IconBolt: "Lightning",
  IconRefresh: "ArrowsClockwise",
  IconLayers: "Stack",
  IconBroadcast: "Broadcast",
  IconTv: "Television",
  IconPhone: "Phone",
  IconMail: "Envelope",
  IconCamera: "Camera",
  IconMessageCircle: "ChatCircle",
  IconGlobe: "Globe",
  IconPlay: "Play",
  IconSun: "Sun",
  IconMoon: "Moon",
  IconVolume: "SpeakerHigh",
  IconVolumeOff: "SpeakerSlash",
  IconLogOut: "SignOut",
  IconUser: "User",
  IconChart: "ChartBar",
  IconMegaphone: "Megaphone",
  IconSend: "PaperPlaneTilt",
  IconWallet: "Wallet",
  IconCrown: "Crown",
  IconFlag: "Flag",
  IconCog: "Gear",
  IconPlus: "Plus",
  IconPencil: "PencilSimple",
  IconCopy: "Copy",
  IconUpload: "UploadSimple",
  IconDownload: "DownloadSimple",
  IconImage: "Image",
  IconFilter: "SlidersHorizontal",
  IconBat: "Cricket",
  IconBall: "Baseball",
  IconFile: "File",
  IconEyeOff: "EyeSlash",
  IconXCircle: "XCircle",
  IconMinusCircle: "MinusCircle",
  IconKey: "Key",
  IconDevice: "Desktop",
  IconTrash: "Trash",
  IconInbox: "Tray",
  IconPause: "Pause",
  IconSkipBack: "SkipBack",
  IconSkipForward: "SkipForward",
};

/** Glyphs that are always drawn in one weight, whatever the caller asks. */
const FIXED = { IconStar: "fill" };

/** Glyphs the product also draws bold (small marks on coloured fills). */
const BOLD = new Set(["IconCheck", "IconChevronLeft", "IconChevronRight"]);

/** Sport glyphs: regular only (sports.tsx wraps them). */
const SPORTS = {
  SportGlyphBasketball: "Basketball",
  SportGlyphCricket: "Cricket",
  SportGlyphCrosshair: "Crosshair",
  SportGlyphGameController: "GameController",
  SportGlyphHockey: "Hockey",
  SportGlyphPingPong: "PingPong",
  SportGlyphSoccerBall: "SoccerBall",
  SportGlyphVolleyball: "Volleyball",
};

async function weightsOf(phosphorName) {
  const file = join(phosphorRoot, "dist/defs", `${phosphorName}.es.js`);
  const mod = await import(pathToFileURL(file).href);
  return mod.default; // Map<weight, ReactElement>
}

/** Serialise a React element tree of <path>s back to JSX. */
function jsx(node) {
  if (node === null || node === undefined || node === false) return "";
  if (Array.isArray(node)) return node.map(jsx).join("");
  if (node.type === React.Fragment) return jsx(node.props.children);
  if (typeof node.type !== "string") throw new Error("unexpected element type");
  const { children, ...props } = node.props;
  const attrs = Object.entries(props)
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join(" ");
  const inner = jsx(children);
  return inner ? `<${node.type} ${attrs}>${inner}</${node.type}>` : `<${node.type} ${attrs} />`;
}

function fragment(element) {
  const body = jsx(element);
  const count = (body.match(/</g) ?? []).length;
  return count > 1 ? `<>${body}</>` : body;
}

const HEADER = `// GENERATED by scripts/generate-icon-glyphs.mjs from Phosphor Icons (MIT,
// https://phosphoricons.com). Do not edit — regenerate.
`;

const out = join(ui, "src/icons/glyphs");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const exported = [];
for (const [name, phosphorName] of Object.entries(ICONS)) {
  const all = await weightsOf(phosphorName);
  const keep = ["regular", "fill", "duotone", ...(BOLD.has(name) ? ["bold"] : [])];
  if (FIXED[name] !== undefined) keep.splice(0, keep.length, FIXED[name]);
  const entries = keep.map((weight) => `  ${weight}: ${fragment(all.get(weight))},`).join("\n");
  const fixed = FIXED[name] !== undefined ? `, ${JSON.stringify(FIXED[name])}` : "";
  writeFileSync(
    join(out, `${name}.tsx`),
    `${HEADER}import { glyph } from "../glyph";

export const ${name} = glyph(
  "${name}",
  {
${entries}
  }${fixed},
);
`,
  );
  exported.push(name);
}

for (const [name, phosphorName] of Object.entries(SPORTS)) {
  const all = await weightsOf(phosphorName);
  writeFileSync(
    join(out, `${name}.tsx`),
    `${HEADER}import { glyph } from "../glyph";

export const ${name} = glyph("${name}", {
  regular: ${fragment(all.get("regular"))},
});
`,
  );
}

writeFileSync(
  join(ui, "src/icons/icons.tsx"),
  `${HEADER}
/**
 * THE ICON SET — one family, one grid, three sizes.
 *
 * Every glyph is Phosphor, drawn by one hand on one 256 grid. The names are
 * the product's own and never change, so a call site says what the icon MEANS
 * (IconMatch) and scripts/generate-icon-glyphs.mjs decides what it LOOKS like.
 * One module per icon: a route downloads only the icons it draws.
 *
 * Sizes: 16 inline with text, 20 in menus/buttons/rows, 24 in headers and
 * tiles. Weights: "regular" at rest, "fill" for the selected item, "duotone"
 * for feature tiles and empty states, "bold" only where a glyph sits on a
 * coloured fill under 16px. Every icon inherits \`currentColor\` and is
 * decorative (aria-hidden) unless given \`alt\`.
 */
export type { IconProps, IconWeight } from "./glyph";
${exported.map((name) => `export { ${name} } from "./glyphs/${name}";`).join("\n")}
`,
);

// Written the way the repo formats code, so a regeneration never fails CI's
// format:check.
execFileSync("pnpm", ["exec", "prettier", "--write", out, join(ui, "src/icons/icons.tsx")], {
  cwd: root,
  stdio: "ignore",
});

const files = readdirSync(out).length;
console.log(
  `icon glyphs: ${exported.length} icons + ${Object.keys(SPORTS).length} sport glyphs → ${files} files`,
);
