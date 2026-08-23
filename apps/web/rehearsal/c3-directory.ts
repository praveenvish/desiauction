import { launch, log, BASE } from "./lib";
async function main() {
  const b = await launch(true);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/c`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  const t = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  log("FACETS: " + (t.match(/All \d+ Registration open \d+ Live now \d+/)?.[0] ?? "?"));
  log("SHOWING: " + (t.match(/Showing [^.]*/)?.[0] ?? "?"));
  log("LIVE badges on page 1: " + (t.match(/LIVE NOW/g) ?? []).length);
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
