/**
 * WHICH ELEMENT GREW? Asked generically, because guessing which one to sample
 * has now been wrong twice. Snapshots every element's height before the socket
 * answers and again after, and reports the outermost elements whose own height
 * changed by more than their children's — i.e. the ones that actually gained
 * content rather than merely containing something that did.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

// TAG ONCE, READ TWICE. The first version assigned ids in BOTH snapshots, so
// the same index named different elements once the DOM changed — it reported a
// status ribbon "collapsing" 2432px, which was simply two different nodes.
// Identity has to be stamped on the element, not derived from its position.
const SNAP = `((stamp) => {
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (stamp && !el.hasAttribute("data-grew-id")) el.setAttribute("data-grew-id", String(i));
    if (!el.hasAttribute("data-grew-id")) { i++; continue; }
    const r = el.getBoundingClientRect();
    out.push({
      id: el.getAttribute("data-grew-id"),
      h: Math.round(r.height),
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === "string" ? el.className : "").trim().slice(0, 46),
      testid: el.getAttribute("data-testid"),
      depth: (() => { let d = 0, p = el; while ((p = p.parentElement)) d++; return d; })(),
      text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 34),
    });
    i++;
  }
  return out;
})(STAMP)`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  storageState: `${OUT}/${process.env.AUDIT_STATE ?? "state"}.json`,
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.goto(`${BASE}/seasons/demo-premier-league/auction/live`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(Number(process.env.AUDIT_T0 ?? 250));
const before = await page.evaluate(SNAP.replace("STAMP", "true"));
await page.waitForTimeout(Number(process.env.AUDIT_T1 ?? 2500));
const after = await page.evaluate(SNAP.replace("STAMP", "false"));
await browser.close();

const b = new Map(before.map((x) => [x.id, x]));
const grew = [];
for (const a of after) {
  const was = b.get(a.id);
  if (was === undefined) {
    grew.push({ ...a, delta: a.h, note: "NEW" });
    continue;
  }
  if (Math.abs(a.h - was.h) >= 8) grew.push({ ...a, delta: a.h - was.h, note: `${was.h}->${a.h}` });
}
// Shallowest first, then biggest: the outermost gainer is the one to fix.
grew.sort((x, y) => x.depth - y.depth || Math.abs(y.delta) - Math.abs(x.delta));
console.log(`${grew.length} elements changed height\n`);
for (const g of grew.slice(0, 22)) {
  console.log(
    `  d${String(g.depth).padStart(2)} ${String(g.delta > 0 ? "+" + g.delta : g.delta).padStart(6)}px  ${String(g.note).padEnd(11)} <${g.tag}${g.testid ? ` data-testid="${g.testid}"` : ""} class="${g.cls}">  ${JSON.stringify(g.text)}`,
  );
}
