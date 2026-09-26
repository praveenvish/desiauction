#!/usr/bin/env node
// MOTION TOKEN GATE.
//
// The duration scale drifted once and the reason was structural: it ran
// 80/120/200/320 and then jumped 5.6x to 1800ms, so anything that needed to
// feel heavier than a state change and lighter than a celebration had nowhere
// to go and got a raw number instead. The rungs now exist (see
// packages/ui/tokens/primitives.json). This stops the drift coming back.
//
//   pnpm check:motion
//
// THE RULE. An interaction duration — the first time value in an `animation` or
// `transition` shorthand, or an `*-duration` longhand — must name a token when
// it is 2000ms or less. Above that it is ambient decoration: a 26s Ken Burns
// pan or a 36s drift is not on a scale built for interaction, and pretending
// otherwise would mean inventing rungs nobody reasons about.
//
// THE ESCAPE. Some short durations are deliberately off the scale because they
// encode a RELATIONSHIP rather than a choice — the ceremony's glow is tuned to
// outlast confetti carrying 660ms of per-piece stagger, and snapping either to
// a rung breaks the pair. Those lines carry `motion-ok:` and a reason. The
// marker is inline rather than an allowlist in this file on purpose: an
// allowlist rots the moment code moves, and a reason kept next to the code is
// the only kind anybody reads.
//
// Exit 0 = clean. Exit 1 = a raw interaction duration with no reason given.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["apps/web/src", "packages/ui/src"];
const THRESHOLD_MS = 2000;
const SKIP = new Set(["node_modules", ".next", "dist", "generated"]);

function cssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

/** ms for a CSS time literal, or null if it is not one. */
function toMs(value) {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(value.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? (m[2] === "s" ? n * 1000 : n) : null;
}

/*
 * The FIRST time value only. An `animation` shorthand may carry two — duration
 * then delay — and `mk-sheen 9s var(--ease-out) 1.4s infinite` is a 9s ambient
 * loop with a 1.4s delay, not a 1.4s interaction. Flagging the second value
 * would report the one line in the codebase that is most obviously fine.
 */
function firstDuration(declaration) {
  for (const token of declaration.trim().split(/\s+/)) {
    if (token.startsWith("var(")) return null; // already a token
    const ms = toMs(token);
    if (ms !== null) return ms;
  }
  return null;
}

/*
 * Split a shorthand into its comma-separated layers, ignoring commas inside
 * parentheses (`var(--x, 1s)`, `cubic-bezier(.2, .8, .2, 1)`). Every layer of
 * `transition: transform 180ms, box-shadow 180ms` is its own interaction.
 */
function layers(value) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

const violations = [];
for (const dirRoot of ROOTS) {
  for (const file of cssFiles(join(root, dirRoot))) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    // Whole-file scan, so a declaration wrapped over several lines is read as
    // one: the line-by-line version never saw `transition:\n  transform 180ms`.
    const declaration =
      /(?:^|[;{\s])(animation|transition|animation-duration|transition-duration)\s*:\s*([^;{}]+);/g;
    for (const m of text.matchAll(declaration)) {
      const offset = (m.index ?? 0) + m[0].indexOf(m[1]);
      const first = text.slice(0, offset).split("\n").length - 1;
      const last = first + m[2].split("\n").length - 1;
      const ms = layers(m[2])
        .map((layer) => firstDuration(layer))
        .find((value) => value !== null && value > 0 && value <= THRESHOLD_MS);
      if (ms === undefined) continue;
      const context = lines.slice(Math.max(0, first - 1), last + 1).join("\n");
      if (context.includes("motion-ok:")) continue;
      violations.push({
        file: file.slice(root.length + 1),
        line: first + 1,
        ms,
        text: `${m[1]}: ${m[2].replace(/\s+/g, " ").trim()}`,
      });
    }
  }
}

if (violations.length === 0) {
  console.log("motion tokens: every interaction duration names a rung or gives a reason.");
  process.exit(0);
}

console.error("\nRAW INTERACTION DURATIONS (<=2000ms) WITH NO TOKEN AND NO REASON:\n");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.text}`);
}
console.error(
  `\n${violations.length} violation(s). Name a rung from packages/ui/tokens/primitives.json` +
    " (instant 80 / fast 120 / base 200 / slow 320 / emphatic 520 / dramatic 840 /" +
    " ceremony 1800, plus pulse and shimmer for ambient loops) — or, if the number encodes a" +
    " relationship a rung would break, say so with a `motion-ok:` comment on or above the line.\n",
);
process.exit(1);
