import { launch, log, BASE } from "./lib";
async function main() {
  const b = await launch(true);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  const t = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  log("BANNER: " + (t.match(/During beta[^.]*\./g) ?? []).join(" ").slice(0, 420));
  await p.goto(`${BASE}/c`, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  const d = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  log("\nDIRECTORY: " + (d.match(/All \d+ Registration open \d+ Live now \d+/)?.[0] ?? "?"));
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
