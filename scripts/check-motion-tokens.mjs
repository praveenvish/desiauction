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
  for (const token of declaration.split(/\s+/)) {
    if (token.startsWith("var(")) return null; // already a token
    const ms = toMs(token);
    if (ms !== null) return ms;
  }
  return null;
}

const violations = [];
for (const dirRoot of ROOTS) {
  for (const file of cssFiles(join(root, dirRoot))) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const m =
        /^\s*(animation|transition|animation-duration|transition-duration)\s*:\s*([^;]+);/.exec(
          line,
        );
      if (m === null) return;
      const ms = firstDuration(m[2]);
      if (ms === null || ms > THRESHOLD_MS) return;
      const context = `${lines[index - 1] ?? ""}\n${line}`;
      if (context.includes("motion-ok:")) return;
      violations.push({
        file: file.slice(root.length + 1),
        line: index + 1,
        ms,
        text: line.trim(),
      });
    });
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
