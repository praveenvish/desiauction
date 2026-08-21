/**
 * WHAT AXE DOES NOT ANSWER.
 *
 * Three gaps in an axe-clean result, all of them real:
 *
 * 1 · THE OTHER THEME. The sweep ran entirely in `daylight`, because that is
 *     what a fresh browser gets. Every semantic token has a second value under
 *     `floodlight`, and nothing had checked those against the surfaces they
 *     actually land on.
 *
 * 2 · NON-TEXT CONTRAST (WCAG 1.4.11). axe checks text. It does not check
 *     whether an icon glyph is distinguishable from the chip it sits on, and
 *     this product paints icon chips from six different semantic fills.
 *
 * 3 · TEXT OVER GRADIENTS AND IMAGES. axe abstains — reporting "incomplete"
 *     rather than a violation — whenever it cannot resolve a single background
 *     colour. Those abstentions are invisible in a violations-only report,
 *     which is exactly how a gradient hero passes a scan it should not.
 *
 * Contrast is computed here from the composited colours the browser actually
 * resolved, so alpha, color-mix() and inherited backgrounds are all included.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { ROUTES } from "./routes.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";
const AXE = readFileSync(
  "../../node_modules/.pnpm/axe-core@4.12.1/node_modules/axe-core/axe.min.js",
  "utf8",
);

const PROBE = `(() => {
  const parse = (c) => {
    const m = c.match(/[\\d.]+/g);
    if (!m) return null;
    return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
  };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
  const over = (fg, bg) => { const a = fg[3]; return [0,1,2].map(i => fg[i] * a + bg[i] * (1 - a)); };

  // The composited background behind an element: walk up until something opaque
  // paints. Any ancestor carrying an image or gradient is reported, because that
  // is precisely the case axe declines to judge.
  const backdrop = (el) => {
    let node = el, gradient = null;
    while (node && node !== document.documentElement.parentElement) {
      const cs = getComputedStyle(node);
      if (gradient === null && cs.backgroundImage !== "none") gradient = cs.backgroundImage.slice(0, 60);
      const c = parse(cs.backgroundColor);
      if (c && c[3] === 1) return { rgb: [c[0], c[1], c[2]], gradient };
      if (c && c[3] > 0) {
        const under = backdrop(node.parentElement ?? document.body);
        return { rgb: over(c, under.rgb), gradient: gradient ?? under.gradient };
      }
      node = node.parentElement;
    }
    return { rgb: [255, 255, 255], gradient };
  };

  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;

    // --- text nodes -----------------------------------------------------------
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
    if (own.length > 1) {
      const fg = parse(cs.color);
      if (fg) {
        const bd = backdrop(el);
        const c = ratio(over(fg, bd.rgb), bd.rgb);
        const size = parseFloat(cs.fontSize);
        const bold = Number(cs.fontWeight) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const need = large ? 3 : 4.5;
        if (c < need) out.push({ kind: "text", ratio: Math.round(c * 100) / 100, need, size,
          text: own.slice(0, 46), sel: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/)[0] : ""),
          gradient: bd.gradient });
      }
    }

    // --- icon glyphs on coloured chips (WCAG 1.4.11) ----------------------------
    if (el.tagName.toLowerCase() === "svg" && r.width <= 40) {
      const fg = parse(cs.color);
      const bd = backdrop(el);
      if (fg && fg[3] > 0) {
        const c = ratio(over(fg, bd.rgb), bd.rgb);
        if (c < 3) out.push({ kind: "icon", ratio: Math.round(c * 100) / 100, need: 3, size: Math.round(r.width),
          text: (el.parentElement?.className && typeof el.parentElement.className === "string" ? el.parentElement.className : "").slice(0, 46),
          sel: "svg in " + (el.parentElement?.tagName.toLowerCase() ?? "?"), gradient: bd.gradient });
      }
    }
  }
  // Dedupe by selector+ratio: one repeated row in a table is one defect.
  const seen = new Set(), uniq = [];
  for (const o of out) { const k = o.kind + o.sel + o.ratio; if (seen.has(k)) continue; seen.add(k); uniq.push(o); }
  return uniq.sort((a, b) => a.ratio - b.ratio).slice(0, 20);
})()`;

const browser = await chromium.launch();
const findings = [];
for (const theme of ["daylight", "floodlight"]) {
  for (const authed of [false, true]) {
    const list = ROUTES.filter((r) => (authed ? true : !r.auth));
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...(authed ? { storageState: `${OUT}/state.json` } : {}),
    });
    // The product stores the theme choice the same way its own toggle does.
    await ctx.addInitScript(
      `try { localStorage.setItem("da-theme", ${JSON.stringify(theme)}); } catch {}`,
    );
    for (const route of list) {
      const page = await ctx.newPage();
      try {
        await page.goto(BASE + route.path, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        const actual = await page.evaluate(() =>
          document.documentElement.getAttribute("data-theme"),
        );
        const probe = await page.evaluate(PROBE);
        // axe's abstentions, which a violations-only report never shows.
        await page.addScriptTag({ content: AXE });
        const incomplete = await page.evaluate(async () => {
          const r = await window.axe.run(document, {
            resultTypes: ["violations"],
            runOnly: { type: "rule", values: ["color-contrast"] },
          });
          return {
            violations: r.violations.reduce((a, v) => a + v.nodes.length, 0),
            incomplete: (r.incomplete ?? []).reduce((a, v) => a + v.nodes.length, 0),
          };
        });
        if (probe.length || incomplete.incomplete) {
          findings.push({ theme, actual, authed, path: route.path, probe, axe: incomplete });
          console.log(
            `${theme[0]}${authed ? "A" : "-"} ${route.path.padEnd(56)} low=${probe.length} axeIncomplete=${incomplete.incomplete}`,
          );
        }
      } catch (e) {
        console.log(
          `${theme[0]}${authed ? "A" : "-"} ${route.path} ERROR ${String(e).slice(0, 80)}`,
        );
      }
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/contrast.json`, JSON.stringify(findings, null, 2));
console.log(`\n${findings.length} route/theme combinations with findings -> contrast.json`);
